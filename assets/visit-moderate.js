/* Organizer and staff visit-photo queue.
   Pub photos are staff-only. The staff queue is one-tap and keyboard driven.
*/
(function () {
  var state = null;

  function esc(value) {
    return window.HCCrawl && HCCrawl.escapeHtml ? HCCrawl.escapeHtml(value) : String(value || "");
  }

  async function access(sb, crawlId) {
    var res = await sb.rpc("visit_photo_access", { p_crawl: crawlId });
    if (res.error) {
      var msg = String(res.error.message || "");
      if (/visit_photo_access|could not find the function|PGRST202|schema cache/i.test(msg)) {
        return { allowed: false, missing: true };
      }
      return { allowed: false };
    }
    return res.data || { allowed: false };
  }

  function hide(host) {
    if (!host) return;
    host.classList.add("hidden");
    host.innerHTML = "";
    if (state && state.host === host) {
      state = null;
    }
  }

  function filtersFor(info) {
    if (info.staff) return ["pending", "queued", "approved", "hidden", "rejected", "reported", "staff_only"];
    return ["pending", "approved", "hidden", "reported"];
  }

  async function signedUrl(sb, path) {
    if (!path) return "";
    var res = await sb.storage.from("checkin-selfies").createSignedUrl(path, 180);
    if (res.error) return "";
    return (res.data && res.data.signedUrl) || "";
  }

  async function loadQueue() {
    var res = await state.sb.rpc("visit_photo_queue", {
      p_crawl: state.crawlId,
      p_filter: state.filter
    });
    if (res.error) throw res.error;
    state.items = res.data || [];
    if (state.index >= state.items.length) state.index = 0;
  }

  async function act(name) {
    var row = state.items[state.index];
    if (!row || state.busy) return;
    state.busy = true;
    state.error = "";
    try {
      if (name === "approve") await approve(row);
      else {
        var res = await state.sb.rpc("moderate_visit_photo", {
          p_stamp: row.stamp_id,
          p_action: name,
          p_display_path: null
        });
        if (res.error) throw res.error;
        if (window.HCVisitPhotoFiles) {
          var flushed = await window.HCVisitPhotoFiles.flush(
            state.sb,
            window.HCVisitPhotoFiles.idsFrom(res.data)
          );
          if (!flushed.ok) {
            state.error = flushed.error || "The photo is off the site. File removal will be retried.";
          }
        }
      }
      var next = state.index;
      await loadQueue();
      state.index = Math.min(next, Math.max(state.items.length - 1, 0));
    } catch (e) {
      state.error = e.message || "Could not update that photo.";
    } finally {
      state.busy = false;
      render();
    }
  }

  async function approve(row) {
    var url = await signedUrl(state.sb, row.selfie_path);
    if (!url) throw new Error("Could not open the selfie.");
    var response = await fetch(url);
    if (!response.ok) throw new Error("Could not open the selfie.");
    var blob = await response.blob();
    var bitmap = await createImageBitmap(blob);
    var jpeg = await window.HCCheckinImage.blobFromDrawable(bitmap);
    if (bitmap.close) bitmap.close();
    var path = row.crawl_id + "/" + row.stamp_id + ".jpg";
    var up = await state.sb.storage.from("checkin-display").upload(path, jpeg, {
      contentType: "image/jpeg",
      upsert: true
    });
    if (up.error) throw up.error;
    var res = await state.sb.rpc("moderate_visit_photo", {
      p_stamp: row.stamp_id,
      p_action: "approve",
      p_display_path: path
    });
    if (res.error) throw res.error;
    state.note = (res.data && res.data.moderation_status) === "queued"
      ? "Approved and waiting for the next open slot."
      : "Published.";
  }

  async function saveCap() {
    var input = state.host.querySelector(".hc-cap-input");
    var raw = String(input.value || "").trim();
    var cap = raw === "" ? null : Number(raw);
    if (raw !== "" && (!isFinite(cap) || cap < 0)) {
      state.error = "Cap must be zero or more.";
      render();
      return;
    }
    var res = await state.sb.rpc("staff_set_photo_publish_cap", {
      p_crawl: state.crawlId,
      p_cap: cap
    });
    if (res.error) {
      state.error = res.error.message || "Could not save the cap.";
    } else {
      state.access.photo_publish_per_hour = cap;
      state.access.published_last_hour = res.data && res.data.published_last_hour;
      state.note = "Cap saved.";
    }
    render();
  }

  async function saveListed(listed) {
    var res = await state.sb.rpc("staff_set_visit_photos_listed", {
      p_crawl: state.crawlId,
      p_listed: listed
    });
    if (res.error) state.error = res.error.message || "Could not update the listing.";
    else {
      state.access.list_visit_photos = listed;
      state.note = listed ? "Photos can appear on the site, within the hourly cap." : "Photos are hidden from the public site.";
    }
    render();
  }

  async function loadOrganizers() {
    var res = await state.sb.rpc("staff_list_organizers", { p_crawl: state.crawlId });
    state.organizers = res.error ? [] : (res.data || []);
  }

  async function saveKind(organizerId, kind) {
    var res = await state.sb.rpc("staff_set_organizer_kind", {
      p_crawl: state.crawlId,
      p_organizer: organizerId,
      p_kind: kind
    });
    state.note = res.error ? (res.error.message || "Could not update that organizer.") : "Organizer kind saved.";
    if (!res.error) await loadOrganizers();
    render();
  }

  function buttons(row) {
    var staff = !!state.access.staff;
    var html = "";
    if (state.filter !== "staff_only") {
      html += '<button type="button" class="btn btn-primary" data-act="approve">Approve <kbd>A</kbd></button>';
    }
    if (staff) {
      html += '<button type="button" class="btn btn-soft" data-act="reject">Reject <kbd>R</kbd></button>';
    }
    html += '<button type="button" class="btn btn-soft" data-act="hide">Hide <kbd>H</kbd></button>';
    if (row && (row.moderation_status === "approved" || row.moderation_status === "queued")) {
      html += '<button type="button" class="btn btn-soft" data-act="unpublish">Unpublish <kbd>U</kbd></button>';
    }
    if (!staff || state.filter !== "pending") {
      html += '<button type="button" class="btn btn-ghost" data-act="delete">Delete</button>';
    }
    if (state.filter === "reported" || (row && Number(row.report_count) > 0)) {
      html += '<button type="button" class="btn btn-ghost" data-act="dismiss_reports">Dismiss reports</button>';
    }
    return html;
  }

  function render() {
    var host = state.host;
    var info = state.access;
    var row = state.items[state.index];
    var cap = info.photo_publish_per_hour;
    var capText = cap == null ? "No hourly cap" : ("Live this hour: " + Number(info.published_last_hour || 0) + " / " + cap);
    var filters = filtersFor(info).map(function (name) {
      var on = name === state.filter ? "true" : "false";
      return '<button type="button" class="btn btn-ghost" data-filter="' + name + '" aria-pressed="' + on + '">' + name.replace("_", " ") + "</button>";
    }).join("");
    var staffTools = "";
    if (info.staff) {
      staffTools =
        '<div class="hc-staff-tools">' +
          "<p><strong>" + esc(capText) + "</strong></p>" +
          '<label class="field"><span>Photos published per hour (blank = no cap, 0 = hold)</span>' +
            '<input class="input hc-cap-input" inputmode="numeric" value="' + (cap == null ? "" : esc(String(cap))) + '" />' +
          "</label>" +
          '<button type="button" class="btn btn-soft" data-act="save-cap">Save cap</button>' +
          '<label class="hc-check"><input type="checkbox" class="hc-list-toggle"' + (info.list_visit_photos ? " checked" : "") + " /> List approved photos on the public site</label>" +
          "<div class=\"hc-kind-editor\"><p class=\"small muted\">Organizer kind. Chamber organizers cannot see selfies.</p>" +
            (state.organizers || []).map(function (org) {
              return '<label class="field"><span>' + esc(org.email || org.name || "Organizer") + "</span>" +
                '<select class="input" data-kind="' + esc(org.organizer_id) + '">' +
                  ["person", "business", "chamber"].map(function (kind) {
                    return '<option value="' + kind + '"' + (org.kind === kind ? " selected" : "") + ">" + kind + "</option>";
                  }).join("") +
                "</select></label>";
            }).join("") +
          "</div>" +
        "</div>";
    }
    var frame = row
      ? '<p class="small muted">' + (state.index + 1) + " / " + state.items.length + " · " + esc(row.shop_name || "") + " · " + esc(row.display_label || "Guest") + " · " + esc(row.moderation_status || "") + "</p>" +
        (row.latest_report_note ? '<p class="small">Report: ' + esc(row.latest_report_note) + "</p>" : "") +
        '<div class="hc-queue-frame">' + (state.preview ? '<img src="' + esc(state.preview) + '" alt="" />' : '<p class="muted">No preview</p>') + "</div>" +
        '<div class="row hc-queue-actions">' + buttons(row) + "</div>" +
        '<p class="small muted">Keys: A approve, R reject, H hide, U unpublish, J/K or arrows move.</p>'
      : '<p class="muted">Nothing in this pile.</p>';
    host.innerHTML =
      '<div class="hc-queue" tabindex="0">' +
        "<h3>Visit photos</h3>" +
        (info.pub ? '<p class="small">Pub photos are reviewed by Hometown Crawls staff only.</p>' : "") +
        staffTools +
        '<div class="row hc-queue-filters">' + filters + "</div>" +
        frame +
        (state.note ? '<p class="form-success show">' + esc(state.note) + "</p>" : "") +
        (state.error ? '<p class="form-error show">' + esc(state.error) + "</p>" : "") +
      "</div>";
    host.classList.remove("hidden");
    var focus = host.querySelector(".hc-queue");
    if (focus && state.keepFocus) focus.focus();
  }

  async function refreshPreview() {
    var row = state.items[state.index];
    state.preview = row ? await signedUrl(state.sb, row.selfie_path) : "";
  }

  async function open(sb, crawlId, opts) {
    var host = opts && opts.host;
    var info = opts && opts.access;
    if (!host) return;
    if (!info) info = await access(sb, crawlId);
    if (!info.allowed) {
      hide(host);
      return;
    }
    state = {
      sb: sb,
      crawlId: crawlId,
      host: host,
      access: info,
      filter: "pending",
      items: [],
      index: 0,
      busy: false,
      error: "",
      note: "",
      preview: "",
      organizers: [],
      keepFocus: false
    };
    try {
      if (info.staff) await loadOrganizers();
      await loadQueue();
      await refreshPreview();
    } catch (e) {
      state.error = e.message || "Could not load the photo queue.";
    }
    state.keepFocus = true;
    render();
  }

  document.addEventListener("click", function (ev) {
    if (!state || !state.host || !state.host.contains(ev.target)) return;
    var filter = ev.target.closest("[data-filter]");
    if (filter) {
      state.filter = filter.getAttribute("data-filter");
      state.index = 0;
      state.note = "";
      state.keepFocus = true;
      loadQueue().then(refreshPreview).then(render).catch(function (e) {
        state.error = e.message || "Could not load the photo queue.";
        render();
      });
      return;
    }
    var kind = ev.target.closest("[data-kind]");
    if (kind && ev.type === "click") return;
    var button = ev.target.closest("[data-act]");
    if (!button) return;
    var name = button.getAttribute("data-act");
    if (name === "save-cap") saveCap();
    else act(name);
  });

  document.addEventListener("change", function (ev) {
    if (!state || !state.host || !state.host.contains(ev.target)) return;
    if (ev.target.classList.contains("hc-list-toggle")) {
      saveListed(!!ev.target.checked);
      return;
    }
    var kind = ev.target.closest("[data-kind]");
    if (kind) saveKind(kind.getAttribute("data-kind"), kind.value);
  });

  document.addEventListener("keydown", function (ev) {
    if (!state || !state.host || state.host.classList.contains("hidden")) return;
    var tag = (ev.target && ev.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    var queue = state.host.querySelector(".hc-queue");
    if (!queue || (document.activeElement !== queue && !queue.contains(document.activeElement))) return;
    var key = ev.key.toLowerCase();
    if (key === "a" && state.filter !== "staff_only") { ev.preventDefault(); act("approve"); }
    else if (key === "r" && state.access.staff) { ev.preventDefault(); act("reject"); }
    else if (key === "h") { ev.preventDefault(); act("hide"); }
    else if (key === "u") { ev.preventDefault(); act("unpublish"); }
    else if (key === "j" || key === "arrowdown" || key === "arrowright") {
      ev.preventDefault();
      state.keepFocus = true;
      state.index = Math.min(state.index + 1, Math.max(state.items.length - 1, 0));
      refreshPreview().then(render);
    } else if (key === "k" || key === "arrowup" || key === "arrowleft") {
      ev.preventDefault();
      state.keepFocus = true;
      state.index = Math.max(state.index - 1, 0);
      refreshPreview().then(render);
    }
  });

  window.HCVisitModerate = {
    access: access,
    open: open,
    hide: hide
  };
})();
