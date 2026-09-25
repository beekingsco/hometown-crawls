/* Shared chrome: header, footer, mobile nav, toasts, path helpers */
(function () {
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const depth = path.split("/").filter(Boolean).length;
  // Root pages sit at /, shops/join at /shops/, crawl at /puyallupwa/coffee/
  function assetPrefix() {
    if (path === "/puyallup" || path.startsWith("/puyallup/")) return "/";
    if (path.includes("/puyallupwa/")) return "../../";
    if (path.includes("/shops/") || path.includes("/guides/")) return "../";
    return "";
  }
  const base = assetPrefix();

  function isCurrent(href) {
    const clean = href.replace(/^\.\.\//, "").replace(/^\.\.\//, "");
    const target = clean === "index.html" || clean === "" ? "/" : "/" + clean.replace(/\.html$/, "").replace(/\/index$/, "");
    const here = path === "" || path === "/" ? "/" : path;
    if (target === "/" && (here === "/" || here.endsWith("/index"))) return true;
    if (target !== "/" && here.endsWith(target.replace(/^\//, ""))) return true;
    if (target !== "/" && here.includes(target)) return true;
    return false;
  }

  function link(href, label) {
    const full = base + href;
    const cur = isCurrent(href) ? ' aria-current="page"' : "";
    return `<a href="${full}"${cur}>${label}</a>`;
  }

  function injectHeader() {
    const el = document.getElementById("site-header");
    if (!el) return;
    const logoImg = base + "logo.jpg";
    el.innerHTML = `
      <div class="wrap nav">
        <a class="brand" href="${base}index.html">
          <span class="brand-mark" id="brand-mark">☕</span>
          HOMETOWN CRAWLS
        </a>
        <button class="nav-toggle" type="button" aria-label="Menu" id="nav-toggle"><span></span></button>
        <nav class="nav-links" id="nav-links">
          ${link("puyallupwa/coffee/index.html", "Find a crawl")}
          ${link("map.html", "Map")}
          ${link("prizes.html", "Prizes")}
          ${link("rules.html", "Rules")}
          ${link("faqs.html", "FAQs")}
          ${link("account.html", "Account")}
          ${link("organize.html", "Organize")}
          ${link("shops/join.html", "Shops")}
        </nav>
      </div>`;

    // Optional logo.jpg
    const mark = el.querySelector("#brand-mark");
    const img = new Image();
    img.onload = () => {
      mark.innerHTML = "";
      mark.appendChild(img);
    };
    img.onerror = () => {};
    img.alt = "Hometown Crawls";
    img.src = logoImg;

    const toggle = el.querySelector("#nav-toggle");
    const links = el.querySelector("#nav-links");
    toggle?.addEventListener("click", () => links.classList.toggle("open"));
  }

  function injectFooter() {
    const el = document.getElementById("site-footer");
    if (!el) return;
    el.innerHTML = `
      <div class="wrap">
        <div class="footer-grid">
          <div>
            <div class="footer-brand">Hometown Crawls</div>
            <p class="small" style="opacity:.75;max-width:32ch">Collect stamps. Support locals. No app download — just your phone and a passport.</p>
          </div>
          <div class="footer-col">
            <h4>Explore</h4>
            <a href="${base}puyallupwa/coffee/index.html">Puyallup Coffee</a>
            <a href="${base}puyallupwa/pub/index.html">Puyallup Pub</a>
            <a href="${base}map.html">Map</a>
            <a href="${base}prizes.html">Prizes</a>
            <a href="${base}rules.html">Rules</a>
            <a href="${base}guides/how-a-hometown-coffee-crawl-works.html">Guides</a>
          </div>
          <div class="footer-col">
            <h4>Partners</h4>
            <a href="${base}organize.html">Organize a crawl</a>
            <a href="${base}shops/join.html">Join as a shop</a>
            <a href="${base}faqs.html">FAQs</a>
            <a href="${base}account.html">Account</a>
          </div>
        </div>
        <div class="footer-bottom">
          <span>hometowncrawls.com</span>
          <span>Made for main streets &amp; independent shops</span>
        </div>
      </div>`;
  }

  window.HC = window.HC || {};
  window.HC.base = base;
  window.HC.toast = function (msg) {
    document.querySelectorAll(".toast").forEach((t) => t.remove());
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2800);
  };
  window.HC.initials = function (name) {
    return (name || "?")
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  };

  document.addEventListener("DOMContentLoaded", () => {
    injectHeader();
    injectFooter();
  });
})();
