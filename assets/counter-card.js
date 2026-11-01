/* Counter tent markup shared by hosts and crawl staff.
   The QR opens the public crawl page with shop and code, the same query
   the trail pages already stash before a magic link can consume code. */
(function () {
  var PAGES = {
    "puy-coffee": "https://www.hometowncrawls.com/puyallup/holiday-coffee-crawl",
    "arl-coffee": "https://www.hometowncrawls.com/arlington/holiday-coffee-crawl"
  };

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function stampPage(crawlId) {
    return PAGES[crawlId] || "";
  }

  function stampUrl(listing) {
    var page = stampPage(listing && listing.crawl_id);
    var shop = listing && listing.business_id;
    var code = listing && listing.qr_secret;
    if (!page || !shop || !code) return "";
    var url = new URL(page);
    url.searchParams.set("shop", String(shop));
    url.searchParams.set("code", String(code));
    return url.toString();
  }

  function ready(listing) {
    return !!(stampUrl(listing) && typeof qrcode === "function");
  }

  function qrMarkup(listing) {
    var target = stampUrl(listing);
    if (!target || typeof qrcode !== "function") return "";
    var qr = qrcode(0, "M");
    qr.addData(target);
    qr.make();
    return typeof qr.createSvgTag === "function" ? qr.createSvgTag(6, 0) : qr.createImgTag(6, 8);
  }

  function faceHtml(listing, qrHtml) {
    var code = (listing && listing.store_code) || "";
    var name = (listing && listing.display_name) || "Your shop";
    return '<div class="tent-qr">' + (qrHtml || "") + "</div>" +
      '<div class="tent-copy">' +
        '<p class="brand">Hometown Crawls</p>' +
        "<h2>" + escapeHtml(name) + "</h2>" +
        '<p class="stamp-line">Get your passport stamped here</p>' +
        '<p class="code-label">Counter code</p>' +
        '<p class="code">' + escapeHtml(code || "Pending") + "</p>" +
      "</div>";
  }

  function tentHtml(listing) {
    var markup = qrMarkup(listing);
    if (!markup) return "";
    var inner = faceHtml(listing, markup);
    return '<div class="tent-face flip">' + inner + "</div>" +
      '<div class="fold-line" aria-hidden="true"></div>' +
      '<div class="tent-face">' + inner + "</div>";
  }

  function fileName(listing) {
    var base = String((listing && listing.display_name) || "shop")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
    return (base || "shop") + "-counter-card.html";
  }

  function fallbackCss() {
    return ".tent-sheet{width:min(100%,720px);margin:1rem auto 0;background:#fffdf8;border:1px solid #e4dccb;}" +
      ".tent-face{min-height:240px;display:flex;align-items:center;justify-content:center;gap:1rem;padding:1.25rem;background:#f4efe6;color:#1f3a24;}" +
      ".tent-face.flip{transform:rotate(180deg);}" +
      ".fold-line{border-top:1px dashed #1f3a24;}" +
      ".tent-copy{max-width:16rem;text-align:center;}" +
      ".tent-copy h2{font-family:Fraunces,Georgia,serif;}" +
      "@media print{body.hc-counter-print .no-print{display:none !important;}" +
      "body.hc-counter-print .tent-sheet{width:11in;height:8.5in;display:flex;flex-direction:column;}" +
      "body.hc-counter-print .tent-face{height:4.25in;}}";
  }

  function downloadFile(listing, cssText) {
    var tent = tentHtml(listing);
    var name = (listing && listing.display_name) || "Your shop";
    var css = String(cssText || "");
    if (css.indexOf(".tent-sheet") === -1) css = fallbackCss();
    if (css.indexOf("@page") === -1) css += "\n@page { size: letter landscape; margin: 0; }\n";
    var html = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n" +
      "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n" +
      "<title>Counter card · " + escapeHtml(name) + "</title>\n" +
      "<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n" +
      "<link href=\"https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;700&family=Outfit:wght@400;500;600;700&display=swap\" rel=\"stylesheet\">\n" +
      "<style>\n:root{--line:#e4dccb;--font-body:Outfit,sans-serif;--font-display:Fraunces,Georgia,serif;}\n" +
      "body{margin:0;background:#f8f2e7;font-family:var(--font-body);color:#1f3a24;}\n" +
      css + "\n</style>\n</head>\n<body class=\"hc-counter-print\">\n" +
      "<div class=\"no-print\" style=\"padding:1.25rem\">\n" +
      "<p>Letter size. Fold on the dashed line to make a counter tent.</p>\n" +
      "<p><button type=\"button\" onclick=\"window.print()\">Print counter card</button></p>\n" +
      "</div>\n<div class=\"tent-sheet\">" + tent + "</div>\n</body>\n</html>\n";
    return { name: fileName(listing), html: html };
  }

  window.HCCounterCard = {
    stampPage: stampPage,
    stampUrl: stampUrl,
    ready: ready,
    qrMarkup: qrMarkup,
    faceHtml: faceHtml,
    tentHtml: tentHtml,
    fileName: fileName,
    downloadFile: downloadFile
  };
})();
