/* Shop portal: approved public photos at this shop. Pub photos are excluded by the server. */
(function () {
  function esc(value) {
    return window.HCCrawl && HCCrawl.escapeHtml ? HCCrawl.escapeHtml(value) : String(value || "");
  }

  function url(sb, path) {
    var out = sb.storage.from("checkin-display").getPublicUrl(path);
    return (out && out.data && out.data.publicUrl) || "";
  }

  async function load(sb, listing) {
    var host = document.getElementById("visitor-photos");
    if (!host || !listing || !listing.business_id) return;
    var res = await sb.rpc("shop_visit_photos", { p_business: listing.business_id });
    if (res.error) {
      var msg = String(res.error.message || "");
      if (/not authorized/i.test(msg) || /shop_visit_photos|PGRST202|schema cache/i.test(msg)) {
        host.classList.add("hidden");
        return;
      }
      host.classList.remove("hidden");
      host.innerHTML = '<h3>Visitor photos</h3><p class="form-error show">' + esc(msg) + "</p>";
      return;
    }
    var rows = res.data || [];
    host.classList.remove("hidden");
    host.innerHTML = '<h3>Visitor photos</h3>' +
      '<p class="muted small mt-1">Approved photos guests agreed to show. You can hide one from your page. The crawl page can still show it.</p>' +
      (rows.length ? '<div class="visitor-shop-list">' + rows.map(function (row) {
        return '<figure data-stamp="' + esc(row.stamp_id) + '">' +
          '<img src="' + esc(url(sb, row.public_display_path)) + '" alt="' + esc(row.display_label || "Visitor") + '" loading="lazy" />' +
          "<figcaption><span>" + esc(row.display_label || "Guest") + "</span> " +
          '<button type="button" data-hide="' + (row.shop_hidden ? "0" : "1") + '">' +
          (row.shop_hidden ? "Show on my page" : "Hide from my page") +
          "</button></figcaption></figure>";
      }).join("") + "</div>" : '<p class="muted small mt-2">No public visitor photos yet.</p>');
    host.onclick = async function (ev) {
      var button = ev.target.closest("[data-hide]");
      if (!button) return;
      var figure = button.closest("[data-stamp]");
      var hidden = button.getAttribute("data-hide") === "1";
      var upd = await sb.rpc("shop_set_photo_hidden", {
        p_stamp: figure.getAttribute("data-stamp"),
        p_hidden: hidden
      });
      if (upd.error) {
        button.insertAdjacentHTML("afterend", '<p class="form-error show">' + esc(upd.error.message || "Could not update that photo.") + "</p>");
        return;
      }
      load(sb, listing);
    };
  }

  window.HCShopVisitors = { load: load };
})();
