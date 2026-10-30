/* Shared chrome: header, footer, mobile nav, toasts, path helpers */
(function () {
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const depth = path.split("/").filter(Boolean).length;
  // Root pages sit at /, shops/join at /shops/, crawl at /puyallupwa/coffee/
  function assetPrefix() {
    if (path === "/puyallup" || path.startsWith("/puyallup/") || path.startsWith("/arlington/")) return "/";
    // Nested account pages (/account/store/help) need root-absolute links.
    if (path.startsWith("/account/")) return "/";
    if (path.includes("/puyallupwa/")) return "../../";
    if (path.includes("/shops/") || path.includes("/guides/")) return "../";
    return "";
  }
  const base = assetPrefix();

  function isCurrent(href) {
    const clean = href.replace(/^\.\.\//, "").replace(/^\.\.\//, "");
    const target = clean === "index.html" || clean === "" ? "/" : "/" + clean.replace(/\.html$/, "").replace(/\/index$/, "");
    const here = path === "" || path === "/" ? "/" : path;
    if (target === "/") return here === "/" || here === "/index.html" || here.endsWith("/index");
    return here === target || here.startsWith(target + "/");
  }

  function link(href, label) {
    const full = base + href;
    const cur = isCurrent(href) ? ' aria-current="page"' : "";
    return `<a href="${full}"${cur}>${label}</a>`;
  }

  function injectHeader() {
    const el = document.getElementById("site-header");
    if (!el) return;
    el.innerHTML = `
      <div class="wrap nav">
        <a class="wordmark" href="${base}index.html" aria-label="Hometown Crawls home"><img src="/assets/home/wordmark-phone.png" alt="Hometown Crawls" width="2048" height="768" /></a>
        <nav class="nav-links" id="nav-links">
          ${link("puyallup/holiday-coffee-crawl", "Find a crawl")}
          ${link("map.html", "Map")}
          ${link("rules.html", "Rules")}
          ${link("faqs.html", "FAQs")}
          ${link("organize.html", "Start a crawl")}
        </nav>
        <div class="nav-end">
          <a class="nav-login" id="nav-login" href="${base}account.html">Log in</a>
          <button class="nav-toggle" type="button" aria-label="Menu" aria-expanded="false" aria-controls="nav-links" id="nav-toggle"><span></span></button>
        </div>
      </div>`;

    const toggle = el.querySelector("#nav-toggle");
    const links = el.querySelector("#nav-links");
    toggle?.addEventListener("click", () => {
      const open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    paintLogin(el);
  }

  function sessionUser() {
    try {
      const raw = localStorage.getItem("sb-tatwbjuwufeqynpufodq-auth-token");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const user = parsed.user || (parsed.currentSession && parsed.currentSession.user) || null;
      if (!user || user.is_anonymous || !user.email) return null;
      return user;
    } catch (e) {
      return null;
    }
  }

  function paintLogin(el) {
    const link = el.querySelector("#nav-login");
    if (!link) return;
    const user = sessionUser();
    const href = (window.HC && window.HC.base ? window.HC.base : "") + "account.html";
    link.setAttribute("href", href);
    if (!user) {
      link.dataset.signed = "0";
      link.innerHTML = "Log in";
      link.setAttribute("aria-label", "Log in");
      return;
    }
    const letter = String(user.email).trim().charAt(0).toUpperCase() || "Me";
    link.dataset.signed = "1";
    link.innerHTML = '<span class="nav-login-mark" aria-hidden="true">' + letter + '</span><span class="nav-login-words">My account</span>';
    link.setAttribute("aria-label", "My account");
  }

  function injectFooter() {
    const el = document.getElementById("site-footer");
    if (!el) return;
    el.innerHTML = `
      <div class="wrap">
        <div class="footer-grid">
          <div>
            <a class="wordmark footer-wordmark" href="${base}index.html" aria-label="Hometown Crawls home"><img src="/assets/home/wordmark-footer.png" alt="Hometown Crawls" width="2048" height="768" /></a>
            <p class="small" style="opacity:.75;max-width:32ch">Coffee, pubs, restaurants, gift shops, and more.</p>
          </div>
          <div class="footer-col">
            <h4>Explore</h4>
            <a href="${base}puyallup/holiday-coffee-crawl">Holiday coffee trail</a>
            <a href="${base}map.html">Map</a>
            <a href="${base}prizes.html">Prizes</a>
            <a href="${base}rules.html">Rules</a>
            ${link("puyallup/holiday-coffee-crawl/rules", "Official Rules")}
            ${link("privacy", "Privacy")}
            <a href="${base}guides/how-a-hometown-coffee-crawl-works.html">Guides</a>
          </div>
          <div class="footer-col">
            <h4>Partners</h4>
            <a href="${base}organize.html">Start a crawl</a>
            <a href="${base}puyallup/coffee-crawl">Join as a shop</a>
            <a href="${base}faqs.html">FAQs</a>
            <a href="${base}account">Account</a>
            ${link("support", "Support")}
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
  window.HC.refreshLogin = function () {
    const header = document.getElementById("site-header");
    if (header) paintLogin(header);
  };
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
    const main = document.querySelector("main");
    if (main && !main.id) main.id = "main";
    if (!document.querySelector(".skip-link")) {
      const skip = document.createElement("a");
      skip.className = "skip-link";
      skip.href = "#main";
      skip.textContent = "Skip to content";
      document.body.insertBefore(skip, document.body.firstChild);
    }
    if (!document.querySelector("link[rel='icon']")) {
      const icon = document.createElement("link");
      icon.rel = "icon";
      icon.href = "/favicon.ico";
      document.head.appendChild(icon);
    }
    if (!document.body.classList.contains("home-page") && !document.querySelector("link[href*='fonts.googleapis.com']")) {
      const fonts = document.createElement("link");
      fonts.rel = "stylesheet";
      fonts.href = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;700&family=Outfit:wght@400;500;600;700&display=swap";
      document.head.appendChild(fonts);
      const appCss = document.createElement("link");
      appCss.rel = "stylesheet";
      appCss.href = "/assets/app.css";
      document.head.appendChild(appCss);
    }
    injectHeader();
    injectFooter();
  });
})();
