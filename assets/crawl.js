/* Supabase crawl client: auth, shops, join, stamps, map helpers */
(function () {
  const env = window.__HC_ENV__ || {};
  const CRAWL = env.CRAWL_ID || "puy-coffee";
  let sb = null;
  let session = null;
  const DASHBOARD_VIEW_KEY = "hc-dashboard-view";
  const DASHBOARD_VIEWS = {
    organizer: "/puyallup/coffee-crawl/organizer",
    shop: "/puyallup/coffee-crawl/shop"
  };
  // Read before Supabase consumes the magic-link hash or code.
  const arrivedByMagicLink = /access_token=|refresh_token=|type=magiclink|type=signup|type=recovery|type=invite/i.test(String(location.hash || ""))
    || /(?:^|[?&])code=/.test(String(location.search || ""));

  function ready() {
    return !!(window.supabase && env.SUPABASE_URL && env.SUPABASE_ANON_KEY);
  }

  function client() {
    if (!ready()) return null;
    if (!sb) {
      sb = window.supabase.createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });
    }
    return sb;
  }

  function demoMode() {
    return new URLSearchParams(location.search).get("demo") === "1";
  }

  async function ensureAuth() {
    const c = client();
    if (!c) throw new Error("Supabase not loaded");
    const { data } = await c.auth.getSession();
    session = data.session;
    if (session && session.user && !session.user.is_anonymous && session.user.email) return session;
    return null;
  }

  async function getSession() {
    const c = client();
    if (!c) return null;
    const { data } = await c.auth.getSession();
    session = data.session;
    return session;
  }

  // autojoin is set only on the magic-link redirect for the crawl page that
  // sent the email. It is never filled from CRAWL / CRAWL_ID. Hundreds of
  // crawls run at once, so pending storage is keyed by that crawl id and is
  // not a source for which crawl to join.
  const AUTOJOIN_PARAM = "autojoin";
  const AUTOJOIN_PREFIX = "hc-autojoin:";
  let landedAutoJoin = readAutoJoinParam();
  const autoJoinFlight = new Map();

  function crawlIdToken(value) {
    const id = String(value == null ? "" : value).trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id)) return "";
    return id;
  }

  function readAutoJoinParam() {
    try {
      return crawlIdToken(new URLSearchParams(String(location.search || "").replace(/^\?/, "")).get(AUTOJOIN_PARAM));
    } catch (e) {
      return "";
    }
  }

  function autoJoinTarget() {
    const live = readAutoJoinParam();
    const landed = crawlIdToken(landedAutoJoin);
    if (live && landed && live !== landed) return "";
    return live || landed || "";
  }

  function autoJoinStorageKey(id) {
    return AUTOJOIN_PREFIX + id;
  }

  function storageSet(store, key, value) {
    try {
      if (store && typeof store.setItem === "function") store.setItem(key, value);
    } catch (e) {}
  }

  function storageRemove(store, key) {
    try {
      if (store && typeof store.removeItem === "function") store.removeItem(key);
    } catch (e) {}
  }

  function rememberAutoJoin(id) {
    const token = crawlIdToken(id);
    if (!token) return;
    const payload = JSON.stringify({ crawlId: token });
    const key = autoJoinStorageKey(token);
    storageSet(typeof sessionStorage !== "undefined" ? sessionStorage : null, key, payload);
    storageSet(typeof localStorage !== "undefined" ? localStorage : null, key, payload);
  }

  function stripAutoJoinParam(id) {
    const token = crawlIdToken(id);
    if (!token) return;
    let params;
    try {
      params = new URLSearchParams(String(location.search || "").replace(/^\?/, ""));
    } catch (e) {
      return;
    }
    if (params.get(AUTOJOIN_PARAM) !== token) return;
    params.delete(AUTOJOIN_PARAM);
    const query = params.toString();
    const next = location.pathname + (query ? "?" + query : "") + (location.hash || "");
    if (typeof history !== "undefined" && history && typeof history.replaceState === "function") {
      history.replaceState(null, "", next);
    }
  }

  function clearAutoJoin(id) {
    const token = crawlIdToken(id);
    if (!token) return;
    if (landedAutoJoin === token) landedAutoJoin = "";
    const key = autoJoinStorageKey(token);
    storageRemove(typeof sessionStorage !== "undefined" ? sessionStorage : null, key);
    storageRemove(typeof localStorage !== "undefined" ? localStorage : null, key);
    stripAutoJoinParam(token);
  }

  function redirectForMagicLink(crawlId) {
    const params = new URLSearchParams(String(location.search || "").replace(/^\?/, ""));
    const id = crawlIdToken(crawlId);
    if (id) params.set(AUTOJOIN_PARAM, id);
    else params.delete(AUTOJOIN_PARAM);
    const query = params.toString();
    const stem = location.origin + location.pathname + location.search;
    const path = stem.split("?")[0];
    return query ? path + "?" + query : path;
  }

  function authRedirect(crawlId) {
    return redirectForMagicLink(crawlId);
  }

  function emailSession(s) {
    return !!(s && s.user && !s.user.is_anonymous && s.user.email);
  }

  // Listed and not ended. Upcoming crawls still count so a guest can join
  // before opening day. is_listed false (hidden crawls) does not.
  function crawlIsActive(row, now) {
    if (!row || !crawlIdToken(row.id)) return false;
    if (row.is_listed === false) return false;
    const t = now == null ? Date.now() : new Date(now).getTime();
    if (row.ends_at) {
      const end = new Date(row.ends_at).getTime();
      if (Number.isFinite(end) && end < t) return false;
    }
    return true;
  }

  function alreadyJoinedError(error) {
    const text = String((error && (error.message || error.code || error.details)) || error || "");
    return /duplicate key|already joined|unique constraint|23505/i.test(text);
  }

  function watchSession(fn) {
    const c = client();
    if (!c || typeof fn !== "function") return function () {};
    const { data } = c.auth.onAuthStateChange(function (event, next) {
      session = next;
      if (event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "SIGNED_OUT") {
        setTimeout(function () {
          const pending = (event === "SIGNED_OUT") ? null : consumeAutoJoin();
          Promise.resolve(pending).then(function () { fn(next, event); }, function () { fn(next, event); });
        }, 0);
      }
    });
    return function () {
      data.subscription.unsubscribe();
    };
  }

  const OTP_RATE_LIMIT_COPY = "Too many sign-in emails right now. Wait about a minute, then tap Send once.";

  function authErrorText(error) {
    if (error == null) return "";
    if (typeof error === "string") return error;
    if (typeof error.message === "string" && error.message) return error.message;
    if (typeof error.msg === "string" && error.msg) return error.msg;
    if (typeof error.error_description === "string" && error.error_description) return error.error_description;
    if (typeof error.error === "string") return error.error;
    return "";
  }

  function isEmailRateLimit(error) {
    if (!error || typeof error === "string") {
      return /email rate limit exceeded|over_email_send_rate_limit/i.test(String(error || ""));
    }
    const status = Number(error.status != null ? error.status : error.statusCode);
    if (status === 429) return true;
    const code = String(error.code || error.error_code || "");
    if (code === "429" || /over_email_send_rate_limit/i.test(code)) return true;
    const text = authErrorText(error);
    return /email rate limit exceeded|over_email_send_rate_limit/i.test(text);
  }

  function otpErrorMessage(error) {
    if (isEmailRateLimit(error)) return OTP_RATE_LIMIT_COPY;
    return authErrorText(error) || "Could not send the sign-in link.";
  }

  function revealNotice(el) {
    if (!el || typeof el.scrollIntoView !== "function") return;
    if (typeof el.getClientRects === "function" && el.getClientRects().length === 0) return;
    try {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (e) {
      try { el.scrollIntoView(); } catch (e2) {}
    }
  }

  async function magicLink(email, crawlId) {
    const c = client();
    if (!c) throw new Error("Supabase not loaded");
    const id = crawlIdToken(crawlId);
    let error = null;
    try {
      const result = await c.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectForMagicLink(id) }
      });
      error = result && result.error;
    } catch (thrown) {
      error = thrown;
    }
    if (!error) {
      if (id) rememberAutoJoin(id);
      return;
    }
    const failure = new Error(otpErrorMessage(error));
    if (error.status != null) failure.status = error.status;
    else if (error.statusCode != null) failure.status = error.statusCode;
    if (error.code != null) failure.code = error.code;
    else if (error.error_code != null) failure.code = error.error_code;
    try { failure.cause = error; } catch (e) {}
    throw failure;
  }

  async function signOut() {
    const c = client();
    if (!c) return;
    await c.auth.signOut();
    session = null;
  }

  function mapPaidShop(row) {
    const photos = Array.isArray(row.photo_urls) ? row.photo_urls.filter(Boolean) : [];
    return {
      id: row.business_id,
      name: row.display_name || "Shop",
      address: row.address || "",
      lat: row.lat,
      lng: row.lng,
      type: "coffee",
      logo_url: row.logo_url || "",
      stamp_image_url: row.stamp_image_url || "",
      stamp_label: row.stamp_label || "",
      postal_code: row.postal_code || "",
      photo_urls: photos
    };
  }

  // Paid + approved shops only. get_public_crawl_shops is the public map source
  // for crawls whose stops live on shop_listings (the holiday coffee crawl).
  async function loadPaidShops(crawlId) {
    const c = client();
    if (!c) return { shops: [], error: "no-client" };
    const { data, error } = await c.rpc("get_public_crawl_shops", { p_crawl: crawlId });
    if (error) return { shops: [], error: error.message };
    const seen = new Set();
    const list = (data || [])
      .filter((row) => {
        if (!row || !row.business_id || seen.has(row.business_id)) return false;
        seen.add(row.business_id);
        return true;
      })
      .map(mapPaidShop)
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    return { shops: list, error: null };
  }

  async function loadShops(crawlId) {
    const c = client();
    const id = crawlId || CRAWL;
    // Coffee pins are paid listings, not inactive membership seeds.
    if (id === "puy-coffee" || id === "arl-coffee") return loadPaidShops(id);
    if (!c) return { shops: [], error: "no-client" };

    const { data: memberships, error: mErr } = await c
      .from("memberships")
      .select("business_id, status")
      .eq("crawl_id", id)
      .eq("status", "active");
    if (mErr) return { shops: [], error: mErr.message };

    const ids = (memberships || []).map((m) => m.business_id);
    if (!ids.length) return { shops: [], error: null };

    const { data: shops, error: sErr } = await c
      .from("business_public")
      .select("id, name, address, lat, lng, type, logo_url")
      .in("id", ids);
    if (sErr) return { shops: [], error: sErr.message };

    // Preserve membership order roughly by name
    const list = (shops || []).slice().sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    return { shops: list, error: null };
  }

  async function loadCrawl(crawlId) {
    try {
      return await loadCrawlRow(crawlId || CRAWL);
    } catch (e) {
      return null;
    }
  }

  async function loadCrawlRow(id) {
    const token = crawlIdToken(id);
    const c = client();
    if (!c || !token) return null;
    const { data, error } = await c.from("crawls").select("*").eq("id", token).maybeSingle();
    if (error) {
      console.warn("crawl load", error.message);
      const failure = new Error(error.message || "Could not load crawl");
      failure.transient = true;
      throw failure;
    }
    if (!data || crawlIdToken(data.id) !== token) return null;
    return data;
  }

  async function joinExact(crawlId) {
    const id = crawlIdToken(crawlId);
    if (!id) throw new Error("Missing crawl");
    const c = client();
    if (!c) throw new Error("Supabase not loaded");
    let s = await getSession();
    if (!s) s = await ensureAuth();
    if (!emailSession(s)) throw new Error("Please sign in with email to join this crawl.");
    const { data, error } = await c.rpc("join_crawl", { p_crawl: id });
    if (error) throw error;
    return data;
  }

  async function joinCrawl(crawlId) {
    if (demoMode()) throw new Error("Demo mode only shows sample data. It does not join a crawl.");
    return joinExact(crawlId || CRAWL);
  }

  // Join only the crawl id carried on the magic-link redirect. No id, no join.
  // Does not read other crawls' pending keys and does not fall back to CRAWL.
  async function consumeAutoJoin(now) {
    if (demoMode()) return { joined: false, reason: "demo" };
    const live = readAutoJoinParam();
    const landed = crawlIdToken(landedAutoJoin);
    if (live && landed && live !== landed) {
      landedAutoJoin = "";
      stripAutoJoinParam(live);
      return { joined: false, reason: "mismatch" };
    }
    const id = live || landed || "";
    if (!id) return { joined: false, reason: "none" };
    if (autoJoinFlight.has(id)) return autoJoinFlight.get(id);
    const job = consumeAutoJoinNow(id, now).finally(function () {
      autoJoinFlight.delete(id);
    });
    autoJoinFlight.set(id, job);
    return job;
  }

  async function consumeAutoJoinNow(id, now) {
    try {
      if (autoJoinTarget() !== id) return { joined: false, reason: "none" };
      let s = await getSession();
      if (!emailSession(s)) return { joined: false, reason: "signed-out" };
      const row = await loadCrawlRow(id);
      if (!row) {
        clearAutoJoin(id);
        return { joined: false, reason: "missing" };
      }
      if (!crawlIsActive(row, now)) {
        clearAutoJoin(id);
        return { joined: false, reason: "inactive" };
      }
      if (autoJoinTarget() !== id) return { joined: false, reason: "none" };
      const existing = await myJoins();
      if (existing.some(function (join) { return join && join.crawl_id === id; })) {
        clearAutoJoin(id);
        return { joined: true, already: true };
      }
      try {
        await joinExact(id);
      } catch (error) {
        if (!alreadyJoinedError(error)) return { joined: false, reason: "error" };
      }
      clearAutoJoin(id);
      return { joined: true };
    } catch (e) {
      return { joined: false, reason: "error" };
    }
  }

  function syncJoinPrompt(el, joins) {
    if (!el || !el.classList) return;
    const empty = !Array.isArray(joins) || joins.length === 0;
    el.classList.toggle("hidden", !empty);
  }

  async function myStamps(crawlId) {
    const c = client();
    if (!c) return [];
    const s = await getSession();
    if (!s) return [];
    const { data, error } = await c
      .from("stamps")
      .select("business_id, claimed_at")
      .eq("crawl_id", crawlId || CRAWL)
      .eq("user_id", s.user.id);
    if (error) {
      console.warn(error.message);
      return [];
    }
    return data || [];
  }

  async function myJoins() {
    const c = client();
    if (!c) return [];
    const s = await getSession();
    if (!s) return [];
    const { data, error } = await c
      .from("crawl_joins")
      .select("crawl_id, joined_at")
      .eq("user_id", s.user.id);
    if (error) return [];
    return data || [];
  }

  function plainStampError(error) {
    const raw = String((error && error.message) || error || "");
    const known = [
      "Already stamped",
      "Invalid code",
      "Code required",
      "Business not on this crawl",
      "Not authenticated",
      "Not joined",
      "Unknown business"
    ];
    for (const line of known) {
      if (raw.toLowerCase().includes(line.toLowerCase())) return line;
    }
    return raw.replace(/^ERROR:\s*/i, "").trim() || "Could not claim that stamp.";
  }

  // Own request so the row survives when claim_stamp raises and rolls back.
  async function logStampFailure({ crawl, business, code, message }) {
    if (demoMode()) return;
    const id = crawlIdToken(crawl);
    const c = client();
    if (!id || !c) return;
    let agent = "";
    try {
      agent = (typeof navigator !== "undefined" && navigator && navigator.userAgent) || "";
    } catch (e) {}
    try {
      await c.rpc("log_stamp_attempt_failure", {
        p_crawl: id,
        p_business: business || null,
        p_code: code == null ? "" : String(code),
        p_message: message == null ? "" : String(message),
        p_user_agent: agent
      });
    } catch (e) {}
  }

  // Code or QR only. Never ask the browser for location.
  async function claimStamp({ crawl, business, code, lat, lng }) {
    const crawlId = crawl || CRAWL;
    try {
      if (demoMode()) throw new Error("Demo mode only shows sample data. It does not stamp.");
      const c = client();
      if (!c) throw new Error("Supabase not loaded");
      let s = await getSession();
      if (!s) s = await ensureAuth();
      if (!emailSession(s)) throw new Error("Please sign in with email to stamp.");
      const { data, error } = await c.rpc("claim_stamp", {
        p_crawl: crawlId,
        p_business: business,
        p_code: code,
        p_lat: lat == null ? null : lat,
        p_lng: lng == null ? null : lng
      });
      if (error) throw new Error(plainStampError(error));
      return data;
    } catch (error) {
      await logStampFailure({
        crawl: crawlId,
        business: business,
        code: code,
        message: (error && error.message) || String(error || "")
      });
      throw error;
    }
  }

  function renderShopList(container, shops, stamps) {
    if (!container) return;
    const stamped = new Set((stamps || []).map((s) => s.business_id));
    if (!shops.length) {
      container.innerHTML = `<p class="muted">Shops will appear here once seats are live.</p>`;
      return;
    }
    container.innerHTML = shops
      .map((s) => {
        const got = stamped.has(s.id);
        const init = window.HC?.initials(s.name) || "?";
        const image = (s.photo_urls && s.photo_urls[0]) || s.stamp_image_url || s.logo_url || "";
        const avatar = image
          ? `<span class="shop-avatar"><img src="${escapeHtml(image)}" alt=""></span>`
          : `<span class="shop-avatar">${init}</span>`;
        return `<div class="shop-row" data-id="${s.id}">
          ${avatar}
          <div style="flex:1;min-width:0">
            <b>${escapeHtml(s.name)}</b>
            <div class="muted small">${escapeHtml(s.address || "")}</div>
            ${s.postal_code ? `<div class="muted small">Zip ${escapeHtml(s.postal_code)}</div>` : ""}
          </div>
          <span class="pill ${got ? "pill-ok" : "pill-muted"}">${got ? "Stamped" : "Open"}</span>
        </div>`;
      })
      .join("");
  }

  function demoStampArt(businessId) {
    try {
      if (new URLSearchParams(location.search).get("demo") !== "1") return null;
      const all = JSON.parse(localStorage.getItem("hc-stamp-art") || "null");
      const row = all && all[businessId];
      return row && typeof row === "object" ? row : null;
    } catch (e) {
      return null;
    }
  }

  function stampLabel(name, custom) {
    const customText = String(custom || "").trim();
    if (customText) return customText.slice(0, 40);
    let words = String(name || "").replace(/[’']/g, "'").split(/\s+/).filter(Boolean);
    const article = /^(the|a|an)$/i;
    while (words.length > 1 && article.test(words[0].replace(/[^A-Za-z]/g, ""))) words.shift();
    words = words.filter((word, index) => index === 0 || !/^homemade$/i.test(word.replace(/[^A-Za-z]/g, "")));
    const category = /^(bakery|cafe|café|coffee|espresso|expresso|bar|shop|shops)$/i;
    while (words.length > 2 && category.test(words[words.length - 1].replace(/[^A-Za-z]/g, ""))) words.pop();
    if (words.length > 3) words = words.slice(0, 3);
    words = words.map((word) => (word.toLowerCase() === "cream" ? "Cream" : word));
    return words.join(" ") || "Shop";
  }

  function demoStampLabel(businessId) {
    try {
      if (!demoMode()) return "";
      const all = JSON.parse(localStorage.getItem("hc-stamp-labels") || "null");
      const value = all && all[businessId];
      return typeof value === "string" ? value : "";
    } catch (e) {
      return "";
    }
  }

  function renderStamps(container, shops, stamps, justId) {
    if (!container) return;
    const stamped = new Set((stamps || []).map((s) => s.business_id));
    container.innerHTML = `<div class="row" style="gap:0.65rem">${shops
      .map((s) => {
        const got = stamped.has(s.id);
        const label = stampLabel(s.name, s.stamp_label || demoStampLabel(s.id));
        const local = demoStampArt(s.id);
        const stampSrc = (local && local.stamp) || s.stamp_image_url || "";
        const logoSrc = (local && local.logo) || s.logo_url || "";
        const art = stampSrc || logoSrc;
        const inner = art
          ? `<img class="stamp-art" src="${escapeHtml(art)}" alt="">`
          : `<span class="stamp-label">${escapeHtml(label)}</span>`;
        const just = got && justId && s.id === justId ? " just" : "";
        return `<div class="stamp ${got ? "got" : ""}${just}" title="${escapeHtml(s.name)}">${inner}</div>`;
      })
      .join("")}</div>
      <p class="muted small mt-2">${stamped.size} / ${shops.length} stamped</p>`;
  }

  function initMap(el, shops, center) {
    if (!el || !window.L) return null;
    const lat = center?.lat ?? 47.191;
    const lng = center?.lng ?? -122.293;
    const map = L.map(el).setView([lat, lng], 14);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap"
    }).addTo(map);
    const bounds = [];
    (shops || []).forEach((s) => {
      if (s.lat == null || s.lng == null) return;
      bounds.push([s.lat, s.lng]);
      L.circleMarker([s.lat, s.lng], {
        radius: 8,
        color: "#1f3a24",
        fillColor: "#2f5a38",
        fillOpacity: 0.9,
        weight: 2
      })
        .addTo(map)
        .bindPopup(shopPopup(s));
    });
    if (bounds.length > 1) map.fitBounds(bounds, { padding: [28, 28] });
    setTimeout(() => map.invalidateSize(), 120);
    return map;
  }

  function shopImage(shop) {
    return (shop.photo_urls && shop.photo_urls[0]) || shop.stamp_image_url || shop.logo_url || "";
  }

  function shopPopup(shop) {
    const image = shopImage(shop);
    const photo = image
      ? `<img src="${escapeHtml(image)}" alt="" style="width:72px;height:72px;object-fit:cover;border-radius:8px;display:block;margin-bottom:6px">`
      : "";
    const zip = shop.postal_code ? `<br><span style="color:#6b6558">Zip ${escapeHtml(shop.postal_code)}</span>` : "";
    return `${photo}<b>${escapeHtml(shop.name)}</b><br><span style="color:#6b6558">${escapeHtml(shop.address || "")}</span>${zip}`;
  }

  function renderVideo(container, url) {
    if (!container) return;
    if (!window.HCVideo || typeof HCVideo.mount !== "function") {
      container.innerHTML = "";
      container.hidden = true;
      container.classList.add("hidden");
      return;
    }
    HCVideo.mount(container, url);
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function rpcMissing(error, name) {
    if (!error) return false;
    const msg = String(error.message || error.details || "");
    return error.code === "PGRST202"
      || error.code === "42883"
      || (/schema cache|does not exist|Could not find/i.test(msg) && msg.indexOf(name) !== -1);
  }

  function dashboardView() {
    try {
      const saved = localStorage.getItem(DASHBOARD_VIEW_KEY);
      if (saved === "shop" || saved === "organizer") return saved;
    } catch (e) {}
    return "organizer";
  }

  function rememberDashboardView(view) {
    if (view !== "shop" && view !== "organizer") return;
    try { localStorage.setItem(DASHBOARD_VIEW_KEY, view); } catch (e) {}
  }

  async function claimOrganizer(clientOverride) {
    const c = clientOverride || client();
    if (!c) return;
    try {
      const res = await c.rpc("organizer_claim_by_email");
      if (res && res.error && !rpcMissing(res.error, "organizer_claim_by_email")) return res.error;
    } catch (e) {}
  }

  async function dashboardRoles(clientOverride) {
    const c = clientOverride || client();
    const empty = { organizer: false, host: false, crawls: [], listings: [], orgError: null, hostError: null };
    if (!c) return empty;
    const orgRes = await c.rpc("organizer_my_crawls");
    const hostRes = await c.rpc("shop_my_listings");
    return {
      organizer: !orgRes.error && Array.isArray(orgRes.data) && orgRes.data.length > 0,
      host: !hostRes.error && Array.isArray(hostRes.data) && hostRes.data.length > 0,
      crawls: Array.isArray(orgRes.data) ? orgRes.data : [],
      listings: Array.isArray(hostRes.data) ? hostRes.data : [],
      orgError: orgRes.error || null,
      hostError: hostRes.error || null
    };
  }

  function landOnPreferredDashboard(current, roles) {
    if (!arrivedByMagicLink || !roles || !roles.organizer || !roles.host) return false;
    const want = dashboardView();
    if (want === current) return false;
    const path = DASHBOARD_VIEWS[want];
    if (!path) return false;
    location.replace(path);
    return true;
  }

  function syncRoleSwitch(el, current, roles) {
    if (!el) return;
    if (!roles || !roles.organizer || !roles.host) {
      el.classList.add("hidden");
      el.innerHTML = "";
      return;
    }
    el.classList.remove("hidden");
    el.innerHTML = '<div class="role-switch" role="tablist" aria-label="Dashboard">'
      + '<a role="tab" data-view="organizer" aria-selected="' + (current === "organizer" ? "true" : "false") + '" href="' + DASHBOARD_VIEWS.organizer + '">Organizer</a>'
      + '<a role="tab" data-view="shop" aria-selected="' + (current === "shop" ? "true" : "false") + '" href="' + DASHBOARD_VIEWS.shop + '">My Shop</a>'
      + "</div>";
    el.onclick = function (ev) {
      const link = ev.target.closest ? ev.target.closest("[data-view]") : null;
      if (!link) return;
      rememberDashboardView(link.getAttribute("data-view"));
      if (link.getAttribute("data-view") === current) ev.preventDefault();
    };
  }

  window.HCCrawl = {
    CRAWL,
    client,
    ready,
    ensureAuth,
    getSession,
    authRedirect,
    watchSession,
    magicLink,
    otpErrorMessage,
    revealNotice,
    signOut,
    loadShops,
    loadCrawl,
    joinCrawl,
    consumeAutoJoin,
    syncJoinPrompt,
    myStamps,
    myJoins,
    claimStamp,
    logStampFailure,
    renderShopList,
    renderStamps,
    stampLabel,
    demoMode,
    initMap,
    renderVideo,
    escapeHtml,
    claimOrganizer,
    dashboardRoles,
    dashboardView,
    rememberDashboardView,
    landOnPreferredDashboard,
    syncRoleSwitch
  };
})();
