/* Required selfie check-in. A stamp is granted only after the photo uploads. */
(function () {
  var modal = null;
  var stream = null;
  var pending = null;

  function copy() {
    return window.HCPhotoConsent || {};
  }

  function imageApi() {
    return window.HCCheckinImage;
  }

  function cancelError() {
    var err = new Error("Cancelled");
    err.code = "cancel";
    return err;
  }

  function isCancel(err) {
    return !!(err && err.code === "cancel");
  }

  function missingRpc(error) {
    var msg = String((error && (error.message || error.details || error.hint)) || error || "");
    return /start_checkin|could not find the function|PGRST202|schema cache/i.test(msg);
  }

  function plainError(error) {
    var raw = String((error && error.message) || error || "");
    var known = [
      "Already stamped",
      "Location required",
      "You need to be at the shop",
      "Invalid code",
      "Code required",
      "Business not on this crawl",
      "Not authenticated",
      "Unknown business",
      "Selfie required",
      "Check-in expired",
      "A selfie is required"
    ];
    for (var i = 0; i < known.length; i++) {
      if (raw.toLowerCase().indexOf(known[i].toLowerCase()) !== -1) return known[i];
    }
    return raw.replace(/^ERROR:\s*/i, "").trim() || "Could not claim that stamp.";
  }

  function ensureModal() {
    if (modal) return modal;
    var root = document.createElement("div");
    root.className = "hc-checkin";
    root.hidden = true;
    root.innerHTML =
      '<div class="hc-checkin-backdrop" data-act="cancel"></div>' +
      '<div class="hc-checkin-card" role="dialog" aria-modal="true" aria-labelledby="hc-checkin-title">' +
        '<p class="eyebrow">Check-in</p>' +
        '<h2 id="hc-checkin-title">Take a selfie</h2>' +
        '<p class="hc-checkin-shop"></p>' +
        '<p class="hc-checkin-notice" hidden></p>' +
        '<p class="hc-checkin-line"></p>' +
        '<div class="hc-checkin-stage">' +
          '<video playsinline autoplay muted></video>' +
          '<canvas class="hc-checkin-still" hidden></canvas>' +
        "</div>" +
        '<p class="hc-checkin-help" hidden></p>' +
        '<label class="hc-checkin-file-label">Use the camera<input class="hc-checkin-file" type="file" accept="image/*" capture="user" /></label>' +
        '<label class="hc-check"><input type="checkbox" class="hc-opt-public" /> <span class="hc-opt-public-label"></span></label>' +
        '<label class="hc-check"><input type="checkbox" class="hc-opt-age" /> <span class="hc-opt-age-label"></span></label>' +
        '<label class="hc-check"><input type="checkbox" class="hc-opt-social" /> <span class="hc-opt-social-label"></span></label>' +
        '<p class="hc-checkin-age-note" hidden></p>' +
        '<div class="hc-checkin-actions row">' +
          '<button class="btn btn-primary hc-snap" type="button">Take photo</button>' +
          '<button class="btn btn-soft hc-retake" type="button" hidden>Retake</button>' +
          '<button class="btn btn-primary hc-use" type="button" hidden>Use this photo</button>' +
          '<button class="btn btn-ghost hc-cancel" type="button" data-act="cancel">Cancel</button>' +
        "</div>" +
        '<div class="hc-share-step" hidden>' +
          '<canvas class="hc-share-card" width="1080" height="1350"></canvas>' +
          '<div class="row mt-2">' +
            '<button class="btn btn-primary hc-share" type="button">Share</button>' +
            '<button class="btn btn-ghost hc-done" type="button">Done</button>' +
          "</div>" +
        "</div>" +
        '<p class="form-error hc-checkin-err" role="alert"></p>' +
      "</div>";
    document.body.appendChild(root);
    modal = root;
    root.addEventListener("click", function (ev) {
      if (ev.target && ev.target.getAttribute && ev.target.getAttribute("data-act") === "cancel") {
        close("cancel");
      }
    });
    root.querySelector(".hc-snap").onclick = snap;
    root.querySelector(".hc-retake").onclick = retake;
    root.querySelector(".hc-use").onclick = usePhoto;
    root.querySelector(".hc-share").onclick = shareCard;
    root.querySelector(".hc-done").onclick = function () { close("done"); };
    root.querySelector(".hc-checkin-file").onchange = onFile;
    root.querySelector(".hc-opt-public").onchange = syncAgeNote;
    root.querySelector(".hc-opt-age").onchange = syncAgeNote;
    document.addEventListener("keydown", function (ev) {
      if (!modal || modal.hidden) return;
      if (ev.key === "Escape") close("cancel");
    });
    return modal;
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach(function (track) { track.stop(); });
      stream = null;
    }
  }

  function close(reason) {
    if (!modal) return;
    stopCamera();
    modal.hidden = true;
    document.body.classList.remove("hc-checkin-open");
    var settle = pending;
    pending = null;
    if (!settle) return;
    if (settle.result) settle.resolve(settle.result);
    else settle.reject(cancelError());
  }

  function showError(message) {
    var el = modal.querySelector(".hc-checkin-err");
    el.textContent = message || "";
    el.classList.toggle("show", !!message);
  }

  function syncAgeNote() {
    var note = modal.querySelector(".hc-checkin-age-note");
    var pubBox = modal.querySelector(".hc-opt-public");
    var ageBox = modal.querySelector(".hc-opt-age");
    var needed = pubBox.checked && !ageBox.checked;
    note.hidden = !needed;
    note.textContent = needed ? (copy().ageNeededNote || "") : "";
  }

  function setShot(canvas) {
    var still = modal.querySelector(".hc-checkin-still");
    var video = modal.querySelector("video");
    still.width = canvas.width;
    still.height = canvas.height;
    still.getContext("2d").drawImage(canvas, 0, 0);
    still.hidden = false;
    video.hidden = true;
    modal.querySelector(".hc-snap").hidden = true;
    modal.querySelector(".hc-retake").hidden = false;
    modal.querySelector(".hc-use").hidden = false;
    modal._shot = canvas;
  }

  function retake() {
    var still = modal.querySelector(".hc-checkin-still");
    var video = modal.querySelector("video");
    still.hidden = true;
    video.hidden = false;
    modal.querySelector(".hc-snap").hidden = false;
    modal.querySelector(".hc-retake").hidden = true;
    modal.querySelector(".hc-use").hidden = true;
    modal._shot = null;
    showError("");
  }

  async function startCamera() {
    var help = modal.querySelector(".hc-checkin-help");
    var fileLabel = modal.querySelector(".hc-checkin-file-label");
    help.hidden = true;
    fileLabel.hidden = true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      help.hidden = false;
      help.textContent = pending.pub ? copy().pubCameraHelp : copy().cameraHelp;
      fileLabel.hidden = false;
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "user" }
      });
      var video = modal.querySelector("video");
      video.srcObject = stream;
      await video.play();
    } catch (e) {
      help.hidden = false;
      help.textContent = pending.pub ? copy().pubCameraHelp : copy().cameraHelp;
      fileLabel.hidden = false;
    }
  }

  async function snap() {
    var video = modal.querySelector("video");
    if (!video.videoWidth) {
      showError(pending.pub ? copy().pubCameraHelp : copy().cameraHelp);
      modal.querySelector(".hc-checkin-file-label").hidden = false;
      return;
    }
    try {
      var blob = await imageApi().blobFromDrawable(video);
      var canvas = await canvasFromBlob(blob);
      setShot(canvas);
    } catch (e) {
      showError(e.message || "Could not take the photo.");
    }
  }

  function canvasFromBlob(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        var canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext("2d").drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        resolve(canvas);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("Could not read the photo."));
      };
      img.src = url;
    });
  }

  async function onFile(ev) {
    var file = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!file) return;
    try {
      var img = await canvasFromBlob(file);
      var blob = await imageApi().blobFromDrawable(img);
      var canvas = await canvasFromBlob(blob);
      setShot(canvas);
      showError("");
    } catch (e) {
      showError(e.message || "Could not use that photo.");
    }
  }

  async function usePhoto() {
    if (!modal._shot || !pending) return;
    var btn = modal.querySelector(".hc-use");
    btn.disabled = true;
    showError("");
    try {
      var blob = await imageApi().blobFromDrawable(modal._shot);
      var path = pending.session.selfie_path;
      var bucket = pending.client.storage.from("checkin-selfies");
      await bucket.remove([path]);
      var up = await bucket.upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (up.error) throw up.error;
      var pub = modal.querySelector(".hc-opt-public").checked;
      var age = modal.querySelector(".hc-opt-age").checked;
      var social = modal.querySelector(".hc-opt-social").checked;
      var done = await pending.client.rpc("complete_checkin", {
        p_checkin: pending.session.checkin_id,
        p_selfie_path: path,
        p_public_opt_in: pub,
        p_age_confirmed: age,
        p_social_opt_in: social
      });
      if (done.error) throw done.error;
      pending.result = done.data;
      stopCamera();
      await drawShare(modal._shot, done.data || {});
      modal.querySelector(".hc-checkin-stage").hidden = true;
      modal.querySelector(".hc-checkin-file-label").hidden = true;
      modal.querySelector(".hc-check").hidden = true;
      modal.querySelectorAll(".hc-check").forEach(function (el) { el.hidden = true; });
      modal.querySelector(".hc-checkin-actions").hidden = true;
      modal.querySelector(".hc-checkin-age-note").hidden = true;
      modal.querySelector(".hc-share-step").hidden = false;
    } catch (e) {
      showError(plainError(e));
      btn.disabled = false;
    }
  }

  function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    var words = String(text || "").split(/\s+/);
    var line = "";
    var yy = y;
    words.forEach(function (word) {
      var next = line ? line + " " + word : word;
      if (ctx.measureText(next).width > maxWidth && line) {
        ctx.fillText(line, x, yy);
        line = word;
        yy += lineHeight;
      } else {
        line = next;
      }
    });
    if (line) ctx.fillText(line, x, yy);
    return yy;
  }

  async function drawShare(shot, result) {
    var card = modal.querySelector(".hc-share-card");
    var ctx = card.getContext("2d");
    ctx.fillStyle = "#1f3a24";
    ctx.fillRect(0, 0, card.width, card.height);
    var size = imageApi().fitSize(shot.width, shot.height, 920);
    var x = Math.round((card.width - size.width) / 2);
    ctx.drawImage(shot, x, 80, size.width, size.height);
    ctx.fillStyle = "#f4efe6";
    ctx.font = "600 54px Fraunces, Georgia, serif";
    ctx.fillText("Hometown Crawls", 72, 1080);
    ctx.font = "500 36px Outfit, sans-serif";
    var y = wrapText(ctx, result.shop_name || pending.session.shop_name || "", 72, 1150, 936, 46);
    ctx.font = "400 30px Outfit, sans-serif";
    wrapText(ctx, result.crawl_name || pending.session.crawl_name || "", 72, y + 52, 936, 40);
    modal._shareBlob = await new Promise(function (resolve) {
      card.toBlob(function (blob) { resolve(blob); }, "image/jpeg", 0.9);
    });
  }

  async function shareCard() {
    var blob = modal._shareBlob;
    if (!blob) return;
    var file = new File([blob], "hometown-crawls-visit.jpg", { type: "image/jpeg" });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Hometown Crawls" });
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return;
      }
    }
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "hometown-crawls-visit.jpg";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function openModal(session, client) {
    var root = ensureModal();
    var c = copy();
    var pub = c.isPub ? c.isPub(session.crawl_type, session.min_age) : session.crawl_type === "pub";
    pending.pub = pub;
    pending.session = session;
    pending.client = client;
    root.querySelector(".hc-checkin-shop").textContent = (session.shop_name || "This shop") + " · " + (session.crawl_name || "");
    var notice = root.querySelector(".hc-checkin-notice");
    notice.hidden = !pub;
    notice.textContent = pub ? (c.pubCheckinNotice || "") : "";
    root.querySelector(".hc-checkin-line").textContent = pub ? (c.pubCameraLine || c.cameraLine || "") : (c.cameraLine || "");
    root.querySelector(".hc-opt-public").checked = false;
    root.querySelector(".hc-opt-age").checked = false;
    root.querySelector(".hc-opt-social").checked = false;
    root.querySelector(".hc-opt-public-label").textContent = pub ? (c.publicOptInPub || "") : (c.publicOptIn ? c.publicOptIn(session.shop_name) : "");
    root.querySelector(".hc-opt-age-label").textContent = pub ? (c.age21 || "") : (c.age18 || "");
    root.querySelector(".hc-opt-social-label").textContent = c.socialOptIn ? c.socialOptIn(session.shop_name) : "";
    root.querySelector(".hc-checkin-stage").hidden = false;
    root.querySelector(".hc-share-step").hidden = true;
    root.querySelector(".hc-checkin-actions").hidden = false;
    root.querySelectorAll(".hc-check").forEach(function (el) { el.hidden = false; });
    root.querySelector(".hc-use").disabled = false;
    root._shot = null;
    root._shareBlob = null;
    retake();
    syncAgeNote();
    showError("");
    root.hidden = false;
    document.body.classList.add("hc-checkin-open");
    startCamera();
  }

  async function claimWithSelfie(args) {
    var crawlApi = window.HCCrawl;
    if (!crawlApi) throw new Error("Supabase not loaded");
    var client = crawlApi.client();
    if (!client) throw new Error("Supabase not loaded");
    if (!imageApi()) throw new Error("Photo check-in isn’t turned on yet.");
    var session = await crawlApi.getSession();
    if (!session) session = await crawlApi.ensureAuth();
    if (!session) throw new Error("Please sign in with email to stamp.");
    var coords = { lat: args && args.lat, lng: args && args.lng };
    if (coords.lat == null || coords.lng == null) coords = await crawlApi.getPosition();
    if (coords.lat == null || coords.lng == null) throw new Error("Location required");

    var started = await client.rpc("start_checkin", {
      p_crawl: args.crawl || crawlApi.CRAWL,
      p_business: args.business,
      p_code: args.code,
      p_lat: coords.lat,
      p_lng: coords.lng
    });
    if (started.error) {
      if (missingRpc(started.error)) {
        throw new Error("Photo check-in isn’t turned on yet.");
      }
      throw new Error(plainError(started.error));
    }

    return new Promise(function (resolve, reject) {
      pending = { resolve: resolve, reject: reject };
      openModal(started.data || {}, client);
    });
  }

  window.HCCheckin = {
    claimWithSelfie: claimWithSelfie,
    isCancel: isCancel
  };
})();
