/* Guest passport: change public and social choices, or take a photo off the site. */
(function () {
  function esc(value) {
    return window.HCCrawl && HCCrawl.escapeHtml ? HCCrawl.escapeHtml(value) : String(value || "");
  }

  function copy() {
    return window.HCPhotoConsent || {};
  }

  async function signed(sb, path) {
    if (!path) return "";
    var res = await sb.storage.from("checkin-selfies").createSignedUrl(path, 180);
    if (res.error) return "";
    return (res.data && res.data.signedUrl) || "";
  }

  async function load(sb) {
    var host = document.getElementById("passport-photos");
    if (!host || !sb) return;
    var session = window.HCCrawl && await HCCrawl.getSession();
    if (!session) {
      host.innerHTML = "<h3>Your visit photos</h3><p class=\"muted small mt-1\">Sign in to see the selfies on this passport.</p>";
      return;
    }
    var res = await sb.rpc("my_visit_photos", { p_crawl: null });
    if (res.error) {
      var msg = String(res.error.message || "");
      if (/my_visit_photos|PGRST202|schema cache/i.test(msg)) {
        host.innerHTML = "<h3>Your visit photos</h3><p class=\"muted small mt-1\">Photo check-in isn’t turned on yet.</p>";
        return;
      }
      host.innerHTML = '<h3>Your visit photos</h3><p class="form-error show">' + esc(msg) + "</p>";
      return;
    }
    var rows = res.data || [];
    if (!rows.length) {
      host.innerHTML = "<h3>Your visit photos</h3><p class=\"muted small mt-1\">Selfies from your stamps will show up here.</p>";
      return;
    }
    var cards = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var src = await signed(sb, row.selfie_path);
      var c = copy();
      var pub = c.isPub ? c.isPub(row.crawl_type, row.min_age) : row.crawl_type === "pub";
      var publicLabel = pub ? (c.publicOptInPub || "") : (c.publicOptIn ? c.publicOptIn(row.shop_name) : "");
      var ageLabel = c.ageLabel ? c.ageLabel(row.min_age) : (pub ? "I'm 21 or older" : "I'm 18 or older");
      var socialLabel = c.socialOptIn ? c.socialOptIn(row.shop_name) : "";
      cards.push(
        '<form class="passport-photo" data-stamp="' + esc(row.stamp_id) + '">' +
          (src ? '<img src="' + esc(src) + '" alt="" />' : "") +
          "<p><strong>" + esc(row.shop_name || "Shop") + "</strong> · " + esc(row.crawl_name || "") + "</p>" +
          '<p class="small muted">' + esc(row.moderation_status || "") + "</p>" +
          '<label class="hc-check"><input type="checkbox" name="public"' + (row.public_opt_in ? " checked" : "") + " /> " + esc(publicLabel) + "</label>" +
          '<label class="hc-check"><input type="checkbox" name="age"' + (row.age_confirmed ? " checked" : "") + " /> " + esc(ageLabel) + "</label>" +
          '<label class="hc-check"><input type="checkbox" name="social"' + (row.social_opt_in ? " checked" : "") + " /> " + esc(socialLabel) + "</label>" +
          '<button class="btn btn-soft" type="submit">Save photo choices</button>' +
          '<p class="form-success" role="status"></p>' +
          '<p class="form-error" role="alert"></p>' +
        "</form>"
      );
    }
    host.innerHTML = "<h3>Your visit photos</h3><p class=\"muted small mt-1\">Uncheck the public box to take a photo off the site. That does not remove the stamp.</p>" + cards.join("");
    host.onsubmit = async function (ev) {
      ev.preventDefault();
      var form = ev.target.closest(".passport-photo");
      if (!form) return;
      var ok = form.querySelector(".form-success");
      var err = form.querySelector(".form-error");
      ok.textContent = "";
      err.textContent = "";
      ok.classList.remove("show");
      err.classList.remove("show");
      var saved = await sb.rpc("set_my_photo_choices", {
        p_stamp: form.getAttribute("data-stamp"),
        p_public: form.querySelector('[name="public"]').checked,
        p_age: form.querySelector('[name="age"]').checked,
        p_social: form.querySelector('[name="social"]').checked
      });
      if (saved.error) {
        err.textContent = saved.error.message || "Could not save those choices.";
        err.classList.add("show");
        return;
      }
      ok.textContent = "Saved.";
      ok.classList.add("show");
      load(sb);
    };
  }

  window.HCPassportPhotos = { load: load };
})();
