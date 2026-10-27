/* Organizer tab. Demo mode shows Bryan's crawls with labeled sample data.
   Invite links are created locally in the demo and are not emailed. */
(function () {
  var KEY = "hc-organizer-demo";

  function fixture() {
    return (window.__HC_ENV__ && window.__HC_ENV__.DEMO_ORGANIZER) || null;
  }

  function demoOn() {
    return new URLSearchParams(location.search).get("demo") === "1";
  }

  function esc(value) {
    return window.HCStoreDemo && HCStoreDemo.esc ? HCStoreDemo.esc(value) : String(value || "");
  }

  function loadState(base) {
    var state = {
      active: base.crawls[0].id,
      crawls: JSON.parse(JSON.stringify(base.crawls)),
      invites: []
    };
    try {
      var saved = JSON.parse(localStorage.getItem(KEY) || "null");
      if (saved && Array.isArray(saved.crawls)) {
        saved.crawls.forEach(function (row) {
          var match = state.crawls.filter(function (c) { return c.id === row.id; })[0];
          if (!match) return;
          if (row.title) match.title = String(row.title).slice(0, 120);
          if (row.starts) match.starts = row.starts;
          if (row.ends) match.ends = row.ends;
          if (typeof row.videoUrl === "string") match.videoUrl = row.videoUrl.slice(0, 500);
          if (Array.isArray(row.stores)) {
            row.stores.forEach(function (saved) {
              var shop = (match.stores || []).filter(function (item) { return item.name === saved.name; })[0];
              if (shop && saved.visible === false) shop.visible = false;
            });
          }
        });
      }
      if (saved && Array.isArray(saved.invites)) state.invites = saved.invites;
      if (saved && saved.active && state.crawls.some(function (c) { return c.id === saved.active; })) state.active = saved.active;
    } catch (e) {}
    return state;
  }

  function saveState(state) {
    localStorage.setItem(KEY, JSON.stringify({
      active: state.active,
      crawls: state.crawls.map(function (c) {
        return {
          id: c.id,
          title: c.title,
          starts: c.starts,
          ends: c.ends,
          videoUrl: c.videoUrl || "",
          stores: (c.stores || []).map(function (row) { return { name: row.name, visible: row.visible !== false }; })
        };
      }),
      invites: state.invites
    }));
  }

  function activeCrawl(state) {
    return state.crawls.filter(function (c) { return c.id === state.active; })[0] || state.crawls[0];
  }

  function guestsFor(crawl) {
    var store = window.__HC_ENV__ && window.__HC_ENV__.DEMO_STORE;
    var rows = (store && store.guests) || [];
    return rows.filter(function (row) { return row && row.consentedAt; }).map(function (row) {
      return {
        name: row.name,
        email: row.email,
        crawlsJoined: crawl.title,
        stamps: row.stamps,
        consentedAt: row.consentedAt
      };
    });
  }

  function render(state, person) {
    var crawl = activeCrawl(state);
    var picker = document.getElementById("org-crawl");
    if (picker) {
      picker.innerHTML = state.crawls.map(function (c) {
        return '<option value="' + esc(c.id) + '">' + esc(c.title) + "</option>";
      }).join("");
      picker.value = crawl.id;
    }
    var title = document.getElementById("org-title");
    var start = document.getElementById("org-start");
    var end = document.getElementById("org-end");
    if (title && document.activeElement !== title) title.value = crawl.title || "";
    if (start && document.activeElement !== start) start.value = crawl.starts || "";
    if (end && document.activeElement !== end) end.value = crawl.ends || "";
    var video = document.getElementById("org-video");
    if (video && document.activeElement !== video) video.value = crawl.videoUrl || "";
    var who = document.getElementById("org-who");
    if (who) who.textContent = person.name + " · " + person.email + " · " + person.role;

    var stores = crawl.stores || [];
    var scans = stores.reduce(function (sum, row) { return sum + Number(row.scans || 0); }, 0);
    var paid = stores.filter(function (row) { return row.paid; }).length;
    var set = function (id, value) {
      var el = document.getElementById(id);
      if (el) el.textContent = String(value);
    };
    set("org-total-stores", stores.length);
    set("org-total-paid", paid);
    set("org-total-unpaid", stores.length - paid);
    set("org-total-scans", scans);

    var list = document.getElementById("org-stores");
    if (list) {
      list.innerHTML = stores.map(function (row) {
        var pay = row.paid
          ? '<span class="pill pill-ok">Paid</span>'
          : '<span class="pill pill-wait">Unpaid</span>';
        var shown = row.visible !== false;
        return '<article class="record-card"><b class="record-name">' + esc(row.name) + '</b><p class="record-email">' +
          esc(row.code) + ' · ' + esc(row.scans) + ' scans · DEMO DATA</p><div class="record-chips">' + pay +
          '</div><label class="check"><input type="checkbox" data-visible="' + esc(row.name) + '"' +
          (shown ? " checked" : "") + "> Show on the passport</label></article>";
      }).join("");
    }

    var people = document.getElementById("co-list");
    if (people) {
      var mine = '<article class="record-card"><b class="record-name">Chris Miller</b><p class="record-email">chris@beekings.com</p><span class="chip">owner</span></article>' +
        '<article class="record-card"><b class="record-name">' + esc(person.name) + '</b><p class="record-email">' +
        esc(person.email) + '</p><span class="chip">' + esc(person.role) + "</span></article>" +
        '<article class="record-card"><b class="record-name">Contributor</b><p class="record-email">No store required. The migration does not replace the owner.</p><span class="chip">contributor</span></article>';
      var pending = state.invites.filter(function (row) { return row.crawlId === crawl.id; }).map(function (row) {
        return '<article class="guest-card"><b>' + esc(row.email) + '</b><div class="row mt-1"><span class="pill pill-wait">Pending invite</span><span class="pill pill-muted">co-organizer</span></div><p class="small mt-1" style="overflow-wrap:anywhere">' +
          esc(row.link) + "</p></article>";
      }).join("");
      people.innerHTML = mine + pending;
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    var base = fixture();
    if (!base || !demoOn() || !document.getElementById("panel-organizer")) return;
    var state = loadState(base);
    render(state, base.person);

    var storeList = document.getElementById("org-stores");
    if (storeList) {
      storeList.addEventListener("change", function (ev) {
        var box = ev.target.closest && ev.target.closest("[data-visible]");
        if (!box) return;
        var crawl = activeCrawl(state);
        (crawl.stores || []).forEach(function (row) {
          if (row.name === box.getAttribute("data-visible")) row.visible = box.checked;
        });
        saveState(state);
      });
    }

    var picker = document.getElementById("org-crawl");
    if (picker) {
      picker.onchange = function () {
        state.active = picker.value;
        saveState(state);
        render(state, base.person);
      };
    }

    var details = document.getElementById("org-details");
    if (details) {
      details.onsubmit = function (ev) {
        ev.preventDefault();
        var crawl = activeCrawl(state);
        var title = document.getElementById("org-title").value.trim();
        var start = document.getElementById("org-start").value;
        var end = document.getElementById("org-end").value;
        var videoUrl = document.getElementById("org-video") ? document.getElementById("org-video").value.trim() : "";
        var err = document.getElementById("org-err");
        var ok = document.getElementById("org-ok");
        if (err) { err.textContent = ""; err.classList.remove("show"); }
        if (ok) { ok.textContent = ""; ok.classList.remove("show"); }
        if (!title || title.length > 120) {
          if (err) { err.textContent = "Title needs 1–120 characters."; err.classList.add("show"); }
          return;
        }
        if (!start || !end || end < start) {
          if (err) { err.textContent = "End date needs to be on or after the start date."; err.classList.add("show"); }
          return;
        }
        if (window.HCVideo && HCVideo.problem(videoUrl)) {
          if (err) { err.textContent = HCVideo.problem(videoUrl); err.classList.add("show"); }
          return;
        }
        crawl.title = title;
        crawl.starts = start;
        crawl.ends = end;
        crawl.videoUrl = videoUrl;
        saveState(state);
        render(state, base.person);
        if (ok) { ok.textContent = "DEMO DATA. Title and dates saved in this browser only."; ok.classList.add("show"); }
        if (window.HC) HC.toast("Crawl details saved");
      };
    }

    var csv = document.getElementById("btn-org-csv");
    if (csv) {
      csv.onclick = function () {
        var crawl = activeCrawl(state);
        if (window.HCStoreDemo) HCStoreDemo.downloadGuests(guestsFor(crawl), crawl.id);
        if (window.HC) HC.toast("Guest CSV downloaded");
      };
    }

    var invite = document.getElementById("co-invite-form");
    if (invite) {
      invite.onsubmit = function (ev) {
        ev.preventDefault();
        var email = document.getElementById("co-email").value.trim().toLowerCase();
        var err = document.getElementById("co-err");
        var ok = document.getElementById("co-ok");
        if (err) { err.textContent = ""; err.classList.remove("show"); }
        if (ok) { ok.textContent = ""; ok.classList.remove("show"); }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          if (err) { err.textContent = "Enter a valid email address."; err.classList.add("show"); }
          return;
        }
        var token = (window.crypto && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, "") : String(Date.now());
        var link = location.origin + "/account?tab=organizer&demo=1&invite=" + token;
        state.invites.push({ crawlId: activeCrawl(state).id, email: email, token: token, link: link, role: "co-organizer" });
        saveState(state);
        document.getElementById("co-email").value = "";
        render(state, base.person);
        if (ok) {
          ok.textContent = "Invite recorded for " + email + ". Nothing was emailed. Share the link yourself.";
          ok.classList.add("show");
        }
        if (window.HC) HC.toast("Invite link ready");
      };
    }

    var params = new URLSearchParams(location.search);
    if (params.get("invite")) {
      var banner = document.getElementById("org-invite-banner");
      if (banner) {
        banner.classList.remove("hidden");
        banner.textContent = "DEMO DATA. This invite link is recorded only. No email was sent, and it does not change live organizer access.";
      }
    }
  });

  function dateOnly(value) {
    return value ? String(value).slice(0, 10) : "";
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (demoOn() || !document.getElementById("panel-organizer") || !window.HCCrawl || !HCCrawl.client) return;
    var crawls = [];
    var shops = [];
    var team = [];
    var active = "";

    function showTab() {
      var tabs = document.getElementById("role-tabs");
      var btn = document.getElementById("tab-organizer");
      if (tabs) tabs.classList.remove("hidden");
      if (btn) btn.classList.remove("hidden");
      if (window.HCStoreDemo && HCStoreDemo.openRequestedTab) HCStoreDemo.openRequestedTab();
    }

    function current() {
      return crawls.filter(function (row) { return row.crawl_id === active; })[0] || crawls[0];
    }

    function renderLive() {
      var crawl = current();
      if (!crawl) return;
      active = crawl.crawl_id;
      var picker = document.getElementById("org-crawl");
      if (picker) {
        picker.innerHTML = crawls.map(function (row) {
          return '<option value="' + esc(row.crawl_id) + '">' + esc(row.name) + "</option>";
        }).join("");
        picker.value = active;
      }
      var title = document.getElementById("org-title");
      var start = document.getElementById("org-start");
      var end = document.getElementById("org-end");
      if (title && document.activeElement !== title) title.value = crawl.name || "";
      if (start && document.activeElement !== start) start.value = dateOnly(crawl.starts_at);
      if (end && document.activeElement !== end) end.value = dateOnly(crawl.ends_at);
      var video = document.getElementById("org-video");
      if (video && document.activeElement !== video) video.value = crawl.video_url || "";
      var who = document.getElementById("org-who");
      if (who) who.textContent = (crawl.role || "organizer") + " · shop fees are not split";
      var scans = shops.reduce(function (sum, row) { return sum + Number(row.scans || 0); }, 0);
      var paid = shops.filter(function (row) { return row.is_paid; }).length;
      ["org-total-stores", "org-total-paid", "org-total-unpaid", "org-total-scans"].forEach(function (id, index) {
        var el = document.getElementById(id);
        var values = [shops.length, paid, shops.length - paid, scans];
        if (el) el.textContent = String(values[index]);
      });
      var list = document.getElementById("org-stores");
      if (list) {
        list.innerHTML = shops.map(function (row) {
          var pay = row.is_paid ? '<span class="pill pill-ok">Paid</span>' : '<span class="pill pill-wait">Unpaid</span>';
          return '<article class="record-card"><b class="record-name">' + esc(row.display_name) + '</b><p class="record-email">' +
            esc(row.scans || 0) + ' scans</p><div class="record-chips">' + pay +
            '</div><div class="row mt-1"><button class="btn btn-soft" type="button" data-edit-shop="' + esc(row.listing_id) +
            '">Edit</button></div><label class="check"><input type="checkbox" data-listing="' +
            esc(row.listing_id) + '"' + (row.is_visible ? " checked" : "") + "> Show on the passport</label></article>";
        }).join("") || '<p class="muted small">No stores yet.</p>';
      }
      var people = document.getElementById("co-list");
      if (people) {
        people.innerHTML = team.map(function (row) {
          return '<article class="record-card"><b class="record-name">' + esc(row.name || row.email) + '</b><p class="record-email">' +
            esc(row.email) + '</p><span class="chip">' + esc(row.role) + "</span></article>";
        }).join("") || '<p class="muted small">No teammates loaded.</p>';
      }
    }

    async function loadShops() {
      var res = await HCCrawl.client().rpc("organizer_crawl_shops", { p_crawl: active });
      shops = res.error ? [] : (res.data || []);
    }

    async function loadTeam() {
      var res = await HCCrawl.client().rpc("organizer_list_co_organizers", { p_crawl_id: active });
      team = res.error ? [] : (res.data || []);
    }

    HCCrawl.getSession().then(async function (session) {
      if (!session || !session.user || session.user.is_anonymous || !session.user.email) return;
      var mine = await HCCrawl.client().rpc("organizer_my_crawls");
      if (mine.error || !mine.data || !mine.data.length) return;
      crawls = mine.data;
      active = crawls[0].crawl_id;
      showTab();
      await loadShops();
      await loadTeam();
      renderLive();
    }).catch(function () {});

    var picker = document.getElementById("org-crawl");
    if (picker) {
      picker.addEventListener("change", async function () {
        if (demoOn()) return;
        active = picker.value;
        await loadShops();
        await loadTeam();
        renderLive();
      });
    }

    var details = document.getElementById("org-details");
    if (details) {
      details.addEventListener("submit", async function (ev) {
        if (demoOn()) return;
        ev.preventDefault();
        var err = document.getElementById("org-err");
        var ok = document.getElementById("org-ok");
        if (err) { err.textContent = ""; err.classList.remove("show"); }
        if (ok) { ok.textContent = ""; ok.classList.remove("show"); }
        var title = document.getElementById("org-title").value.trim();
        var start = document.getElementById("org-start").value;
        var end = document.getElementById("org-end").value;
        var videoUrl = document.getElementById("org-video") ? document.getElementById("org-video").value.trim() : "";
        if (!title || !start || !end || end < start) {
          if (err) { err.textContent = "Title and dates need an end date on or after the start."; err.classList.add("show"); }
          return;
        }
        if (window.HCVideo && HCVideo.problem(videoUrl)) {
          if (err) { err.textContent = HCVideo.problem(videoUrl); err.classList.add("show"); }
          return;
        }
        var saved = await HCCrawl.client().rpc("organizer_update_crawl", {
          p_crawl: active,
          p_name: title,
          p_starts: start,
          p_ends: end,
          p_video_url: videoUrl
        });
        if (saved.error) {
          if (err) { err.textContent = saved.error.message || "Could not save the crawl."; err.classList.add("show"); }
          return;
        }
        var crawl = current();
        if (crawl) { crawl.name = title; crawl.starts_at = start; crawl.ends_at = end; crawl.video_url = videoUrl; }
        renderLive();
        if (ok) { ok.textContent = "Crawl details saved."; ok.classList.add("show"); }
      });
    }

    var editing = null;
    var shopPaths = [];

    function shopForm() {
      return document.getElementById("org-shop-form");
    }

    function shopMessage(id, text) {
      var el = document.getElementById(id);
      if (!el) return;
      el.textContent = text || "";
      el.classList.toggle("show", !!text);
    }

    function shopImageUrl(path) {
      if (!path || !window.HCCrawl) return "";
      var out = HCCrawl.client().storage.from("shop-images").getPublicUrl(path);
      return (out && out.data && out.data.publicUrl) || "";
    }

    function setShopPreview(imgId, emptyId, path) {
      var img = document.getElementById(imgId);
      var empty = document.getElementById(emptyId);
      var src = shopImageUrl(path);
      if (!img) return;
      if (src) {
        img.src = src;
        img.classList.remove("hidden");
        if (empty) empty.classList.add("hidden");
      } else {
        img.removeAttribute("src");
        img.classList.add("hidden");
        if (empty) empty.classList.remove("hidden");
      }
    }

    function paintShopGallery() {
      var gallery = document.getElementById("org-shop-gallery");
      if (!gallery) return;
      var rest = shopPaths.slice(1);
      gallery.innerHTML = rest.map(function (src, index) {
        return '<figure class="gallery-item"><img src="' + esc(shopImageUrl(src)) + '" alt=""><button type="button" data-remove-org-photo="' + (index + 1) + '">Remove</button></figure>';
      }).join("") || '<p class="muted small">No gallery photos yet.</p>';
    }

    function paintShopForm(row) {
      editing = row;
      shopPaths = Array.isArray(row.photo_paths) ? row.photo_paths.slice() : [];
      var form = shopForm();
      if (form) {
        form.classList.remove("hidden");
        form.hidden = false;
      }
      var fields = {
        "org-shop-name": row.display_name || "",
        "org-shop-stamp-label": row.stamp_label || "",
        "org-shop-address": row.address || "",
        "org-shop-postal": row.postal_code || "",
        "org-shop-phone": row.phone || "",
        "org-shop-hours": row.hours || "",
        "org-shop-description": row.blurb || "",
        "org-shop-website": row.website || "",
        "org-shop-instagram": row.instagram || "",
        "org-shop-video": row.video_url || ""
      };
      Object.keys(fields).forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.value = fields[id];
      });
      setShopPreview("org-shop-cover-preview", "org-shop-cover-empty", shopPaths[0]);
      setShopPreview("org-shop-logo-preview", "org-shop-logo-empty", row.logo_path);
      setShopPreview("org-shop-stamp-preview", "org-shop-stamp-empty", row.stamp_image_path);
      paintShopGallery();
      shopMessage("org-shop-ok", "");
      shopMessage("org-shop-err", "");
    }

    function closeShopForm() {
      editing = null;
      shopPaths = [];
      var form = shopForm();
      if (!form) return;
      form.classList.add("hidden");
      form.hidden = true;
    }

    function shopFileType(file) {
      if (!file) return "";
      return file.type === "image/jpg" ? "image/jpeg" : file.type;
    }

    async function uploadShopFile(folder, file, limitMb) {
      var type = shopFileType(file);
      if (["image/jpeg", "image/png", "image/webp"].indexOf(type) === -1) throw new Error("Use a PNG, JPG, or WebP image.");
      if (file.size > limitMb * 1024 * 1024) throw new Error("Images need to be " + limitMb + " MB or smaller.");
      var ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
      var path = editing.listing_id + "/" + folder + "/" + (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())) + "." + ext;
      var up = await HCCrawl.client().storage.from("shop-images").upload(path, file, { contentType: type, upsert: false });
      if (up.error) throw up.error;
      return path;
    }

    async function openShop(listingId) {
      shopMessage("org-shop-err", "");
      var res = await HCCrawl.client().rpc("organizer_shop_listing", { p_listing: listingId });
      if (res.error || !res.data || !res.data.length) {
        shopMessage("org-shop-err", (res.error && res.error.message) || "Could not open that shop.");
        var form = shopForm();
        if (form) { form.classList.remove("hidden"); form.hidden = false; }
        return;
      }
      paintShopForm(res.data[0]);
      var form = shopForm();
      if (form && form.scrollIntoView) form.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    var storeList = document.getElementById("org-stores");
    if (storeList) {
      storeList.addEventListener("click", function (ev) {
        if (demoOn()) return;
        var btn = ev.target.closest && ev.target.closest("[data-edit-shop]");
        if (!btn) return;
        openShop(btn.getAttribute("data-edit-shop"));
      });
      storeList.addEventListener("change", async function (ev) {
        if (demoOn()) return;
        var box = ev.target.closest && ev.target.closest("[data-listing]");
        if (!box) return;
        var saved = await HCCrawl.client().rpc("organizer_set_shop_visible", {
          p_listing: box.getAttribute("data-listing"),
          p_visible: box.checked
        });
        if (saved.error) box.checked = !box.checked;
      });
    }

    var shopEditor = shopForm();
    if (shopEditor) {
      var cancelShop = document.getElementById("org-shop-cancel");
      if (cancelShop) cancelShop.addEventListener("click", closeShopForm);
      shopEditor.addEventListener("submit", async function (ev) {
        if (demoOn()) return;
        ev.preventDefault();
        shopMessage("org-shop-ok", "");
        shopMessage("org-shop-err", "");
        if (!editing) { shopMessage("org-shop-err", "Choose a shop from the list."); return; }
        var draft = {
          name: document.getElementById("org-shop-name").value.trim(),
          stampLabel: document.getElementById("org-shop-stamp-label").value.trim(),
          address: document.getElementById("org-shop-address").value.trim(),
          postal: document.getElementById("org-shop-postal").value.trim(),
          phone: document.getElementById("org-shop-phone").value.trim(),
          hours: document.getElementById("org-shop-hours").value.trim(),
          description: document.getElementById("org-shop-description").value.trim(),
          website: document.getElementById("org-shop-website").value.trim(),
          instagram: document.getElementById("org-shop-instagram").value.trim().replace(/^@/, ""),
          video: document.getElementById("org-shop-video").value.trim()
        };
        if (!draft.name || draft.name.length > 200) { shopMessage("org-shop-err", "Shop name needs to be 1–200 characters."); return; }
        if (draft.postal && !/^\d{5}(?:-\d{4})?$/.test(draft.postal)) { shopMessage("org-shop-err", "Zip code needs to be 5 digits."); return; }
        if (draft.website && !/^https?:\/\//i.test(draft.website)) { shopMessage("org-shop-err", "Website must start with http:// or https://."); return; }
        if (window.HCVideo && HCVideo.problem(draft.video)) { shopMessage("org-shop-err", HCVideo.problem(draft.video)); return; }
        var saved = await HCCrawl.client().rpc("shop_save_listing", {
          p_listing: editing.listing_id,
          p_name: draft.name,
          p_address: draft.address,
          p_postal: draft.postal,
          p_phone: draft.phone,
          p_hours: draft.hours,
          p_blurb: draft.description,
          p_website: draft.website,
          p_instagram: draft.instagram,
          p_stamp_label: draft.stampLabel,
          p_video_url: draft.video
        });
        if (saved.error) { shopMessage("org-shop-err", saved.error.message || "Could not save the shop."); return; }
        editing.display_name = draft.name;
        editing.postal_code = draft.postal;
        editing.stamp_label = draft.stampLabel;
        editing.video_url = draft.video;
        var listed = shops.filter(function (row) { return row.listing_id === editing.listing_id; })[0];
        if (listed) listed.display_name = draft.name;
        renderLive();
        shopMessage("org-shop-ok", "Shop saved.");
      });

      async function onOrgFile(inputId, folder, limitMb, apply) {
        var input = document.getElementById(inputId);
        if (!input) return;
        input.addEventListener("change", async function () {
          if (demoOn()) return;
          var file = input.files && input.files[0];
          input.value = "";
          if (!file) return;
          if (!editing) { shopMessage("org-shop-err", "Choose a shop from the list."); return; }
          shopMessage("org-shop-err", "");
          var path = "";
          try {
            path = await uploadShopFile(folder, file, limitMb);
            await apply(path);
            setShopPreview("org-shop-cover-preview", "org-shop-cover-empty", shopPaths[0]);
            setShopPreview("org-shop-logo-preview", "org-shop-logo-empty", editing.logo_path);
            setShopPreview("org-shop-stamp-preview", "org-shop-stamp-empty", editing.stamp_image_path);
            paintShopGallery();
            shopMessage("org-shop-ok", "Image saved.");
          } catch (e) {
            if (path) {
              try { await HCCrawl.client().storage.from("shop-images").remove([path]); } catch (ignore) {}
            }
            shopMessage("org-shop-err", (e && e.message) || "Could not add that image.");
          }
        });
      }

      onOrgFile("file-org-cover", "gallery", 5, async function (path) {
        var next = [path].concat(shopPaths.filter(function (item) { return item !== path; })).slice(0, 8);
        var saved = await HCCrawl.client().rpc("shop_set_photo_paths", { p_listing: editing.listing_id, p_paths: next });
        if (saved.error) throw saved.error;
        shopPaths = next;
        editing.photo_paths = next;
      });
      onOrgFile("file-org-gallery", "gallery", 5, async function (path) {
        if (shopPaths.length >= 8) throw new Error("You can keep up to 8 photos.");
        var next = shopPaths.concat([path]);
        var saved = await HCCrawl.client().rpc("shop_set_photo_paths", { p_listing: editing.listing_id, p_paths: next });
        if (saved.error) throw saved.error;
        shopPaths = next;
        editing.photo_paths = next;
      });
      onOrgFile("file-org-stamp", "stamp", 2, async function (path) {
        var saved = await HCCrawl.client().rpc("shop_set_stamp_art", { p_listing: editing.listing_id, p_kind: "stamp", p_path: path });
        if (saved.error) throw saved.error;
        editing.stamp_image_path = path;
      });
      onOrgFile("file-org-logo", "logo", 2, async function (path) {
        var saved = await HCCrawl.client().rpc("shop_set_stamp_art", { p_listing: editing.listing_id, p_kind: "logo", p_path: path });
        if (saved.error) throw saved.error;
        editing.logo_path = path;
      });

      var orgGallery = document.getElementById("org-shop-gallery");
      if (orgGallery) {
        orgGallery.addEventListener("click", async function (ev) {
          if (demoOn() || !editing) return;
          var btn = ev.target.closest && ev.target.closest("[data-remove-org-photo]");
          if (!btn) return;
          var index = Number(btn.getAttribute("data-remove-org-photo"));
          var removed = shopPaths[index];
          var next = shopPaths.filter(function (_, i) { return i !== index; });
          var saved = await HCCrawl.client().rpc("shop_set_photo_paths", { p_listing: editing.listing_id, p_paths: next });
          if (saved.error) { shopMessage("org-shop-err", saved.error.message || "Could not remove that photo."); return; }
          shopPaths = next;
          editing.photo_paths = next;
          if (removed) {
            try { await HCCrawl.client().storage.from("shop-images").remove([removed]); } catch (ignore) {}
          }
          setShopPreview("org-shop-cover-preview", "org-shop-cover-empty", shopPaths[0]);
          paintShopGallery();
        });
      }
    }

    var optIns = [];
    function paintOptIns(rows) {
      optIns = rows || [];
      var results = document.getElementById("area-opt-in-results");
      if (!results) return;
      results.replaceChildren();
      if (!optIns.length) {
        var empty = document.createElement("p");
        empty.className = "muted small";
        empty.textContent = "No opted-in guests in that region.";
        results.append(empty);
        return;
      }
      optIns.forEach(function (row) {
        var article = document.createElement("article");
        article.className = "record-card";
        var name = document.createElement("b");
        name.className = "record-name";
        name.textContent = row.player_name || row.player_email || "Guest";
        var detail = document.createElement("p");
        detail.className = "small";
        detail.textContent = [row.player_email, row.player_phone, row.region_label || row.region_city, row.crawl_name].filter(Boolean).join(" · ");
        article.append(name, detail);
        results.append(article);
      });
    }
    async function loadOptIns() {
      var err = document.getElementById("area-opt-in-err");
      if (err) { err.textContent = ""; err.classList.remove("show"); }
      if (demoOn()) {
        if (err) { err.textContent = "Demo mode does not list live opt-ins."; err.classList.add("show"); }
        return;
      }
      var regionEl = document.getElementById("area-opt-in-region");
      var region = regionEl ? regionEl.value.trim() : "";
      var res = await HCCrawl.client().rpc("organizer_area_opt_ins", { p_region: region });
      if (res.error) {
        if (err) { err.textContent = res.error.message || "Could not load opt-ins."; err.classList.add("show"); }
        return;
      }
      paintOptIns(res.data || []);
    }
    var optForm = document.getElementById("area-opt-in-form");
    if (optForm) {
      optForm.addEventListener("submit", function (ev) {
        ev.preventDefault();
        loadOptIns();
      });
    }
    var optCsv = document.getElementById("area-opt-in-csv");
    if (optCsv) {
      optCsv.addEventListener("click", function () {
        if (demoOn()) return;
        var header = ["name", "email", "phone", "crawl", "region", "city", "state", "postal", "opted_in_at"];
        var lines = [header.join(",")];
        optIns.forEach(function (row) {
          lines.push([
            row.player_name, row.player_email, row.player_phone, row.crawl_name,
            row.region_label, row.region_city, row.region_state, row.region_postal, row.opted_in_at
          ].map(function (value) {
            return '"' + String(value == null ? "" : value).replace(/"/g, '""') + '"';
          }).join(","));
        });
        var blob = new Blob([lines.join("\n")], { type: "text/csv" });
        var url = URL.createObjectURL(blob);
        var link = document.createElement("a");
        link.href = url;
        link.download = "area-crawl-opt-ins.csv";
        link.click();
        URL.revokeObjectURL(url);
      });
    }

    var invite = document.getElementById("co-invite-form");
    if (invite) {
      invite.addEventListener("submit", async function (ev) {
        if (demoOn()) return;
        ev.preventDefault();
        var email = document.getElementById("co-email").value.trim().toLowerCase();
        var err = document.getElementById("co-err");
        var ok = document.getElementById("co-ok");
        if (err) { err.textContent = ""; err.classList.remove("show"); }
        if (ok) { ok.textContent = ""; ok.classList.remove("show"); }
        var saved = await HCCrawl.client().rpc("organizer_add_co_organizer", {
          p_crawl_id: active,
          p_email: email,
          p_name: null
        });
        if (saved.error) {
          if (err) { err.textContent = saved.error.message || "Could not add that co-organizer."; err.classList.add("show"); }
          return;
        }
        document.getElementById("co-email").value = "";
        await loadTeam();
        renderLive();
        if (ok) { ok.textContent = "Co-organizer added. No email was sent. They sign in with that address."; ok.classList.add("show"); }
      });
    }
  });
})();
