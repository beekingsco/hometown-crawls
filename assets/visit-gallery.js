/* Public visitor photos. One fetch per crawl, then strips and a wall. */
(function () {
  var cache = {};

  function client() {
    return window.HCCrawl && HCCrawl.client && HCCrawl.client();
  }

  function esc(value) {
    return window.HCCrawl && HCCrawl.escapeHtml ? HCCrawl.escapeHtml(value) : String(value || "");
  }

  function publicUrl(sb, path) {
    if (!path) return "";
    var out = sb.storage.from("checkin-display").getPublicUrl(path);
    return (out && out.data && out.data.publicUrl) || "";
  }

  async function load(crawlId) {
    if (!crawlId) return [];
    if (cache[crawlId]) return cache[crawlId];
    var sb = client();
    if (!sb) return [];
    var res = await sb.rpc("public_visit_photos", { p_crawl: crawlId, p_business: null });
    cache[crawlId] = res.error ? [] : (res.data || []);
    return cache[crawlId];
  }

  function thumb(photo, sb) {
    var src = publicUrl(sb, photo.public_path);
    if (!src) return "";
    return '<button type="button" class="visitor-thumb" data-stamp="' + esc(photo.stamp_id) + '" data-crawl="' + esc(photo.crawl_id || "") + '">' +
      '<img src="' + esc(src) + '" alt="' + esc(photo.display_label || "Visitor") + '" loading="lazy" />' +
      "</button>";
  }

  function paintStrips(photos, sb, crawlId) {
    document.querySelectorAll('.visitor-strip[data-crawl="' + crawlId + '"]').forEach(function (el) {
      var business = el.getAttribute("data-business");
      var mine = photos.filter(function (photo) {
        return photo.business_id === business && photo.show_on_shop !== false;
      });
      if (!mine.length) {
        el.innerHTML = "";
        return;
      }
      el.innerHTML = '<p class="visitor-kicker">Visitors</p>' +
        mine.slice(0, 4).map(function (photo) {
          photo.crawl_id = crawlId;
          return thumb(photo, sb);
        }).join("") +
        (mine.length > 4 ? '<button type="button" class="visitor-more" data-business="' + esc(business) + '" data-crawl="' + esc(crawlId) + '">More</button>' : "");
    });
  }

  function paintWalls(groups, sb) {
    document.querySelectorAll("[data-visit-wall]").forEach(function (el) {
      var crawlId = el.getAttribute("data-crawl");
      var photos = (groups[crawlId] || []).slice(0, 24);
      if (!photos.length) {
        el.innerHTML = '<p class="muted small">Visitor photos show up here after they are approved.</p>';
        return;
      }
      el.innerHTML = '<div class="visitor-wall">' + photos.map(function (photo) {
        photo.crawl_id = crawlId;
        return '<figure class="visitor-tile">' + thumb(photo, sb) +
          '<figcaption>' + esc(photo.display_label || "Guest") +
          (photo.shop_name ? " · " + esc(photo.shop_name) : "") +
          ' <button type="button" class="visitor-report" data-stamp="' + esc(photo.stamp_id) + '">Report photo</button></figcaption></figure>';
      }).join("") + "</div>";
    });
  }

  function ensureLightbox() {
    var box = document.querySelector(".visitor-lightbox");
    if (box) return box;
    box = document.createElement("div");
    box.className = "visitor-lightbox";
    box.hidden = true;
    box.innerHTML = '<div class="visitor-lightbox-card" role="dialog" aria-modal="true">' +
      '<img alt="" />' +
      '<p class="visitor-lightbox-copy"></p>' +
      '<div class="row">' +
        '<button type="button" class="btn btn-ghost" data-act="close">Close</button>' +
        '<button type="button" class="btn btn-soft" data-act="report">Report photo</button>' +
      "</div>" +
      '<p class="form-error visitor-lightbox-err" role="alert"></p>' +
      "</div>";
    box.addEventListener("click", function (ev) {
      if (ev.target === box || (ev.target.getAttribute && ev.target.getAttribute("data-act") === "close")) {
        box.hidden = true;
      }
    });
    box.querySelector("[data-act=report]").onclick = function () {
      report(box.getAttribute("data-stamp"), box.querySelector(".visitor-lightbox-err"));
    };
    document.body.appendChild(box);
    return box;
  }

  function openPhoto(photo) {
    var sb = client();
    var box = ensureLightbox();
    box.hidden = false;
    box.setAttribute("data-stamp", photo.stamp_id || "");
    box.querySelector("img").src = publicUrl(sb, photo.public_path);
    box.querySelector("img").alt = photo.display_label || "Visitor";
    box.querySelector(".visitor-lightbox-copy").textContent =
      (photo.display_label || "Guest") + (photo.shop_name ? " at " + photo.shop_name : "");
    box.querySelector(".visitor-lightbox-err").textContent = "";
  }

  async function report(stampId, errEl) {
    var sb = client();
    if (!sb || !stampId) return;
    var session = window.HCCrawl && await HCCrawl.getSession();
    if (!session) {
      if (errEl) errEl.textContent = "Sign in to report this photo";
      return;
    }
    var res = await sb.rpc("report_visit_photo", { p_stamp: stampId, p_note: null });
    if (errEl) errEl.textContent = res.error ? (res.error.message || "Could not report that photo.") : "Reported. Thank you.";
  }

  function findPhoto(stampId) {
    var lists = Object.keys(cache).map(function (key) { return cache[key]; });
    for (var i = 0; i < lists.length; i++) {
      for (var j = 0; j < lists[i].length; j++) {
        if (lists[i][j].stamp_id === stampId) return lists[i][j];
      }
    }
    return null;
  }

  async function paint() {
    var sb = client();
    if (!sb) {
      document.querySelectorAll("[data-visit-wall]").forEach(function (el) {
        if (!el.innerHTML.trim()) {
          el.innerHTML = '<p class="muted small">Visitor photos show up here after they are approved.</p>';
        }
      });
      return;
    }
    var ids = {};
    document.querySelectorAll(".visitor-strip[data-crawl], [data-visit-wall][data-crawl]").forEach(function (el) {
      var id = el.getAttribute("data-crawl");
      if (id) ids[id] = true;
    });
    var keys = Object.keys(ids);
    await Promise.all(keys.map(load));
    keys.forEach(function (id) { paintStrips(cache[id] || [], sb, id); });
    var groups = {};
    keys.forEach(function (id) { groups[id] = cache[id] || []; });
    paintWalls(groups, sb);
  }

  document.addEventListener("click", function (ev) {
    var more = ev.target.closest && ev.target.closest(".visitor-more");
    if (more) {
      var wall = document.querySelector('[data-visit-wall][data-crawl="' + more.getAttribute("data-crawl") + '"]');
      if (wall) wall.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    var reportBtn = ev.target.closest && ev.target.closest(".visitor-report");
    if (reportBtn) {
      report(reportBtn.getAttribute("data-stamp"), reportBtn.parentElement);
      return;
    }
    var thumbBtn = ev.target.closest && ev.target.closest(".visitor-thumb");
    if (!thumbBtn) return;
    var photo = findPhoto(thumbBtn.getAttribute("data-stamp"));
    if (photo) openPhoto(photo);
  });

  window.HCVisitGallery = { paint: paint, load: load };
})();
