/* Prize entries, optional shop bonus, and guest photos.
   ?demo=1 stays in this browser. It does not stamp, join, or upload. */
(function () {
  var PHOTO_KEY = "hc-guest-photos";
  var BONUS_KEY = "hc-bonus-claims";
  var CONSENT = "I give Hometown Crawls permission to show this photo on its website and social pages.";
  var MAX_BYTES = 5 * 1024 * 1024;
  var TYPES = ["image/png", "image/jpeg", "image/webp"];

  // Pages set window.HC_GUEST_CRAWL before this file runs its loaders.
  // Account and the Puyallup passport leave it unset and stay on puy-coffee.
  function guestCrawl() {
    var id = window.HC_GUEST_CRAWL;
    if (typeof id === "string" && /^[a-z0-9][a-z0-9-]{0,40}$/.test(id)) return id;
    return "puy-coffee";
  }

  function demoOn() {
    return new URLSearchParams(location.search).get("demo") === "1";
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function note(okId, errId, okText, errText) {
    var ok = okId ? document.getElementById(okId) : null;
    var err = errId ? document.getElementById(errId) : null;
    if (ok) { ok.textContent = okText || ""; ok.classList.toggle("show", !!okText); }
    if (err) { err.textContent = errText || ""; err.classList.toggle("show", !!errText); }
  }

  function readJson(key) {
    try {
      var parsed = JSON.parse(localStorage.getItem(key) || "null");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function photos() {
    var all = readJson(PHOTO_KEY);
    return Array.isArray(all.items) ? all.items : [];
  }

  function savePhotos(items) {
    localStorage.setItem(PHOTO_KEY, JSON.stringify({ items: items }));
  }

  function bonusState() {
    var all = readJson(BONUS_KEY);
    return all.done === true;
  }

  function completionBonus() {
    return 3;
  }

  function stopsCount(shopCount) {
    return shopCount || 15;
  }

  function paintEntries(shopCount, stampedCount) {
    var line = document.getElementById("entries-line");
    if (!line) return;
    var stops = stopsCount(shopCount);
    var stamped = Math.min(stops, Number(stampedCount) || 0);
    var bonus = bonusState() ? 2 : 0;
    var bonusLeft = bonusState() ? 0 : 2;
    var done = stamped >= stops && stops > 0;
    var earned = stamped + (done ? completionBonus() : 0) + bonus;
    var max = stops + completionBonus() + 2;
    var more = Math.max(0, max - earned);
    line.textContent = earned + " entries, " + more + " more available";
    var detail = document.getElementById("entries-detail");
    if (detail) {
      detail.textContent = (demoOn() ? "DEMO DATA. " : "") +
        "1 entry for each stop, plus " + completionBonus() + " for finishing the passport, plus shop bonuses.";
    }
    var bar = document.getElementById("entries-bar");
    if (bar) bar.style.width = Math.round((earned / Math.max(max, 1)) * 100) + "%";
    var ways = document.getElementById("entries-ways");
    if (ways) {
      ways.innerHTML = [
        stamped + " of " + stops + " stops stamped",
        done ? "Completion bonus earned" : completionBonus() + " more for finishing every stop",
        bonusLeft ? "2 more for the optional shop bonus" : "Shop bonus submitted"
      ].map(function (item) { return "<li>" + esc(item) + "</li>"; }).join("");
    }
  }

  var shownActionId = "";

  function hideBonus() {
    var card = document.getElementById("bonus-card");
    if (!card) return;
    card.classList.add("hidden");
    card.hidden = true;
    shownActionId = "";
  }

  function instagramHandle(bonus, shop) {
    var fromShop = shop && shop.instagram ? String(shop.instagram).replace(/^@/, "").trim() : "";
    if (fromShop) return fromShop;
    var label = String((bonus && bonus.label) || "");
    var at = label.match(/@([A-Za-z0-9._]+)/);
    if (at) return at[1];
    var url = String((bonus && bonus.url) || "");
    var path = url.match(/instagram\.com\/(?!p\/|reel\/|stories\/)([A-Za-z0-9._]+)/i);
    return path ? path[1] : "";
  }

  function bonusButtonText(bonus, shop) {
    var handle = instagramHandle(bonus, shop);
    if (handle) return "Open @" + handle + " on Instagram";
    return "Open the shop page";
  }

  function showBonus(bonus, shop) {
    var card = document.getElementById("bonus-card");
    if (!card || !bonus) return;
    shownActionId = bonus.id || "";
    var copy = document.getElementById("bonus-copy");
    if (copy) {
      copy.textContent = bonus.label + (bonus.entries ? " · " + bonus.entries + " entries." : "") + " Optional, and it does not change the stamp.";
    }
    var link = document.getElementById("bonus-link");
    if (link) {
      link.href = bonus.url || "#";
      link.textContent = bonusButtonText(bonus, shop);
      link.classList.toggle("hidden", !bonus.url);
    }
    card.classList.remove("hidden");
    card.hidden = false;
  }

  async function refreshBonus() {
    hideBonus();
    if (demoOn() || !window.HCCrawl || !HCCrawl.getSession || !HCCrawl.client || !HCCrawl.myStamps) return;
    var session = await HCCrawl.getSession();
    if (!session || !session.user || session.user.is_anonymous || !session.user.email) return;
    var stamps = await HCCrawl.myStamps(guestCrawl());
    var stamped = {};
    (stamps || []).forEach(function (row) { if (row && row.business_id) stamped[row.business_id] = true; });
    if (!Object.keys(stamped).length) return;
    var client = HCCrawl.client();
    var actions = await client.from("bonus_actions").select("id, listing_id, kind, label, url, entries").eq("active", true).eq("crawl_id", guestCrawl());
    if (actions.error || !actions.data || !actions.data.length) return;
    var shops = await client.rpc("get_public_crawl_shops", { p_crawl: guestCrawl() });
    if (shops.error || !Array.isArray(shops.data)) return;
    var match = null;
    var shop = null;
    actions.data.some(function (action) {
      var found = shops.data.find(function (row) {
        return row && row.listing_id === action.listing_id && stamped[row.business_id];
      });
      if (!found) return false;
      match = action;
      shop = found;
      return true;
    });
    if (!match) return;
    showBonus(match, shop);
  }

  function fileError(file) {
    if (!file) return "Choose a photo.";
    var type = file.type === "image/jpg" ? "image/jpeg" : file.type;
    if (TYPES.indexOf(type) === -1) return "Use a PNG, JPG, or WebP image.";
    if (file.size > MAX_BYTES) return "Photos need to be 5 MB or smaller.";
    return "";
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { reject(new Error("Could not read that photo.")); };
      reader.readAsDataURL(file);
    });
  }

  function resizePhoto(file) {
    return new Promise(function (resolve) {
      function finish(blob, width, height, revoke) {
        if (revoke) revoke();
        try {
          if (!blob || !blob.size) { resolve(file); return; }
          var longSide = Math.max(width || 0, height || 0);
          if (longSide && longSide <= 1600 && blob.size >= file.size) { resolve(file); return; }
          var base = String(file.name || "photo").replace(/\.[^.]+$/, "") || "photo";
          resolve(new File([blob], base + ".jpg", { type: "image/jpeg", lastModified: Date.now() }));
        } catch (e) {
          resolve(file);
        }
      }
      function draw(source, width, height, revoke) {
        try {
          var longSide = Math.max(width || 0, height || 0);
          if (!longSide) { finish(null, 0, 0, revoke); return; }
          var scale = Math.min(1, 1600 / longSide);
          var canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(width * scale));
          canvas.height = Math.max(1, Math.round(height * scale));
          var ctx = canvas.getContext("2d");
          if (!ctx) { finish(null, 0, 0, revoke); return; }
          ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(function (blob) { finish(blob, width, height, revoke); }, "image/jpeg", 0.8);
        } catch (e) {
          finish(null, 0, 0, revoke);
        }
      }
      function loadImage() {
        var url = "";
        try { url = URL.createObjectURL(file); } catch (e) { resolve(file); return; }
        var img = new Image();
        var revoke = function () { try { URL.revokeObjectURL(url); } catch (e) {} };
        img.onload = function () { draw(img, img.naturalWidth || img.width, img.naturalHeight || img.height, revoke); };
        img.onerror = function () { finish(null, 0, 0, revoke); };
        img.src = url;
      }
      if (typeof createImageBitmap === "function") {
        createImageBitmap(file, { imageOrientation: "from-image" }).then(function (bmp) {
          draw(bmp, bmp.width, bmp.height, function () { try { if (bmp.close) bmp.close(); } catch (e) {} });
        }).catch(function () { loadImage(); });
        return;
      }
      loadImage();
    });
  }

  async function preparePhoto(file) {
    var next = file;
    try { next = await resizePhoto(file); } catch (e) { next = file; }
    if (!next) next = file;
    var type = next.type === "image/jpg" ? "image/jpeg" : next.type;
    if (TYPES.indexOf(type) === -1) {
      next = file;
      type = file.type === "image/jpg" ? "image/jpeg" : file.type;
    }
    var ext = type === "image/png" ? "png" : (type === "image/webp" ? "webp" : "jpg");
    return { file: next, type: type, ext: ext };
  }

  var PHOTO_PAGE = 12;
  var shownCounts = { gallery: PHOTO_PAGE, mine: PHOTO_PAGE, moderation: PHOTO_PAGE };

  function lazyImg(src, alt, style) {
    return '<img src="' + esc(src) + '" alt="' + esc(alt || "") + '" loading="lazy" decoding="async"' +
      (style ? ' style="' + style + '"' : "") + ">";
  }

  function withMore(html, shown, total, which) {
    if (total <= shown) return html;
    return html + '<p class="photo-more" style="grid-column:1 / -1;margin:0.35rem 0 0"><button type="button" class="btn btn-soft" data-more-photos="' + which + '">Show more</button></p>';
  }

  function paintMine() {
    var box = document.getElementById("my-photos");
    if (!box) return;
    var mine = demoOn()
      ? photos().filter(function (row) { return row.owner === "demo" || row.owner === "me"; })
      : liveMine.filter(function (row) { return row.src; });
    var visible = mine.slice(0, shownCounts.mine);
    box.innerHTML = withMore(visible.map(function (row) {
      return "<figure>" + lazyImg(row.src, "") + '<button type="button" data-delete-photo="' + esc(row.id) + '">Delete</button><p class="small muted">' + esc(row.status) + "</p></figure>";
    }).join(""), shownCounts.mine, mine.length, "mine");
  }

  var liveGallery = [];
  var liveMine = [];
  var liveModeration = [];
  var SIGN_TTL = 86400;
  var SIGN_REUSE_MS = 5 * 60 * 1000;
  var SIGN_CACHE_KEY = "hc-guest-photo-urls";
  var THUMB = { width: 640, height: 640, quality: 70, resize: "cover" };

  function signCacheId(path, transform) {
    return [path, transform.width || 0, transform.height || 0, transform.quality, transform.resize].join(":");
  }

  function readSignStore() {
    try {
      var parsed = JSON.parse(localStorage.getItem(SIGN_CACHE_KEY) || "null");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function readCachedUrl(path, transform) {
    var row = readSignStore()[signCacheId(path, transform)];
    if (!row || !row.url || !row.exp) return "";
    if (String(row.url).indexOf("/render/image/") === -1) return "";
    if (row.exp <= Date.now() + SIGN_REUSE_MS) return "";
    return row.url;
  }

  function writeCachedUrl(path, transform, url) {
    if (!url || String(url).indexOf("/render/image/") === -1) return;
    try {
      var store = readSignStore();
      var now = Date.now();
      Object.keys(store).forEach(function (key) {
        var row = store[key];
        if (!row || !row.exp || row.exp <= now) delete store[key];
      });
      store[signCacheId(path, transform)] = { url: url, exp: now + SIGN_TTL * 1000 };
      localStorage.setItem(SIGN_CACHE_KEY, JSON.stringify(store));
    } catch (e) {}
  }

  function signedSrc(path, transform) {
    var size = transform || THUMB;
    var hit = readCachedUrl(path, size);
    if (hit) return Promise.resolve(hit);
    return signedUrls([path], size).then(function (urls) { return urls[path] || ""; });
  }

  async function signedUrls(paths, transform) {
    var size = transform || THUMB;
    var unique = [];
    var seen = {};
    (paths || []).forEach(function (path) {
      if (!path || seen[path]) return;
      seen[path] = true;
      unique.push(path);
    });
    var out = {};
    var missing = [];
    unique.forEach(function (path) {
      var hit = readCachedUrl(path, size);
      if (hit) out[path] = hit;
      else missing.push(path);
    });
    if (!missing.length || !window.HCCrawl || !HCCrawl.client) return out;
    var bucket = HCCrawl.client().storage.from("guest-photos");
    if (typeof bucket.createSignedUrls === "function") {
      try {
        var batch = await bucket.createSignedUrls(missing, SIGN_TTL, { transform: size });
        var data = batch && batch.data;
        if (Array.isArray(data)) {
          data.forEach(function (item) {
            if (!item || !item.path || !item.signedUrl) return;
            // Current supabase-js createSignedUrls ignores transform and
            // returns the original object. Only keep a batch URL when the
            // resize actually landed on the render endpoint.
            if (String(item.signedUrl).indexOf("/render/image/") === -1) return;
            out[item.path] = item.signedUrl;
            writeCachedUrl(item.path, size, item.signedUrl);
          });
        }
      } catch (e) {}
    }
    var still = missing.filter(function (path) { return !out[path]; });
    if (still.length && typeof bucket.createSignedUrl === "function") {
      await Promise.all(still.map(function (path) {
        return bucket.createSignedUrl(path, SIGN_TTL, { transform: size }).then(function (res) {
          var url = (res && res.data && res.data.signedUrl) || "";
          if (!url) return;
          out[path] = url;
          writeCachedUrl(path, size, url);
        }).catch(function () {});
      }));
    }
    return out;
  }

  async function withSigned(rows, mapRow) {
    var list = Array.isArray(rows) ? rows : [];
    var urls = await signedUrls(list.map(function (row) { return row && row.path; }), THUMB);
    return list.map(function (row) {
      return mapRow(row, (row && urls[row.path]) || "");
    });
  }

  async function loadLivePhotos() {
    if (demoOn() || !window.HCCrawl || !HCCrawl.client) return;
    var client = HCCrawl.client();
    var pub = await client.rpc("get_public_crawl_photos", { p_crawl: guestCrawl() });
    if (!pub.error && Array.isArray(pub.data)) {
      liveGallery = await withSigned(pub.data, function (row, src) {
        return { id: row.id, src: src, status: "approved" };
      });
      paintGallery();
    }
    var session = await HCCrawl.getSession();
    if (!session || !session.user || session.user.is_anonymous) return;
    var mine = await client.from("guest_photos").select("id, path, status, shop_id").eq("user_id", session.user.id);
    if (!mine.error && Array.isArray(mine.data)) {
      liveMine = await withSigned(mine.data, function (row, src) {
        return { id: row.id, src: src, status: row.status, shop: row.shop_id || "" };
      });
      paintMine();
    }
    if (!document.getElementById("org-photos")) return;
    var mod = await client.rpc("organizer_list_guest_photos", { p_crawl: guestCrawl() });
    if (mod.error || !Array.isArray(mod.data)) return;
    liveModeration = await withSigned(mod.data, function (row, src) {
      return { id: row.id, src: src, status: row.status, shop: row.shop_id || "Crawl photo" };
    });
    paintModeration();
  }

  function paintGallery() {
    var box = document.getElementById("photo-gallery");
    if (!box) return;
    var approved = demoOn()
      ? photos().filter(function (row) { return row.status === "approved"; })
      : liveGallery.filter(function (row) { return row.src; });
    if (!approved.length) {
      box.innerHTML = "";
      return;
    }
    var visible = approved.slice(0, shownCounts.gallery);
    box.innerHTML = withMore(visible.map(function (row) {
      return "<figure>" + lazyImg(row.src, "Crawl photo") + "</figure>";
    }).join(""), shownCounts.gallery, approved.length, "gallery");
  }

  function paintModeration() {
    var box = document.getElementById("org-photos");
    if (!box) return;
    var rows = demoOn() ? photos() : liveModeration;
    if (!rows.length) {
      box.innerHTML = '<p class="muted small">No photos yet.</p>';
      return;
    }
    var visible = rows.slice(0, shownCounts.moderation);
    box.innerHTML = withMore(visible.map(function (row) {
      return '<article class="record-card">' + lazyImg(row.src, "", "width:100%;max-height:160px;object-fit:cover;border-radius:10px") + '<p class="small">' +
        esc(row.shop || "Crawl photo") + " · " + esc(row.status) + "</p>" +
        '<div class="row"><button class="btn btn-soft" type="button" data-photo-status="approved" data-photo-id="' + esc(row.id) + '">Approve</button>' +
        '<button class="btn btn-ghost" type="button" data-photo-status="hidden" data-photo-id="' + esc(row.id) + '">Hide</button></div></article>';
    }).join(""), shownCounts.moderation, rows.length, "moderation");
  }

  function setStatus(id, status) {
    var items = photos().map(function (row) {
      if (row.id === id) row.status = status;
      return row;
    });
    savePhotos(items);
    paintMine();
    paintGallery();
    paintModeration();
  }

  async function onPhotoSubmit(ev, fileId, consentId, shopId, okId, errId) {
    ev.preventDefault();
    note(okId, errId, "", "");
    var consent = document.getElementById(consentId);
    if (!consent || !consent.checked) {
      note(okId, errId, "", CONSENT);
      return;
    }
    var input = document.getElementById(fileId);
    var file = input && input.files && input.files[0];
    var problem = fileError(file);
    if (problem) { note(okId, errId, "", problem); return; }
    if (demoOn()) {
      var src = await readFile(file);
      var shop = shopId ? (document.getElementById(shopId) || {}).value : "";
      var items = photos();
      items.unshift({
        id: String(Date.now()),
        src: src,
        shop: String(shop || "").trim(),
        status: "pending",
        owner: "demo",
        consent: CONSENT
      });
      savePhotos(items);
      if (input) input.value = "";
      consent.checked = false;
      note(okId, errId, "DEMO DATA. Saved in this browser as pending. An organizer can approve it here. Nothing was uploaded.", "");
      paintMine();
      paintModeration();
      return;
    }
    if (!window.HCCrawl || !HCCrawl.client) {
      note(okId, errId, "", "Sign in with email before uploading a photo.");
      return;
    }
    var session = await HCCrawl.getSession();
    if (!session || !session.user || session.user.is_anonymous || !session.user.email) {
      note(okId, errId, "", "Sign in with email before uploading a photo.");
      return;
    }
    var prepared = await preparePhoto(file);
    var type = prepared.type;
    var ext = prepared.ext;
    var path = session.user.id + "/" + (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())) + "." + ext;
    var client = HCCrawl.client();
    var uploaded = await client.storage.from("guest-photos").upload(path, prepared.file, {
      contentType: type,
      upsert: false,
      cacheControl: "31536000"
    });
    if (uploaded.error) {
      var uploadMessage = uploaded.error.message || "Could not upload that photo.";
      if (/guest-photos|bucket/i.test(uploadMessage)) uploadMessage = "Photos save after the database update is applied.";
      note(okId, errId, "", uploadMessage);
      return;
    }
    var shop = shopId ? (document.getElementById(shopId) || {}).value : "";
    var inserted = await client.from("guest_photos").insert({
      user_id: session.user.id,
      crawl_id: guestCrawl(),
      shop_id: String(shop || "").trim() || null,
      path: path,
      consent_at: new Date().toISOString(),
      status: "pending"
    });
    if (inserted.error) {
      await client.storage.from("guest-photos").remove([path]);
      var insertMessage = inserted.error.message || "Could not save that photo.";
      if (/guest_photos|schema cache|relation/i.test(insertMessage)) insertMessage = "Photos save after the database update is applied.";
      note(okId, errId, "", insertMessage);
      return;
    }
    if (input) input.value = "";
    consent.checked = false;
    var savedNote = guestCrawl() === "arl-coffee"
      ? "Uploaded. It stays pending until an organizer or contributor approves it. It does not change your stamp."
      : "Uploaded. It stays pending until an organizer or contributor approves it. It does not add a prize entry, and your stamp is unchanged.";
    note(okId, errId, savedNote, "");
    loadLivePhotos();
  }

  document.addEventListener("DOMContentLoaded", function () {
    var store = window.__HC_ENV__ && window.__HC_ENV__.DEMO_STORE;
    var stamped = demoOn() ? ((store && store.sampleStamps) || 5) : 0;
    paintEntries(15, stamped);
    refreshBonus();
    paintMine();
    paintGallery();
    paintModeration();
    if (!demoOn()) loadLivePhotos();

    if (window.HCCrawl && HCCrawl.loadShops && !demoOn()) {
      HCCrawl.loadShops(guestCrawl()).then(function (res) {
        var count = (res.shops || []).length;
        HCCrawl.myStamps(guestCrawl()).then(function (rows) {
          paintEntries(count, (rows || []).length);
        });
      }).catch(function () {});
    } else if (window.HCCrawl && HCCrawl.loadShops && demoOn()) {
      HCCrawl.loadShops(guestCrawl()).then(function (res) {
        var count = (res.shops || []).length || 15;
        paintEntries(count, stamped);
      }).catch(function () { paintEntries(15, stamped); });
    }

    var guestForm = document.getElementById("guest-photo-form");
    if (guestForm) {
      guestForm.onsubmit = function (ev) {
        onPhotoSubmit(ev, "guest-photo-file", "guest-photo-consent", "guest-photo-shop", "guest-photo-ok", "guest-photo-err");
      };
    }
    var crawlForm = document.getElementById("crawl-photo-form");
    if (crawlForm) {
      crawlForm.onsubmit = function (ev) {
        onPhotoSubmit(ev, "crawl-photo-file", "crawl-photo-consent", "", "crawl-photo-ok", "crawl-photo-err");
      };
    }
    document.body.addEventListener("click", function (ev) {
      var more = ev.target.closest && ev.target.closest("[data-more-photos]");
      if (more) {
        var which = more.getAttribute("data-more-photos");
        if (!shownCounts[which]) return;
        shownCounts[which] += PHOTO_PAGE;
        if (which === "gallery") paintGallery();
        else if (which === "mine") paintMine();
        else paintModeration();
        return;
      }
      var del = ev.target.closest && ev.target.closest("[data-delete-photo]");
      if (del) {
        var id = del.getAttribute("data-delete-photo");
        if (demoOn()) {
          savePhotos(photos().filter(function (row) { return row.id !== id; }));
          paintMine();
          paintGallery();
          paintModeration();
          return;
        }
        HCCrawl.client().from("guest_photos").delete().eq("id", id).then(function () { loadLivePhotos(); });
        return;
      }
      var mod = ev.target.closest && ev.target.closest("[data-photo-status]");
      if (mod) {
        if (demoOn()) {
          setStatus(mod.getAttribute("data-photo-id"), mod.getAttribute("data-photo-status"));
          return;
        }
        HCCrawl.client().rpc("moderate_guest_photo", {
          p_id: mod.getAttribute("data-photo-id"),
          p_status: mod.getAttribute("data-photo-status")
        }).then(function () { loadLivePhotos(); });
      }
    });
    var confirmBtn = document.getElementById("bonus-confirm");
    if (confirmBtn) {
      confirmBtn.onclick = function () {
        if (demoOn()) {
          localStorage.setItem(BONUS_KEY, JSON.stringify({ done: true }));
          paintEntries(15, stamped);
          note("bonus-ok", null, "DEMO DATA. Counted on this browser only. It was not sent to the shop.", "");
          return;
        }
        if (!window.HCCrawl || !HCCrawl.client) return;
        HCCrawl.getSession().then(async function (session) {
          var okBox = document.getElementById("bonus-ok");
          if (!session || !session.user || session.user.is_anonymous || !session.user.email) {
            if (okBox) { okBox.textContent = "Sign in with email to submit this bonus."; okBox.classList.add("show"); }
            return;
          }
          var client = HCCrawl.client();
          if (!shownActionId) {
            if (okBox) { okBox.textContent = "Shop bonuses save after the database update is applied."; okBox.classList.add("show"); }
            return;
          }
          var action = { id: shownActionId };
          var proof = (document.getElementById("bonus-proof") || {}).value || "";
          var saved = await client.rpc("guest_submit_bonus", { p_action: action.id, p_proof: proof });
          if (saved.error) {
            if (okBox) { okBox.textContent = saved.error.message || "Could not submit that bonus."; okBox.classList.add("show"); }
            return;
          }
          if (okBox) { okBox.textContent = "Submitted. The shop can approve it. A pending bonus does not change your stamp."; okBox.classList.add("show"); }
        });
      };
    }
  });

  window.HCGuest = { refreshBonus: refreshBonus, crawlId: guestCrawl };
})();
