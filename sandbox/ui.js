/* Hometown Crawls sandbox UI. Client-side demo only. */
(function () {
  const S = window.HCSandboxStore;
  if (!S) return;

  let state = S.loadState(localStorage);
  let flash = null;
  let mapRef = null;
  let mapPayload = null;
  let lastHash = "";

  const ROLES = [
    { id: "guest", label: "Guest" },
    { id: "shop", label: "Shop" },
    { id: "organizer", label: "Organizer" },
    { id: "admin", label: "Admin" }
  ];

  function persist() {
    try {
      S.saveState(localStorage, state);
      return true;
    } catch (err) {
      return false;
    }
  }

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function safeSrc(url) {
    const value = String(url || "");
    if (/^https:\/\/images\.unsplash\.com\//.test(value)) return value;
    if (/^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(value)) return value;
    return "";
  }

  function takeFlash() {
    const current = flash;
    flash = null;
    return current
      ? `<div class="${current.type === "error" ? "form-error" : "form-success"} show" role="status">${esc(current.text)}</div>`
      : "";
  }

  function setHash(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  function parseHash() {
    const parts = (location.hash || "#/ideas").replace(/^#/, "").split("/").filter(Boolean);
    const head = parts[0] || "ideas";
    if (head === "ideas") return { name: "ideas" };
    if (head === "shop") return { name: "shop", tab: ["checklist", "tent", "stats", "redeem"].includes(parts[1]) ? parts[1] : "checklist" };
    if (head === "organizer") {
      const tab = parts[1] || "dashboard";
      return { name: "organizer", tab: ["dashboard", "launch", "roi"].includes(tab) ? tab : "dashboard" };
    }
    if (head === "admin") {
      const tab = parts[1] || "crawls";
      return { name: "admin", tab: ["crawls", "applications", "shops", "log"].includes(tab) ? tab : "crawls" };
    }
    if (head === "guest") return { name: "guest", crawl: S.activeCrawl(state), tab: parts[1] === "scan" || parts[1] === "done" ? parts[1] : "passport" };
    if (parts.length >= 3) {
      const crawl = S.crawlByRoute(state, parts[0], parts[1], parts[2]);
      const tab = parts[3] === "scan" || parts[3] === "done" ? parts[3] : "passport";
      return { name: "guest", crawl, tab, missing: !crawl };
    }
    return { name: "ideas" };
  }

  function syncRoute(route) {
    if (!route.crawl) return;
    if (state.activeCrawlId === route.crawl.id) return;
    state.activeCrawlId = route.crawl.id;
    const shops = S.shopsFor(state, route.crawl.id);
    if (!shops.some((shop) => shop.id === state.activeShopId)) state.activeShopId = shops[0] ? shops[0].id : "";
    persist();
  }

  function you(crawlId) {
    const crawl = crawlId || (S.activeCrawl(state) && S.activeCrawl(state).id);
    return state.guests.find((person) => person.you && person.crawlId === crawl)
      || S.guestById(state, state.youGuestId)
      || state.guests[0];
  }

  function bannerHtml() {
    const roles = ROLES.map((role) => {
      const pressed = state.role === role.id ? "true" : "false";
      return `<button type="button" data-action="set-role" data-role="${role.id}" aria-pressed="${pressed}">${role.label}</button>`;
    }).join("");
    return `
      <div class="sandbox-banner-inner">
        <p class="sandbox-kicker">SANDBOX - demo data, no real money</p>
        <div class="sandbox-controls">
          <div class="role-switch" role="group" aria-label="Switch the demo view. No sign-in.">${roles}</div>
          <button type="button" class="banner-reset" data-action="reset">Reset demo</button>
        </div>
      </div>`;
  }

  function headerHtml(route) {
    const crawl = route.crawl || S.activeCrawl(state);
    const passport = S.routeFor(crawl);
    const links = [
      ["#/ideas", "Ideas", route.name === "ideas"],
      [passport, "Passport", route.name === "guest"],
      ["#/shop/checklist", "Shop desk", route.name === "shop"],
      ["#/organizer", "Organize", route.name === "organizer"],
      ["#/admin", "Admin", route.name === "admin"]
    ];
    return `
      <div class="wrap nav">
        <a class="brand" href="#/ideas">
          <span class="brand-mark" aria-hidden="true">☕</span>
          HOMETOWN CRAWLS
        </a>
        <button class="nav-toggle" type="button" aria-label="Menu" id="nav-toggle"><span></span></button>
        <nav class="nav-links" id="nav-links">
          ${links.map(([href, label, current]) => `<a href="${href}"${current ? ' aria-current="page"' : ""}>${label}</a>`).join("")}
        </nav>
      </div>`;
  }

  function tabs(items) {
    return `<nav class="sandbox-tabs" aria-label="Section">${items.map((item) =>
      `<a href="${item.href}"${item.on ? ' aria-current="page"' : ""}>${esc(item.label)}</a>`
    ).join("")}</nav>`;
  }

  function crawlOptions(selected) {
    return state.crawls.map((crawl) =>
      `<option value="${esc(crawl.id)}"${crawl.id === selected ? " selected" : ""}>${esc(crawl.name)} · ${esc(crawl.city)}</option>`
    ).join("");
  }

  function crawlSwitch(selected, context, tab) {
    if (state.crawls.length < 2 && context !== "guest") return "";
    return `<label class="field">Demo crawl
      <select class="input" data-action="switch-crawl" data-context="${esc(context)}" data-tab="${esc(tab || "")}">${crawlOptions(selected)}</select>
    </label>`;
  }

  function routeNote(crawl) {
    const pretty = `/sandbox/${crawl.stateSlug}/${crawl.citySlug}/${crawl.slug}`;
    return `<p class="small muted">Demo route ${esc(pretty)}. This static preview opens it as <a href="${S.routeFor(crawl)}">${esc(S.routeFor(crawl))}</a>.</p>`;
  }

  function noticeBlock(html) {
    return html ? `<div class="mt-2">${html}</div>` : "";
  }

  function ideasHtml(notice) {
    const groups = ["Guest", "Shop", "Organizer", "Admin"];
    const cards = groups.map((group) => {
      const items = S.IDEAS.filter((idea) => idea.group === group).map((idea) => `
        <article class="card idea-card">
          <div class="row">
            <p class="eyebrow">${esc(group)}</p>
            ${ideaButton(idea.id)}
          </div>
          <h3>${esc(idea.title)}</h3>
          <p class="muted small">${esc(idea.summary)}</p>
          <a class="btn btn-primary mt-2" data-role-link="${esc(idea.role)}" href="${idea.hash}">Open demo</a>
        </article>`).join("");
      return `<section class="mt-3"><h2>${esc(group)}</h2><div class="grid mt-2">${items}</div></section>`;
    }).join("");
    return `
      <div class="wrap page-hero">
        <p class="eyebrow">For Chris · idea review</p>
        <h1>Sandbox feature ideas</h1>
        <p>Click through each idea. The badge starts at Proposed — press it to mark Approved, Needs changes, or Skip. That choice stays in this browser until you reset the demo. The role switcher changes the view without sign-in.</p>
        ${noticeBlock(notice)}
      </div>
      <div class="wrap" style="padding-bottom:2rem">${cards}</div>`;
  }

  function ideaButton(id) {
    const status = state.ideaStatus[id] || "proposed";
    const label = S.ideaLabel(status);
    const cls = status === "approved" ? "pill-ok" : status === "skip" ? "pill-muted" : status === "changes" ? "pill-changes" : "pill-wait";
    return `<button type="button" class="pill ${cls} status-btn" data-action="cycle-idea" data-id="${esc(id)}" aria-label="Idea status ${esc(label)}. Activate to change it.">${esc(label)}</button>`;
  }

  function guestHtml(route, notice) {
    if (route.missing || !route.crawl) {
      return `<div class="wrap page-hero"><h1>That demo crawl is not on this browser</h1><p>Launch one from the organizer wizard, or reset the demo to restore Holiday Coffee Crawl.</p>${noticeBlock(notice)}<div class="row mt-2"><a class="btn btn-primary" href="#/organizer/launch">Launch wizard</a><a class="btn btn-ghost" href="#/ideas">Ideas</a></div></div>`;
    }
    const crawl = route.crawl;
    const guest = you();
    const prog = S.progress(state, crawl.id, guest.id);
    const color = S.safeColor(crawl.color);
    const logo = crawl.logoImage && safeSrc(crawl.logoImage)
      ? `<img src="${safeSrc(crawl.logoImage)}" alt="" style="width:42px;height:42px;border-radius:50%;object-fit:cover">`
      : esc(crawl.logo || "☕");
    const statusLine = crawl.status === "pending"
      ? `<div class="callout mt-2">Pending admin approval. This route already works so you can preview it. Approve the matching application under Admin. No email is sent.</div>`
      : crawl.status === "rejected"
        ? `<div class="callout mt-2">This example crawl was rejected in the sandbox. The page stays available for review.</div>`
        : "";
    const guestTabs = tabs([
      { href: S.routeFor(crawl), label: "Passport", on: route.tab === "passport" },
      { href: S.routeFor(crawl, "scan"), label: "Scan to stamp", on: route.tab === "scan" },
      { href: S.routeFor(crawl, "done"), label: "I finished", on: route.tab === "done" }
    ]);
    let body = "";
    if (route.tab === "scan") body = scanHtml(crawl, guest, prog);
    else if (route.tab === "done") body = doneHtml(crawl, guest, prog);
    else body = passportHtml(crawl, guest, prog);
    return `
      <div class="wrap">
        <section class="hero" style="background:linear-gradient(135deg, ${color}d9, rgba(18,36,22,.78)), #223 url(https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&w=1600&q=70) center/cover">
          <div class="hero-inner">
            <p class="eyebrow">${esc(crawl.city)}, USA · ${esc(S.templateById(crawl.templateId).label)}</p>
            <h1>${logo} ${esc(crawl.name)}</h1>
            <p>${esc(S.displayRange(crawl))}. Viewing as ${esc(guest.name)}, a demo guest. No sign-in.</p>
            ${routeNote(crawl)}
          </div>
        </section>
        ${guestTabs}
        ${statusLine}
        ${noticeBlock(notice)}
        <div class="mt-2" style="max-width:360px">${crawlSwitch(crawl.id, "guest", route.tab)}</div>
        ${body}
      </div>`;
  }

  function passportHtml(crawl, guest, prog) {
    const stops = S.onMapShops(state, crawl.id);
    const off = S.shopsFor(state, crawl.id).filter((shop) => !shop.onMap);
    const stamped = new Set(prog.gotShops.map((shop) => shop.id));
    mapPayload = {
      color: S.safeColor(crawl.color),
      shops: stops.map((shop) => ({
        id: shop.id,
        name: shop.name,
        address: shop.address,
        lat: shop.lat,
        lng: shop.lng,
        stamped: stamped.has(shop.id)
      }))
    };
    const width = prog.total ? Math.round((prog.got / prog.total) * 100) : 0;
    const nudge = prog.nudge === "You're 2 away"
      ? `<div class="nudge"><strong>You're 2 away</strong><p>Two more example shops and this passport is full: ${esc(prog.nextShops.map((shop) => shop.name).join(" and "))}.</p></div>`
      : prog.nudge === "You're 1 away"
        ? `<div class="nudge"><strong>You're 1 away</strong><p>One example shop left: ${esc(prog.nextShops[0] ? prog.nextShops[0].name : "the last stop")}.</p></div>`
        : "";
    const stamps = stops.map((shop) => {
      const got = stamped.has(shop.id);
      const src = safeSrc(shop.photo);
      const inner = got && src ? `<img src="${src}" alt="">` : esc(shop.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").slice(0, 2));
      return `<div class="stamp ${got ? "got" : ""}" title="${esc(shop.name)}">${inner}</div>`;
    }).join("");
    const prizes = (crawl.prizes || []).map((prize) => {
      const open = prog.got >= Number(prize.stamps);
      return `<li class="${open ? "is-open" : ""}"><span>${esc(prize.stamps)} stamps · ${esc(prize.name)}</span><span class="example-flag">${open ? "Unlocked · Example" : "Example"}</span></li>`;
    }).join("");
    const shopRows = stops.map((shop) => {
      const got = stamped.has(shop.id);
      const src = safeSrc(shop.photo);
      return `<div class="shop-row">
        <div class="shop-avatar">${src ? `<img src="${src}" alt="">` : esc(shop.name.slice(0, 1))}</div>
        <div style="flex:1">
          <strong>${esc(shop.name)}</strong>
          <p class="small muted">${esc(shop.address)}</p>
        </div>
        ${got ? `<span class="pill pill-ok">Stamped</span>` : `<a class="btn btn-soft" href="${S.routeFor(crawl, "scan")}" data-action="prefill-scan" data-shop="${esc(shop.id)}">Stamp</a>`}
      </div>`;
    }).join("");
    const hidden = off.length
      ? `<div class="card mt-2"><h3>Not on the map yet</h3><p class="muted small mt-1">Admin can turn these pins on. They are not part of the passport count.</p>${off.map((shop) => `<p class="mt-1"><strong>${esc(shop.name)}</strong> <span class="small muted">${esc(shop.address)}</span></p>`).join("")}</div>`
      : "";
    return `
      <section class="section" style="padding-top:0.5rem">
        <div class="sandbox-split">
          <div class="card">
            <div class="row">
              <span class="pill pill-ok">${esc(crawl.status)}</span>
              <span class="pill pill-wait">${esc(S.displayRange(crawl))}</span>
            </div>
            <h2 class="mt-2">Your passport</h2>
            <p class="muted mt-1">Demo clock ${esc(prettyDay(state.demoToday))}. Sample stamps run Nov 1–21. Prize tiers below are examples, not real decisions.</p>
            <div class="progress mt-2" aria-valuemin="0" aria-valuemax="${prog.total}" aria-valuenow="${prog.got}" role="progressbar" aria-label="Passport progress">
              <span style="width:${width}%"></span>
            </div>
            <p class="small mt-1">${prog.got} of ${prog.total} stamps</p>
            ${nudge}
            <div class="stamp-grid">${stamps || `<p class="muted">No shops are on the map yet.</p>`}</div>
            <ul class="prize-list">${prizes}</ul>
            <div class="row mt-2">
              <a class="btn btn-primary" href="${S.routeFor(crawl, "scan")}">Scan to stamp</a>
              <a class="btn btn-ghost" href="${S.routeFor(crawl, "done")}">Finish card</a>
            </div>
          </div>
          <div class="card" style="padding:0;overflow:hidden">
            <div class="map-frame" style="border:0;border-radius:0;height:420px">
              <div id="sandbox-map" class="leaflet-map" role="region" aria-label="Demo map of fictional shops"></div>
            </div>
            <p class="map-note small muted">Pins are fictional Demo Town examples on a stand-in map. They are not real businesses.</p>
          </div>
        </div>
        <div class="card mt-2">
          <h2>Stops</h2>
          ${shopRows || `<p class="muted mt-1">Shops appear here when an admin marks them on the map.</p>`}
        </div>
        ${hidden}
      </section>`;
  }

  function scanHtml(crawl, guest, prog) {
    const stops = S.onMapShops(state, crawl.id);
    const selected = state.scanDraft.shopId;
    const options = stops.map((shop) =>
      `<option value="${esc(shop.id)}"${shop.id === selected ? " selected" : ""}>${esc(shop.name)}</option>`
    ).join("");
    const hints = stops.map((shop) => `<li><strong>${esc(shop.name)}</strong> · ${esc(shop.code)}</li>`).join("");
    const place = state.scanDraft.place === "far" ? "far" : "near";
    return `
      <section class="section" style="padding-top:0">
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
          <form class="card" data-form="stamp">
            <p class="eyebrow">Simulated scan</p>
            <h2>Stamp at the counter</h2>
            <p class="muted small mt-1">${esc(guest.name)} has ${prog.got} of ${prog.total}. Pick a shop, enter its code, and choose a simulated spot. The fence is ${S.GEOFENCE_M} meters, same idea as the live crawl. Nothing is sent to a server.</p>
            <label class="field mt-2">Shop
              <select class="input" data-bucket="scan" data-field="shopId">${options}</select>
            </label>
            <label class="field">Counter code
              <input class="input" data-bucket="scan" data-field="code" value="${esc(state.scanDraft.code || "")}" autocomplete="off" spellcheck="false" placeholder="Type the tent-card code">
            </label>
            <label class="choice"><input type="radio" name="place" value="near" data-bucket="scan" data-field="place"${place === "near" ? " checked" : ""}> <span><strong>At the counter</strong><small>Simulated, inside the 150 m fence.</small></span></label>
            <label class="choice"><input type="radio" name="place" value="far" data-bucket="scan" data-field="place"${place === "far" ? " checked" : ""}> <span><strong>Across town</strong><small>Simulated, outside the fence. The stamp should fail.</small></span></label>
            <button class="btn btn-primary" type="submit">Stamp this shop</button>
            <details class="mt-2">
              <summary class="small">Sandbox hint: example counter codes</summary>
              <ul class="mt-1 small">${hints}</ul>
            </details>
          </form>
          <div class="card">
            <h3>How this stays a demo</h3>
            <p class="muted mt-1">There is no camera, no live GPS prompt, and no stamp is written to Hometown Crawls. Reset demo puts ${esc(guest.name)} back at 6 of 8, which is where the “You're 2 away” nudge starts.</p>
            ${prog.nudge === "You're 2 away" ? `<div class="nudge"><strong>You're 2 away</strong><p>Still two shops left before the example grand-prize drawing.</p></div>` : ""}
            ${prog.done ? `<p class="mt-2"><a class="btn btn-soft" href="${S.routeFor(crawl, "done")}">See the voucher</a></p>` : ""}
          </div>
        </div>
      </section>`;
  }

  function doneHtml(crawl, guest, prog) {
    const sample = S.guestsFor(state, crawl.id).find((person) => person.voucher && person.id !== guest.id);
    let primary = "";
    if (prog.done && guest.voucher) {
        primary = `<h2>You finished</h2><p class="muted mt-1">This voucher is an example code for the sandbox. Shops can redeem it on the shop desk.</p>${shareCardHtml(guest, crawl, false)}`;
    } else if (prog.total === 0) {
      primary = `<h2>Nothing to finish yet</h2><p class="muted mt-1">Put shops on the map before this passport can be completed.</p>`;
    } else {
      primary = `<h2>${prog.remaining} stamp${prog.remaining === 1 ? "" : "s"} to go</h2>
        <p class="muted mt-1">${esc(guest.name)} has ${prog.got} of ${prog.total}. Finish from Scan to stamp, or review an example card from a guest who already completed the sample data.</p>
        <a class="btn btn-primary mt-2" href="${S.routeFor(crawl, "scan")}">Scan to stamp</a>
        ${prog.nudge === "You're 2 away" ? `<div class="nudge"><strong>You're 2 away</strong></div>` : ""}`;
    }
    const example = sample
      ? `<div class="mt-3"><p class="example-flag">Example card · not ${esc(guest.name)}'s voucher</p>${shareCardHtml(sample, crawl, true)}</div>`
      : "";
    return `<section class="section" style="padding-top:0"><div class="card">${primary}${example}</div></section>`;
  }

  function shareCardHtml(guest, crawl, example) {
    const caption = `${example ? "EXAMPLE card. " : ""}I finished the ${crawl.name} in ${crawl.city}. ${guest.name} · voucher ${guest.voucher}. Sandbox demo, not a real prize.`;
    return `
      <article class="share-card mt-2">
        <p class="eyebrow">${example ? "Example · I finished" : "I finished"}</p>
        <h3 style="margin-top:.35rem">${esc(crawl.name)}</h3>
        <p>${esc(guest.name)} · ${esc(crawl.city)}, USA</p>
        <p class="small" style="opacity:.8">${esc(S.displayRange(crawl))} · full example passport</p>
        <p class="voucher-code">${esc(guest.voucher)}</p>
        <p class="small" style="opacity:.75;margin-top:.55rem">${example ? "Example voucher. Not a real prize." : "Example voucher code. Not a real prize."}</p>
      </article>
      <label class="field mt-2">Share caption
        <textarea class="input" readonly rows="3">${esc(caption)}</textarea>
      </label>
      <div class="row mt-2">
        <button type="button" class="btn btn-primary" data-action="share-card" data-guest="${esc(guest.id)}" data-crawl="${esc(crawl.id)}" data-example="${example ? "yes" : "no"}">Share caption</button>
        <button type="button" class="btn btn-ghost" data-action="download-card" data-guest="${esc(guest.id)}" data-crawl="${esc(crawl.id)}" data-example="${example ? "yes" : "no"}">Download card</button>
        <button type="button" class="btn btn-ghost" data-action="copy-code" data-code="${esc(caption)}">Copy caption</button>
      </div>`;
  }

  function shopHtml(route, notice) {
    const crawl = S.activeCrawl(state);
    const shop = S.activeShop(state);
    const shopTabs = tabs([
      { href: "#/shop/checklist", label: "Checklist", on: route.tab === "checklist" },
      { href: "#/shop/tent", label: "Tent card", on: route.tab === "tent" },
      { href: "#/shop/stats", label: "Visit stats", on: route.tab === "stats" },
      { href: "#/shop/redeem", label: "Redeem", on: route.tab === "redeem" }
    ]);
    if (!shop) {
      return `<div class="wrap page-hero"><h1>Shop desk</h1><p>This demo crawl has no shops yet.</p>${shopTabs}${noticeBlock(notice)}</div>`;
    }
    const options = S.shopsFor(state, crawl.id).map((item) =>
      `<option value="${esc(item.id)}"${item.id === shop.id ? " selected" : ""}>${esc(item.name)}</option>`
    ).join("");
    let body = "";
    if (route.tab === "tent") body = tentHtml(crawl, shop);
    else if (route.tab === "stats") body = statsHtml(crawl, shop);
    else if (route.tab === "redeem") body = redeemHtml(crawl, shop);
    else body = checklistHtml(crawl, shop);
    return `
      <div class="wrap page-hero">
        <p class="eyebrow">Shop · no sign-in</p>
        <h1>${esc(shop.name)}</h1>
        <p>Viewing the ${esc(crawl.name)} desk. Edits stay in this browser.</p>
        ${routeNote(crawl)}
        ${noticeBlock(notice)}
        <div class="grid mt-2" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr));max-width:760px">
          ${crawlSwitch(crawl.id, "shop", route.tab)}
          <label class="field">This shop
            <select class="input" data-action="switch-shop">${options}</select>
          </label>
        </div>
        ${shopTabs}
        ${body}
      </div>`;
  }

  function checklistHtml(crawl, shop) {
    const checks = shop.checks || {};
    const done = ["address", "photo", "hours", "offer"].filter((key) => checks[key]).length;
    const src = safeSrc(shop.photo);
    const line = (key, label) => `<label class="check-line"><input type="checkbox" data-action="shop-check" data-check="${key}"${checks[key] ? " checked" : ""}> <span>${label}</span></label>`;
    return `
      <section class="section" style="padding-top:0">
        <div class="card">
          <div class="row"><span class="pill ${done === 4 ? "pill-ok" : "pill-wait"}">${done} of 4 confirmed</span><span class="pill ${shop.paid ? "pill-ok" : "pill-muted"}">${shop.paid ? "Paid example seat" : "Not marked paid"}</span></div>
          <h2 class="mt-2">Onboarding checklist</h2>
          <p class="muted small mt-1">Confirm address, photo, hours, and the offer. The offer is an example, not a real shop decision. Paid and “on the map” are admin flags.</p>
          <label class="field mt-2">Address<input class="input" data-bucket="shop" data-field="address" value="${esc(shop.address || "")}"></label>
          ${line("address", "Address confirmed")}
          <div class="row">
            ${src ? `<img src="${src}" alt="" style="width:96px;height:72px;object-fit:cover;border-radius:10px">` : ""}
            <label class="field" style="flex:1">Photo<input class="input" type="file" accept="image/*" data-action="shop-photo"></label>
          </div>
          ${line("photo", "Photo confirmed")}
          <label class="field">Hours<input class="input" data-bucket="shop" data-field="hours" value="${esc(shop.hours || "")}"></label>
          ${line("hours", "Hours confirmed")}
          <label class="field">Offer<textarea class="input" data-bucket="shop" data-field="offer">${esc(shop.offer || "")}</textarea></label>
          ${line("offer", "Offer confirmed")}
          ${done === 4 && !shop.cardReady ? `<button type="button" class="btn btn-primary" data-action="mark-ready">Mark counter card ready</button>` : ""}
          ${shop.cardReady ? `<p class="small mt-1">Counter card is marked ready. Print it from the tent card tab.</p>` : `<p class="small muted">Card ready is separate from this checklist until you mark it, or an admin does.</p>`}
        </div>
      </section>`;
  }

  function tentHtml(crawl, shop) {
    const src = safeSrc(shop.photo);
    return `
      <section class="section" style="padding-top:0">
        <div class="no-print row" style="margin-bottom:1rem">
          <button type="button" class="btn btn-primary" data-action="print">Print tent card</button>
          <p class="small muted">Print styles hide the sandbox chrome and keep a one-card layout. The on-screen banner stays while you review.</p>
        </div>
        <article class="tent-sheet">
          <p class="example-flag">Sandbox demo card</p>
          <p class="eyebrow" style="margin-top:.6rem">${esc(crawl.name)}</p>
          ${src ? `<img src="${src}" alt="" style="width:100%;height:120px;object-fit:cover;border-radius:12px;margin:0.7rem 0">` : ""}
          <h2>${esc(shop.name)}</h2>
          <p class="muted small">${esc(shop.address)}</p>
          <div class="qr-slot" data-qr="SANDBOX:${esc(shop.code)}" aria-label="Demo QR for ${esc(shop.code)}"></div>
          <p class="small muted">Counter code</p>
          <p class="code">${esc(shop.code)}</p>
          <p class="small">Ask us to stamp your passport. Example card — not for a real counter.</p>
          <p class="small muted mt-1">${esc(shop.offer || "")}</p>
        </article>
      </section>`;
  }

  function statsHtml(crawl, shop) {
    const days = S.visitsByDay(state, shop.id);
    const max = Math.max(1, ...days.map((day) => day.count));
    const bars = days.map((day) => {
      const height = Math.max(4, Math.round((day.count / max) * 100));
      const label = day.date.slice(8);
      return `<div class="col" title="${esc(day.date)}: ${day.count} visits"><i style="height:${height}%"></i><b>${label}</b></div>`;
    }).join("");
    const repeats = S.repeatGuests(state, shop.id);
    const firsts = S.firstOnlyGuests(state, shop.id);
    const repeatList = repeats.slice(0, 8).map((row) =>
      `<div class="shop-row"><div class="shop-avatar">${esc(row.guest.name.slice(0, 1))}</div><div><strong>${esc(row.guest.name)}</strong><p class="small muted">${row.total} crawl stamps · ${row.others} other shop${row.others === 1 ? "" : "s"}</p></div></div>`
    ).join("");
    return `
      <section class="section" style="padding-top:0">
        <div class="metrics">
          <div class="card metric"><strong>${days.reduce((sum, day) => sum + day.count, 0)}</strong><span class="small muted">Visits in the sample</span></div>
          <div class="card metric"><strong>${repeats.length}</strong><span class="small muted">Repeat guests</span></div>
          <div class="card metric"><strong>${firsts.length}</strong><span class="small muted">Only visited here</span></div>
          <div class="card metric"><strong>${days.length}</strong><span class="small muted">Days with a visit</span></div>
        </div>
        <div class="card mt-2">
          <h2>Visits per day</h2>
          <p class="muted small mt-1">Example stamps from Nov 1–21, plus any you add on the demo clock (${esc(prettyDay(state.demoToday))}).</p>
          ${days.length ? `<div class="bar-chart" role="img" aria-label="Visits per day for ${esc(shop.name)}">${bars}</div>` : `<p class="mt-2">No example visits yet.</p>`}
        </div>
        <div class="card mt-2">
          <h2>Repeat guests</h2>
          <p class="muted small mt-1">People who stamped ${esc(shop.name)} and at least one other shop on this crawl. One stamp per shop, so a “repeat” is a guest who kept crawling.</p>
          ${repeatList || `<p class="mt-2 muted">No repeat guests in the sample yet.</p>`}
          ${repeats.length > 8 ? `<p class="small muted mt-1">Showing 8 of ${repeats.length}.</p>` : ""}
        </div>
      </section>`;
  }

  function redeemHtml(crawl, shop) {
    const guests = S.guestsFor(state, crawl.id).filter((guest) => guest.voucher);
    const redeemed = new Set(state.redemptions.map((row) => row.guestId));
    const open = guests.find((guest) => !redeemed.has(guest.id));
    const used = guests.find((guest) => redeemed.has(guest.id));
    const mine = you();
    const recent = state.redemptions.filter((row) => row.crawlId === crawl.id).slice(-6).reverse().map((row) => {
      const guest = S.guestById(state, row.guestId);
      const where = S.shopById(state, row.shopId);
      return `<li class="mt-1"><strong>${esc(row.voucher)}</strong> · ${esc(guest ? guest.name : "Guest")} · ${esc(where ? where.name : "")}</li>`;
    }).join("");
    return `
      <section class="section" style="padding-top:0">
        <form class="card" data-form="redeem">
          <p class="eyebrow">Voucher</p>
          <h2>Mark a prize redeemed</h2>
          <p class="muted small mt-1">Enter the guest’s example voucher. This only updates the demo store. No email goes out.</p>
          <label class="field mt-2">Voucher code
            <input class="input" data-bucket="scan" data-field="voucher" value="${esc(state.scanDraft.voucher || "")}" autocomplete="off" spellcheck="false" placeholder="EX-······">
          </label>
          <button class="btn btn-primary" type="submit">Mark redeemed</button>
          <div class="callout mt-2">
            <p class="example-flag">Sandbox codes</p>
            ${open ? `<p class="mt-1">Open example: <strong>${esc(open.voucher)}</strong> · ${esc(open.name)}</p>` : `<p class="mt-1">Every seeded completer voucher is redeemed. Finish the passport as Alex to mint a new one.</p>`}
            ${used ? `<p>Already redeemed: <strong>${esc(used.voucher)}</strong> · ${esc(used.name)}</p>` : ""}
            ${mine && mine.voucher ? `<p>Your demo guest: <strong>${esc(mine.voucher)}</strong> · ${esc(mine.name)}</p>` : ""}
          </div>
        </form>
        <div class="card mt-2">
          <h3>Redeemed in this demo</h3>
          <ul>${recent || `<li class="muted">None beyond the hint above.</li>`}</ul>
        </div>
      </section>`;
  }

  function organizerHtml(route, notice) {
    const crawl = S.activeCrawl(state);
    const orgTabs = tabs([
      { href: "#/organizer", label: "Dashboard", on: route.tab === "dashboard" },
      { href: "#/organizer/launch", label: "Launch", on: route.tab === "launch" },
      { href: "#/organizer/roi", label: "ROI report", on: route.tab === "roi" }
    ]);
    let body = "";
    if (route.tab === "launch") body = wizardHtml();
    else if (route.tab === "roi") body = roiHtml(crawl);
    else body = dashboardHtml(crawl);
    return `
      <div class="wrap page-hero">
        <p class="eyebrow">Organizer · no sign-in</p>
        <h1>${route.tab === "launch" ? "Launch a crawl in your town" : esc(crawl.name)}</h1>
        <p>${route.tab === "launch" ? "The wizard writes a new demo crawl in this browser and a pending application. Checkout is simulated." : `Viewing as ${esc(crawl.organizer)}. ${esc(crawl.organization)}.`}</p>
        ${route.tab === "launch" ? "" : routeNote(crawl)}
        ${noticeBlock(notice)}
        ${route.tab === "launch" ? "" : `<div class="mt-2" style="max-width:420px">${crawlSwitch(crawl.id, "organizer", route.tab)}</div>`}
        ${orgTabs}
        ${body}
      </div>`;
  }

  function dashboardHtml(crawl) {
    const stats = S.dashboard(state, crawl.id);
    const shops = S.shopsFor(state, crawl.id);
    const guests = S.guestsFor(state, crawl.id);
    const shopRows = shops.map((shop) => {
      const visits = S.stampsFor(state, crawl.id).filter((stamp) => stamp.shopId === shop.id).length;
      return `<tr><td>${esc(shop.name)}</td><td>${shop.paid ? "Paid" : "Unpaid"}</td><td>${shop.onMap ? "On map" : "Hidden"}</td><td>${visits}</td></tr>`;
    }).join("");
    const guestRows = guests.map((guest) => {
      const prog = S.progress(state, crawl.id, guest.id);
      return `<tr data-guest-row="${esc(guest.name.toLowerCase())}"><td>${esc(guest.name)}</td><td>${prog.got}/${prog.total}</td><td>${prog.done ? "Complete" : "In progress"}</td><td>${esc(guest.voucher || "—")}</td></tr>`;
    }).join("");
    return `
      <section class="section" style="padding-top:0">
        <div class="metrics">
          <div class="card metric"><strong>${stats.shops}</strong><span class="small muted">Shops</span></div>
          <div class="card metric"><strong>${stats.guests}</strong><span class="small muted">Guests</span></div>
          <div class="card metric"><strong>${stats.stamps}</strong><span class="small muted">Stamps</span></div>
          <div class="card metric"><strong>${stats.completions}</strong><span class="small muted">Completions</span></div>
        </div>
        <div class="row mt-2">
          <button type="button" class="btn btn-primary" data-action="csv" data-kind="guests">Download guests CSV</button>
          <button type="button" class="btn btn-ghost" data-action="csv" data-kind="stamps">Download stamps CSV</button>
        </div>
        <div class="card mt-2">
          <h2>Shops</h2>
          <div class="table-scroll mt-2"><table class="data-table"><thead><tr><th>Shop</th><th>Seat</th><th>Map</th><th>Stamps</th></tr></thead><tbody>${shopRows || `<tr><td colspan="4">No shops yet.</td></tr>`}</tbody></table></div>
        </div>
        <div class="card mt-2">
          <div class="row" style="justify-content:space-between">
            <h2>Guests</h2>
            <label class="small">Search <input class="input" id="guest-filter" placeholder="Name" style="max-width:180px;display:inline-block"></label>
          </div>
          <div class="table-scroll guest-scroll mt-2"><table class="data-table"><thead><tr><th>Guest</th><th>Stamps</th><th>Status</th><th>Voucher</th></tr></thead><tbody>${guestRows || `<tr><td colspan="4">No guests yet. The launch wizard starts a crawl without sample guests.</td></tr>`}</tbody></table></div>
        </div>
      </section>`;
  }

  function wizardHtml() {
    const wizard = state.wizard;
    const step = wizard.step || 1;
    const dots = [1, 2, 3, 4, 5, 6, 7].map((n) => `<span class="${n === step ? "on" : n < step ? "done" : ""}">${n}</span>`).join("");
    let inner = "";
    if (step === 1) {
      inner = `
        <h2>Town</h2>
        <p class="muted small">The crawl is filed under /sandbox/{state}/{city}/{crawl}. Two letters like DS stay a short state code.</p>
        <label class="field mt-2">Town<input class="input" data-bucket="wizard" data-field="town" value="${esc(wizard.town)}" placeholder="Frostford"></label>
        <label class="field">State<input class="input" data-bucket="wizard" data-field="stateName" value="${esc(wizard.stateName)}" placeholder="DS"></label>`;
    } else if (step === 2) {
      inner = `
        <h2>Template</h2>
        <p class="muted small">Coffee, Taco, Ice Cream, or Small Business Saturday. Picking one fills example prizes and a sample price. You can edit them.</p>
        <div class="template-grid mt-2">${S.TEMPLATES.map((item) => `
          <button type="button" class="template-pick" data-action="pick-template" data-template="${item.id}" aria-pressed="${wizard.templateId === item.id ? "true" : "false"}">
            <span>${item.logo}</span><strong>${esc(item.label)}</strong><small class="muted">${esc(item.blurb)}</small>
          </button>`).join("")}</div>
        <label class="field mt-2">Crawl name<input class="input" data-bucket="wizard" data-field="crawlName" value="${esc(wizard.crawlName)}"></label>`;
    } else if (step === 3) {
      inner = `
        <h2>Dates</h2>
        <label class="field mt-2">Starts<input class="input" type="date" data-bucket="wizard" data-field="start" value="${esc(wizard.start)}"></label>
        <label class="field">Ends<input class="input" type="date" data-bucket="wizard" data-field="end" value="${esc(wizard.end)}"></label>`;
    } else if (step === 4) {
      const logos = ["☕", "🌮", "🍦", "🛍️", "🌟"];
      inner = `
        <h2>Colors and logo</h2>
        <label class="field mt-2">Color<input class="input" type="color" data-bucket="wizard" data-field="color" value="${esc(S.safeColor(wizard.color))}"></label>
        <div id="color-preview" style="height:42px;border-radius:12px;background:${S.safeColor(wizard.color)};margin-bottom:0.8rem"></div>
        <p class="small" style="font-weight:600">Logo</p>
        <div class="logo-choices mt-1">${logos.map((logo) => `<button type="button" data-action="pick-logo" data-logo="${logo}" aria-pressed="${wizard.logo === logo && !wizard.logoImage ? "true" : "false"}" aria-label="Logo ${logo}">${logo}</button>`).join("")}</div>
        <label class="field mt-2">Or upload a logo<input class="input" type="file" accept="image/*" data-action="logo-file"></label>
        ${wizard.logoImage && safeSrc(wizard.logoImage) ? `<img src="${safeSrc(wizard.logoImage)}" alt="" style="width:64px;height:64px;object-fit:cover;border-radius:12px">` : ""}`;
    } else if (step === 5) {
      const rows = (wizard.prizes || []).map((prize, index) => `
        <div class="row">
          <label class="field" style="width:110px">Stamps<input class="input" type="number" min="1" data-bucket="wizard" data-field="prize-stamps" data-index="${index}" value="${esc(prize.stamps)}"></label>
          <label class="field" style="flex:1">Prize name<input class="input" data-bucket="wizard" data-field="prize-name" data-index="${index}" value="${esc(prize.name)}"></label>
          <button type="button" class="btn btn-ghost" data-action="remove-prize" data-index="${index}">Remove</button>
        </div>
        <p class="example-flag" style="margin:-0.4rem 0 0.8rem">Example — not a real prize decision</p>`).join("");
      inner = `<h2>Prize tiers</h2><p class="muted small">These are examples for the demo, like 5 stamps for a sticker and all stops for a grand-prize drawing. This wizard creates 4 example shops, so set a tier at 4 stamps or fewer if you want to finish it in the demo.</p><div class="mt-2">${rows}</div><button type="button" class="btn btn-soft" data-action="add-prize">Add tier</button>`;
    } else if (step === 6) {
      inner = `
        <h2>Price per shop</h2>
        <p class="muted small">Example seat price. The next step simulates checkout and does not collect a card.</p>
        <label class="field mt-2">USD per shop<input class="input" type="number" min="0" step="1" data-bucket="wizard" data-field="pricePerShop" value="${esc(wizard.pricePerShop)}"></label>`;
    } else {
      const template = S.templateById(wizard.templateId);
      const prizes = (wizard.prizes || []).map((prize) => `<li>${esc(prize.stamps)} stamps · ${esc(prize.name)} <span class="example-flag">Example</span></li>`).join("");
      inner = `
        <h2>Review</h2>
        <ul class="mt-2" style="margin-left:1.1rem">
          <li>${esc(wizard.crawlName || "Untitled crawl")} · ${esc(wizard.town)}, ${esc(wizard.stateName)}</li>
          <li>${esc(template.label)} · ${esc(wizard.start)} to ${esc(wizard.end)}</li>
          <li>${S.money(Number(wizard.pricePerShop) || 0)} per shop</li>
        </ul>
        <ul class="prize-list">${prizes}</ul>
        <div class="callout mt-2">
          <p class="example-flag">Simulated checkout</p>
          <p class="mt-1">Shops would be asked for ${S.money(Number(wizard.pricePerShop) || 0)} each. No card form. Stripe is not loaded and nothing is charged.</p>
        </div>
        <p class="small muted mt-2">Creates four example shops (not paid, not on the map) and a pending organizer application.</p>`;
    }
    const nextLabel = step === 7 ? "Create demo crawl" : "Continue";
    const nextAction = step === 7 ? "create-crawl" : "wizard-next";
    return `
      <section class="section" style="padding-top:0">
        <div class="card">
          <div class="wizard-steps" aria-hidden="true">${dots}</div>
          <p class="small muted">Step ${step} of 7</p>
          ${inner}
          <div class="row mt-2">
            ${step > 1 ? `<button type="button" class="btn btn-ghost" data-action="wizard-back">Back</button>` : ""}
            <button type="button" class="btn btn-primary" data-action="${nextAction}">${nextLabel}</button>
          </div>
        </div>
      </section>`;
  }

  function roiHtml(crawl) {
    const report = S.roi(state, crawl.id);
    const max = Math.max(1, ...report.traffic.map((row) => row.visits));
    const bars = report.traffic.map((row) => {
      const width = Math.round((row.visits / max) * 100);
      return `<div class="traffic-row"><span>${esc(row.shop.name)}</span><span class="track"><i style="width:${width}%"></i></span><span>${row.visits}</span></div>`;
    }).join("");
    return `
      <section class="section" style="padding-top:0">
        <div class="no-print row" style="margin-bottom:1rem">
          <button type="button" class="btn btn-primary" data-action="print">Print one-pager</button>
        </div>
        <article class="card roi-sheet">
          <p class="example-flag">SANDBOX - demo data, no real money</p>
          <p class="eyebrow" style="margin-top:.7rem">Post-event ROI · example</p>
          <h2>${esc(crawl.name)}</h2>
          <p class="muted">${esc(crawl.city)}, ${esc(crawl.stateName)} · ${esc(S.displayRange(crawl))} · prepared for ${esc(crawl.organizer)}</p>
          <div class="metrics mt-2">
            <div class="metric"><strong>${report.traffic.reduce((sum, row) => sum + row.visits, 0)}</strong><span class="small muted">Foot-traffic stamps</span></div>
            <div class="metric"><strong>${report.completions}</strong><span class="small muted">Completions</span></div>
            <div class="metric"><strong>${report.newGuests}</strong><span class="small muted">New guests</span></div>
            <div class="metric"><strong>${report.returningGuests}</strong><span class="small muted">Returning guests</span></div>
          </div>
          <h3 class="mt-3">Foot traffic per shop</h3>
          <div class="mt-2">${bars || `<p class="muted">No example visits yet.</p>`}</div>
          <p class="small muted mt-2">New vs returning is an example flag on the sample guests, not a live identity graph. ${report.stops} shops are on the map. Prize tiers are examples, not decisions.</p>
        </article>
      </section>`;
  }

  function adminHtml(route, notice) {
    const adminTabs = tabs([
      { href: "#/admin", label: "Crawls", on: route.tab === "crawls" },
      { href: "#/admin/applications", label: "Applications", on: route.tab === "applications" },
      { href: "#/admin/shops", label: "Shop status", on: route.tab === "shops" },
      { href: "#/admin/log", label: "Action log", on: route.tab === "log" }
    ]);
    let body = "";
    if (route.tab === "applications") body = appsHtml();
    else if (route.tab === "shops") body = shopStatusHtml();
    else if (route.tab === "log") body = logHtml();
    else body = crawlsHtml();
    return `
      <div class="wrap page-hero">
        <p class="eyebrow">Admin · no sign-in</p>
        <h1>Sandbox admin</h1>
        <p>Approve example applications, set shop status, and write a simulated refund or resend to the log. No email and no Stripe.</p>
        ${noticeBlock(notice)}
        ${adminTabs}
        ${body}
      </div>`;
  }

  function crawlsHtml() {
    const rows = state.crawls.map((crawl) => {
      const stats = S.dashboard(state, crawl.id);
      return `<tr>
        <td><a href="${S.routeFor(crawl)}"><strong>${esc(crawl.name)}</strong></a><br><span class="small muted">/sandbox/${esc(crawl.stateSlug)}/${esc(crawl.citySlug)}/${esc(crawl.slug)}</span></td>
        <td>${esc(crawl.city)}</td>
        <td><span class="pill ${crawl.status === "live" ? "pill-ok" : crawl.status === "rejected" ? "pill-muted" : "pill-wait"}">${esc(crawl.status)}</span></td>
        <td>${stats.shops}</td>
        <td>${stats.guests}</td>
        <td>${esc(crawl.organizer)}</td>
      </tr>`;
    }).join("");
    return `<div class="card table-scroll"><table class="data-table"><thead><tr><th>Crawl</th><th>Town</th><th>Status</th><th>Shops</th><th>Guests</th><th>Organizer</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function appsHtml() {
    const cards = state.applications.map((app) => {
      const template = S.templateById(app.templateId);
      const actions = app.status === "pending"
        ? `<div class="row mt-2"><button type="button" class="btn btn-primary" data-action="decide" data-id="${esc(app.id)}" data-status="approved">Approve</button><button type="button" class="btn btn-ghost" data-action="decide" data-id="${esc(app.id)}" data-status="rejected">Reject</button></div>`
        : "";
      return `<article class="card">
        <div class="row"><span class="pill ${app.status === "approved" ? "pill-ok" : app.status === "rejected" ? "pill-muted" : "pill-wait"}">${esc(app.status)}</span><span class="small muted">${esc(app.submitted)}</span></div>
        <h3 class="mt-2">${esc(app.name)}</h3>
        <p>${esc(app.organization)}</p>
        <p class="small muted">${esc(app.town)}, ${esc(app.stateName)} · ${esc(template.label)}</p>
        <p class="small mt-1">${esc(app.note || "")}</p>
        ${actions}
      </article>`;
    }).join("");
    return `<div class="grid">${cards}</div>`;
  }

  function shopStatusHtml() {
    const filter = state.adminShopCrawl || "all";
    const crawls = filter === "all" ? state.crawls : state.crawls.filter((crawl) => crawl.id === filter);
    const blocks = crawls.map((crawl) => {
      const cards = S.shopsFor(state, crawl.id).map((shop) => {
        const flag = (key, on, label) => `<button type="button" class="btn ${on ? "btn-primary" : "btn-ghost"}" data-action="shop-flag" data-shop="${esc(shop.id)}" data-flag="${key}" data-value="${on ? "0" : "1"}" aria-pressed="${on ? "true" : "false"}">${label}</button>`;
        return `<article class="card">
          <h3>${esc(shop.name)}</h3>
          <p class="small muted">${esc(shop.address)}</p>
          <div class="row mt-2">
            ${flag("paid", shop.paid, shop.paid ? "Paid" : "Unpaid")}
            ${flag("onMap", shop.onMap, shop.onMap ? "On map" : "Off map")}
            ${flag("cardReady", shop.cardReady, shop.cardReady ? "Card ready" : "Card not ready")}
          </div>
        </article>`;
      }).join("");
      return `<section class="mt-3"><h2>${esc(crawl.name)}</h2><div class="grid mt-2">${cards}</div></section>`;
    }).join("");
    return `
      <label class="field" style="max-width:420px">Crawl
        <select class="input" data-action="admin-crawl-filter">
          <option value="all"${filter === "all" ? " selected" : ""}>All demo crawls</option>
          ${crawlOptions(filter)}
        </select>
      </label>
      <p class="small muted">Guests can stamp a shop that is on the map even if the example seat is unpaid, so the Demo Town passport can still be finished. Turning a shop off the map removes its pin and its stamp from the passport count.</p>
      ${blocks}`;
  }

  function logHtml() {
    const options = state.shops.map((shop) => {
      const crawl = S.crawlById(state, shop.crawlId);
      return `<option value="${esc(shop.id)}">${esc(shop.name)} · ${esc(crawl ? crawl.city : "")}</option>`;
    }).join("");
    const items = state.actionLog.map((entry) =>
      `<article class="card"><p class="small muted">${esc(entry.at.replace("T", " ").replace("Z", " UTC"))} · ${esc(entry.kind)}</p><p class="mt-1">${esc(entry.summary)}</p></article>`
    ).join("");
    return `
      <div class="card">
        <h2>Simulated actions</h2>
        <p class="muted small mt-1">Refund does not call Stripe. Resend does not send email. Both append a line here.</p>
        <label class="field mt-2">Shop<select class="input" id="action-shop">${options}</select></label>
        <div class="row">
          <button type="button" class="btn btn-primary" data-action="refund">Simulate refund</button>
          <button type="button" class="btn btn-ghost" data-action="resend">Simulate resend email</button>
        </div>
      </div>
      <div class="stack mt-2">${items}</div>`;
  }

  function mainHtml(route) {
    const notice = takeFlash();
    if (route.name === "shop") return shopHtml(route, notice);
    if (route.name === "organizer") return organizerHtml(route, notice);
    if (route.name === "admin") return adminHtml(route, notice);
    if (route.name === "guest") return guestHtml(route, notice);
    return ideasHtml(notice);
  }

  function titleFor(route) {
    if (route.name === "shop") return "Shop desk";
    if (route.name === "organizer") return route.tab === "launch" ? "Launch a crawl" : "Organizer";
    if (route.name === "admin") return "Admin";
    if (route.name === "guest" && route.crawl) return route.crawl.name;
    return "Feature ideas";
  }

  function teardownMap() {
    if (mapRef) {
      mapRef.remove();
      mapRef = null;
    }
    mapPayload = null;
  }

  function mountMap() {
    const el = document.getElementById("sandbox-map");
    const payload = mapPayload;
    if (!el || !payload) return;
    if (!window.L) {
      el.innerHTML = "<p class='muted' style='padding:1rem'>The map library did not load. The shop list still works.</p>";
      return;
    }
    const shops = payload.shops || [];
    const center = shops[0] ? [shops[0].lat, shops[0].lng] : [38.971, -95.235];
    mapRef = window.L.map(el).setView(center, 15);
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap"
    }).addTo(mapRef);
    const bounds = [];
    shops.forEach((shop) => {
      bounds.push([shop.lat, shop.lng]);
      const marker = window.L.circleMarker([shop.lat, shop.lng], {
        radius: 9,
        color: "#fffdf8",
        weight: 2,
        fillColor: shop.stamped ? "#1f3a24" : payload.color,
        fillOpacity: 0.95
      }).addTo(mapRef);
      marker.bindPopup(
        `<strong>${esc(shop.name)}</strong><br><span style="color:#6b6558">${esc(shop.address)}</span><br>` +
        `<button type="button" class="btn btn-soft" data-action="prefill-scan" data-shop="${esc(shop.id)}" style="margin-top:.45rem">Stamp here</button>`
      );
    });
    if (bounds.length > 1) mapRef.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });
    setTimeout(() => { if (mapRef) mapRef.invalidateSize(); }, 180);
  }

  function mountQr() {
    document.querySelectorAll("[data-qr]").forEach((el) => {
      const text = el.getAttribute("data-qr");
      el.innerHTML = "";
      if (!text || !window.QRCode) {
        el.innerHTML = "<p class='small muted'>QR preview unavailable. Use the code below.</p>";
        return;
      }
      new window.QRCode(el, {
        text,
        width: 168,
        height: 168,
        colorDark: "#1f3a24",
        colorLight: "#fffdf8",
        correctLevel: window.QRCode.CorrectLevel.M
      });
    });
  }

  function bindFilter() {
    const filter = document.getElementById("guest-filter");
    if (!filter) return;
    filter.addEventListener("input", () => {
      const query = filter.value.trim().toLowerCase();
      document.querySelectorAll("[data-guest-row]").forEach((row) => {
        row.hidden = !!query && !row.dataset.guestRow.includes(query);
      });
    });
  }

  function render() {
    const hashChanged = location.hash !== lastHash;
    lastHash = location.hash;
    teardownMap();
    const route = parseHash();
    syncRoute(route);
    document.body.classList.toggle("print-tent", route.name === "shop" && route.tab === "tent");
    document.body.classList.toggle("print-roi", route.name === "organizer" && route.tab === "roi");
    const banner = document.getElementById("sandbox-banner");
    const header = document.getElementById("site-header");
    const app = document.getElementById("app");
    if (banner) banner.innerHTML = bannerHtml();
    if (header) header.innerHTML = headerHtml(route);
    if (app) app.innerHTML = mainHtml(route);
    document.title = `${titleFor(route)} · Sandbox · Hometown Crawls`;
    mountMap();
    mountQr();
    bindFilter();
    if (hashChanged) window.scrollTo(0, 0);
  }

  function applyField(el, fromUser) {
    const bucket = el.dataset.bucket;
    const field = el.dataset.field;
    if (!bucket || !field) return;
    if (bucket === "scan") {
      state.scanDraft[field] = el.type === "radio" ? (el.checked ? el.value : state.scanDraft[field]) : el.value;
      return;
    }
    if (bucket === "wizard") {
      if (field === "prize-name" || field === "prize-stamps") {
        const prize = state.wizard.prizes[Number(el.dataset.index)];
        if (!prize) return;
        prize[field === "prize-name" ? "name" : "stamps"] = el.value;
        return;
      }
      state.wizard[field] = el.value;
      if (field === "crawlName" && fromUser) state.wizard.nameTouched = true;
      if (field === "town" && !state.wizard.nameTouched) {
        const template = S.templateById(state.wizard.templateId);
        const town = String(el.value || "").trim() || "Your town";
        state.wizard.crawlName = template.id === "small-business-saturday"
          ? `${town} Small Business Saturday`
          : `${town} ${template.label} Crawl`;
      }
      if (field === "color") {
        const preview = document.getElementById("color-preview");
        if (preview && /^#[0-9a-fA-F]{6}$/.test(el.value)) preview.style.background = el.value;
      }
      return;
    }
    if (bucket === "shop") {
      const shop = S.activeShop(state);
      if (shop) shop[field] = el.value;
    }
  }

  function pullFields() {
    document.querySelectorAll("#app [data-bucket]").forEach((el) => applyField(el, false));
  }

  function resizeImage(file, max, quality) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => {
        const scale = Math.min(1, max / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("image"));
      };
      image.src = url;
    });
  }

  function doStamp() {
    pullFields();
    const shop = S.shopById(state, state.scanDraft.shopId);
    const guest = you(shop ? shop.crawlId : "");
    const fix = S.simulatedFix(shop, state.scanDraft.place === "far" ? "far" : "near");
    const result = S.claimStamp(state, {
      shopId: state.scanDraft.shopId,
      code: state.scanDraft.code,
      lat: fix ? fix.lat : NaN,
      lng: fix ? fix.lng : NaN,
      guestId: guest ? guest.id : state.youGuestId
    });
    const meters = Number.isFinite(result.distance) ? ` Simulated distance ${Math.round(result.distance)} m (limit ${S.GEOFENCE_M} m).` : "";
    if (!result.ok) {
      flash = { type: "error", text: `${result.error}.${meters}` };
      render();
      return;
    }
    persist();
    const crawl = shop ? S.crawlById(state, shop.crawlId) : S.activeCrawl(state);
    if (result.completed) {
      flash = { type: "ok", text: `Passport complete. Example voucher ${result.voucher}.` };
      setHash(S.routeFor(crawl, "done"));
      return;
    }
    const prog = S.progress(state, crawl.id, guest ? guest.id : state.youGuestId);
    flash = { type: "ok", text: `Stamped ${shop.name}.${meters} ${prog.got} of ${prog.total}.` };
    render();
  }

  function doRedeem() {
    pullFields();
    const shop = S.activeShop(state);
    const result = S.redeemVoucher(state, { code: state.scanDraft.voucher, shopId: shop ? shop.id : "" });
    if (!result.ok) {
      flash = { type: "error", text: result.error === "Already redeemed" ? `Already redeemed${result.guest ? ` for ${result.guest.name}` : ""}.` : result.error };
      render();
      return;
    }
    state.scanDraft.voucher = "";
    persist();
    flash = { type: "ok", text: `Marked ${result.guest.voucher} redeemed for ${result.guest.name}. No email was sent.` };
    render();
  }

  function wizardNext() {
    pullFields();
    const errors = S.validateWizard(state.wizard, state.wizard.step);
    if (errors.length) {
      flash = { type: "error", text: errors[0] };
      render();
      return;
    }
    if (state.wizard.step === 1 && !state.wizard.nameTouched && !String(state.wizard.crawlName || "").trim()) S.applyTemplate(state.wizard);
    state.wizard.step = Math.min(7, (state.wizard.step || 1) + 1);
    persist();
    render();
  }

  function createCrawl() {
    pullFields();
    const result = S.createCrawl(state, state.wizard);
    if (!result.ok) {
      flash = { type: "error", text: result.error };
      if (result.step) state.wizard.step = result.step;
      persist();
      render();
      return;
    }
    state.role = "guest";
    state.wizard = S.defaultWizard();
    persist();
    flash = { type: "ok", text: `${result.receipt.message} Opened /sandbox/${result.crawl.stateSlug}/${result.crawl.citySlug}/${result.crawl.slug}.` };
    setHash(S.routeFor(result.crawl));
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.left = "-9999px";
        document.body.appendChild(area);
        area.select();
        const copied = document.execCommand("copy");
        area.remove();
        if (!copied) throw new Error("copy");
      }
      flash = { type: "ok", text: "Copied." };
    } catch (err) {
      flash = { type: "error", text: "Copy did not complete. Select the code and copy it manually." };
    }
    render();
  }

  async function shareCard(guest, crawl, example) {
    const text = `${example ? "EXAMPLE card. " : ""}I finished the ${crawl.name} in ${crawl.city}. ${guest.name} · voucher ${guest.voucher}. Sandbox demo, not a real prize.`;
    if (navigator.share) {
      try {
        await navigator.share({ title: `I finished the ${crawl.name}`, text });
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return;
      }
    }
    copyText(text);
  }

  async function downloadCard(guest, crawl, example) {
    if (document.fonts && document.fonts.load) {
      try {
        await Promise.all([
          document.fonts.load("700 72px Fraunces"),
          document.fonts.load("500 36px Outfit")
        ]);
      } catch (err) { /* canvas falls back to generic families */ }
    }
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1350;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = S.safeColor(crawl.color);
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#fffdf8";
    ctx.font = "600 28px Outfit, sans-serif";
    ctx.fillText(example ? "EXAMPLE · I FINISHED" : "I FINISHED", 80, 160);
    ctx.font = "700 78px Fraunces, Georgia, serif";
    wrapText(ctx, crawl.name, 80, 280, 920, 88);
    ctx.font = "500 36px Outfit, sans-serif";
    ctx.fillText(`${guest.name} · ${crawl.city}`, 80, 560);
    ctx.font = "700 64px Fraunces, Georgia, serif";
    ctx.fillText(guest.voucher || "EX-DEMO", 80, 760);
    ctx.font = "500 28px Outfit, sans-serif";
    wrapText(ctx, "Sandbox demo. Not a real prize. No real money.", 80, 860, 900, 40);
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = example ? "example-finished-card.png" : "i-finished-sandbox.png";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function wrapText(ctx, text, x, y, max, lineHeight) {
    const words = String(text).split(/\s+/);
    let line = "";
    let cursor = y;
    words.forEach((word) => {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > max && line) {
        ctx.fillText(line, x, cursor);
        line = word;
        cursor += lineHeight;
      } else line = next;
    });
    if (line) ctx.fillText(line, x, cursor);
  }

  function prettyDay(iso) {
    const [year, month, day] = String(iso).split("-");
    const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return `${names[Number(month) - 1]} ${Number(day)}, ${year}`;
  }

  function downloadCsv(kind) {
    const crawl = S.activeCrawl(state);
    const text = kind === "stamps" ? S.stampsCsv(state, crawl.id) : S.guestsCsv(state, crawl.id);
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${crawl.slug}-${kind}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function onClick(event) {
    const toggle = event.target.closest("#nav-toggle");
    if (toggle) {
      document.getElementById("nav-links").classList.toggle("open");
      return;
    }
    if (event.target.closest("#nav-links a")) {
      const nav = document.getElementById("nav-links");
      if (nav) nav.classList.remove("open");
    }
    const roleLink = event.target.closest("[data-role-link]");
    if (roleLink) {
      state.role = roleLink.dataset.roleLink;
      persist();
    }
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "set-role") {
      state.role = button.dataset.role;
      persist();
      setHash(S.homeForRole(state.role, state));
      return;
    }
    if (action === "reset") {
      if (!window.confirm("Reset all sandbox demo data on this browser? Idea statuses return to Proposed.")) return;
      state = S.resetState(localStorage);
      flash = { type: "ok", text: "Demo data reset. Alex is 6 of 8 stamps again." };
      setHash("#/ideas");
      return;
    }
    if (action === "cycle-idea") {
      const id = button.dataset.id;
      state.ideaStatus[id] = S.nextStatus(state.ideaStatus[id] || "proposed");
      persist();
      render();
      return;
    }
    if (action === "prefill-scan") {
      event.preventDefault();
      const shop = S.shopById(state, button.dataset.shop);
      if (!shop) return;
      state.scanDraft.shopId = shop.id;
      state.scanDraft.place = "near";
      const crawl = S.crawlById(state, shop.crawlId) || S.activeCrawl(state);
      persist();
      setHash(S.routeFor(crawl, "scan"));
      return;
    }
    if (action === "wizard-next") wizardNext();
    else if (action === "wizard-back") {
      pullFields();
      state.wizard.step = Math.max(1, (state.wizard.step || 1) - 1);
      persist();
      render();
    } else if (action === "create-crawl") createCrawl();
    else if (action === "pick-template") {
      pullFields();
      state.wizard.templateId = button.dataset.template;
      S.applyTemplate(state.wizard);
      persist();
      render();
    } else if (action === "add-prize") {
      pullFields();
      if (state.wizard.prizes.length < 6) state.wizard.prizes.push({ stamps: 1, name: "" });
      persist();
      render();
    } else if (action === "remove-prize") {
      pullFields();
      if (state.wizard.prizes.length > 1) state.wizard.prizes.splice(Number(button.dataset.index), 1);
      persist();
      render();
    } else if (action === "pick-logo") {
      state.wizard.logo = button.dataset.logo;
      state.wizard.logoImage = "";
      persist();
      render();
    } else if (action === "mark-ready") {
      const shop = S.activeShop(state);
      if (!shop) return;
      shop.cardReady = true;
      persist();
      flash = { type: "ok", text: "Counter card marked ready in this demo." };
      render();
    } else if (action === "print") window.print();
    else if (action === "csv") downloadCsv(button.dataset.kind);
    else if (action === "copy-code") copyText(button.dataset.code || "");
    else if (action === "share-card") {
      const guest = S.guestById(state, button.dataset.guest);
      const crawl = S.crawlById(state, button.dataset.crawl);
      if (guest && crawl) shareCard(guest, crawl, button.dataset.example === "yes");
    } else if (action === "download-card") {
      const guest = S.guestById(state, button.dataset.guest);
      const crawl = S.crawlById(state, button.dataset.crawl);
      if (guest && crawl) downloadCard(guest, crawl, button.dataset.example === "yes");
    } else if (action === "shop-flag") {
      const turningOn = button.dataset.value === "1";
      const result = S.setShopFlag(state, button.dataset.shop, button.dataset.flag, turningOn);
      if (!result.ok) flash = { type: "error", text: result.error };
      persist();
      render();
    } else if (action === "decide") {
      const result = S.decideApplication(state, button.dataset.id, button.dataset.status);
      flash = { type: result.ok ? "ok" : "error", text: result.ok ? result.summary : result.error };
      if (result.ok) persist();
      render();
    } else if (action === "refund" || action === "resend") {
      const select = document.getElementById("action-shop");
      const result = action === "refund" ? S.simulateRefund(state, select && select.value) : S.simulateResend(state, select && select.value);
      flash = { type: result.ok ? "ok" : "error", text: result.ok ? result.summary : result.error };
      if (result.ok) persist();
      render();
    }
  }

  function onFieldEvent(event) {
    const el = event.target.closest("[data-bucket]");
    if (!el) return;
    applyField(el, true);
    if (el.dataset.bucket !== "scan" || el.dataset.field === "place" || el.dataset.field === "shopId") persist();
    else persist();
  }

  function onChange(event) {
    const el = event.target;
    if (el.matches("[data-action='shop-check']")) {
      const shop = S.activeShop(state);
      if (!shop) return;
      shop.checks = shop.checks || {};
      shop.checks[el.dataset.check] = el.checked;
      persist();
      render();
      return;
    }
    if (el.matches("[data-action='switch-crawl']")) {
      const crawl = S.crawlById(state, el.value);
      if (!crawl) return;
      state.activeCrawlId = crawl.id;
      const shops = S.shopsFor(state, crawl.id);
      if (!shops.some((shop) => shop.id === state.activeShopId)) state.activeShopId = shops[0] ? shops[0].id : "";
      persist();
      if (el.dataset.context === "guest") setHash(S.routeFor(crawl, el.dataset.tab || "passport"));
      else render();
      return;
    }
    if (el.matches("[data-action='switch-shop']")) {
      state.activeShopId = el.value;
      persist();
      render();
      return;
    }
    if (el.matches("[data-action='admin-crawl-filter']")) {
      state.adminShopCrawl = el.value;
      persist();
      render();
      return;
    }
    if (el.matches("[data-action='shop-photo']")) {
      const file = el.files && el.files[0];
      if (!file) return;
      resizeImage(file, 800, 0.72).then((data) => {
        const shop = S.activeShop(state);
        if (!shop) return;
        const previous = shop.photo;
        shop.photo = data;
        shop.checks.photo = true;
        if (!persist()) {
          shop.photo = previous;
          flash = { type: "error", text: "That photo is too large for this browser's demo storage." };
        } else flash = { type: "ok", text: "Example photo saved in this browser only." };
        render();
      }).catch(() => {
        flash = { type: "error", text: "Could not read that image." };
        render();
      });
      return;
    }
    if (el.matches("[data-action='logo-file']")) {
      const file = el.files && el.files[0];
      if (!file) return;
      resizeImage(file, 256, 0.8).then((data) => {
        state.wizard.logoImage = data;
        if (!persist()) {
          state.wizard.logoImage = "";
          flash = { type: "error", text: "That logo is too large for this browser's demo storage." };
        }
        render();
      }).catch(() => {
        flash = { type: "error", text: "Could not read that image." };
        render();
      });
      return;
    }
    onFieldEvent(event);
  }

  function onSubmit(event) {
    const form = event.target.closest("[data-form]");
    if (!form) return;
    event.preventDefault();
    if (form.dataset.form === "stamp") doStamp();
    if (form.dataset.form === "redeem") doRedeem();
  }

  document.addEventListener("DOMContentLoaded", () => {
    window.addEventListener("hashchange", render);
    document.body.addEventListener("click", onClick);
    document.body.addEventListener("input", onFieldEvent);
    document.body.addEventListener("change", onChange);
    document.body.addEventListener("submit", onSubmit);
    window.addEventListener("load", () => { if (mapRef) mapRef.invalidateSize(); });
    if (!location.hash || location.hash === "#") location.replace("#/ideas");
    else render();
  });
})();
