/* Prize entries, optional shop bonus, and guest photos.
   ?demo=1 stays in this browser. It does not stamp, join, or upload. */
(function () {
  var PHOTO_KEY = "hc-guest-photos";
  var BONUS_KEY = "hc-bonus-claims";
  var CONSENT = "I give Hometown Crawls permission to show this photo on its website and social pages.";
  var MAX_BYTES = 5 * 1024 * 1024;
  var TYPES = ["image/png", "image/jpeg", "image/webp"];

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
    var stamps = await HCCrawl.myStamps("puy-coffee");
    var stamped = {};
    (stamps || []).forEach(function (row) { if (row && row.business_id) stamped[row.business_id] = true; });
    if (!Object.keys(stamped).length) return;
    var client = HCCrawl.client();
    var actions = await client.from("bonus_actions").select("id, listing_id, kind, label, url, entries").eq("active", true).eq("crawl_id", "puy-coffee");
    if (actions.error || !actions.data || !actions.data.length) return;
    var shops = await client.rpc("get_public_crawl_shops", { p_crawl: "puy-coffee" });
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

  function paintMine() {
    var box = document.getElementById("my-photos");
    if (!box) return;
    var mine = demoOn()
      ? photos().filter(function (row) { return row.owner === "demo" || row.owner === "me"; })
      : liveMine.filter(function (row) { return row.src; });
    box.innerHTML = mine.map(function (row) {
      return '<figure><img src="' + esc(row.src) + '" alt=""><button type="button" data-delete-photo="' + esc(row.id) + '">Delete</button><p class="small muted">' + esc(row.status) + "</p></figure>";
    }).join("");
  }

  var liveGallery = [];
  var liveMine = [];
  var liveModeration = [];

  function signedSrc(path) {
    return HCCrawl.client().storage.from("guest-photos").createSignedUrl(path, 3600).then(function (out) {
      return (out && out.data && out.data.signedUrl) || "";
    }).catch(function () { return ""; });
  }

  async function loadLivePhotos() {
    if (demoOn() || !window.HCCrawl || !HCCrawl.client) return;
    var client = HCCrawl.client();
    var pub = await client.rpc("get_public_crawl_photos", { p_crawl: "puy-coffee" });
    if (!pub.error && Array.isArray(pub.data)) {
      liveGallery = await Promise.all(pub.data.map(async function (row) {
        return { id: row.id, src: await signedSrc(row.path), status: "approved" };
      }));
      paintGallery();
    }
    var session = await HCCrawl.getSession();
    if (!session || !session.user || session.user.is_anonymous) return;
    var mine = await client.from("guest_photos").select("id, path, status, shop_id").eq("user_id", session.user.id);
    if (!mine.error && Array.isArray(mine.data)) {
      liveMine = await Promise.all(mine.data.map(async function (row) {
        return { id: row.id, src: await signedSrc(row.path), status: row.status, shop: row.shop_id || "" };
      }));
      paintMine();
    }
    if (!document.getElementById("org-photos")) return;
    var mod = await client.rpc("organizer_list_guest_photos", { p_crawl: "puy-coffee" });
    if (mod.error || !Array.isArray(mod.data)) return;
    liveModeration = await Promise.all(mod.data.map(async function (row) {
      return { id: row.id, src: await signedSrc(row.path), status: row.status, shop: row.shop_id || "Crawl photo" };
    }));
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
    box.innerHTML = approved.map(function (row) {
      return '<figure><img src="' + esc(row.src) + '" alt="Crawl photo"></figure>';
    }).join("");
  }

  function paintModeration() {
    var box = document.getElementById("org-photos");
    if (!box) return;
    var rows = demoOn() ? photos() : liveModeration;
    if (!rows.length) {
      box.innerHTML = '<p class="muted small">No photos yet.</p>';
      return;
    }
    box.innerHTML = rows.map(function (row) {
      return '<article class="record-card"><img src="' + esc(row.src) + '" alt="" style="width:100%;max-height:160px;object-fit:cover;border-radius:10px"><p class="small">' +
        esc(row.shop || "Crawl photo") + " · " + esc(row.status) + "</p>" +
        '<div class="row"><button class="btn btn-soft" type="button" data-photo-status="approved" data-photo-id="' + esc(row.id) + '">Approve</button>' +
        '<button class="btn btn-ghost" type="button" data-photo-status="hidden" data-photo-id="' + esc(row.id) + '">Hide</button></div></article>';
    }).join("");
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
    var type = file.type === "image/jpg" ? "image/jpeg" : file.type;
    var ext = type === "image/png" ? "png" : (type === "image/webp" ? "webp" : "jpg");
    var path = session.user.id + "/" + (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())) + "." + ext;
    var client = HCCrawl.client();
    var uploaded = await client.storage.from("guest-photos").upload(path, file, { contentType: type, upsert: false });
    if (uploaded.error) {
      var uploadMessage = uploaded.error.message || "Could not upload that photo.";
      if (/guest-photos|bucket/i.test(uploadMessage)) uploadMessage = "Photos save after the database update is applied.";
      note(okId, errId, "", uploadMessage);
      return;
    }
    var shop = shopId ? (document.getElementById(shopId) || {}).value : "";
    var inserted = await client.from("guest_photos").insert({
      user_id: session.user.id,
      crawl_id: "puy-coffee",
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
    note(okId, errId, "Uploaded. It stays pending until an organizer or contributor approves it. It does not add a prize entry, and your stamp is unchanged.", "");
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
      HCCrawl.loadShops("puy-coffee").then(function (res) {
        var count = (res.shops || []).length;
        HCCrawl.myStamps("puy-coffee").then(function (rows) {
          paintEntries(count, (rows || []).length);
        });
      }).catch(function () {});
    } else if (window.HCCrawl && HCCrawl.loadShops && demoOn()) {
      HCCrawl.loadShops("puy-coffee").then(function (res) {
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

  window.HCGuest = { refreshBonus: refreshBonus };
})();
