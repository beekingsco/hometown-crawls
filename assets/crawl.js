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

  function authRedirect() {
    return location.origin + location.pathname + location.search;
  }

  function watchSession(fn) {
    const c = client();
    if (!c || typeof fn !== "function") return function () {};
    const { data } = c.auth.onAuthStateChange(function (event, next) {
      session = next;
      if (event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "SIGNED_OUT") {
        setTimeout(function () { fn(next, event); }, 0);
      }
    });
    return function () {
      data.subscription.unsubscribe();
    };
  }

  async function magicLink(email) {
    const c = client();
    if (!c) throw new Error("Supabase not loaded");
    const { error } = await c.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: location.origin + location.pathname + location.search }
    });
    if (error) throw error;
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
    if (id === "puy-coffee") return loadPaidShops(id);
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
    const c = client();
    const id = crawlId || CRAWL;
    if (!c) return null;
    const { data, error } = await c.from("crawls").select("*").eq("id", id).maybeSingle();
    if (error) {
      console.warn("crawl load", error.message);
      return null;
    }
    return data;
  }

  async function joinCrawl(crawlId) {
    if (demoMode()) throw new Error("Demo mode only shows sample data. It does not join a crawl.");
    const c = client();
    if (!c) throw new Error("Supabase not loaded");
    let s = await getSession();
    if (!s) s = await ensureAuth();
    if (!s) throw new Error("Please sign in with email to join this crawl.");
    const { data, error } = await c.rpc("join_crawl", { p_crawl: crawlId || CRAWL });
    if (error) throw error;
    return data;
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

  function getPosition() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve({ lat: null, lng: null });
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve({ lat: null, lng: null }),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
      );
    });
  }

  function plainStampError(error) {
    const raw = String((error && error.message) || error || "");
    const known = [
      "Already stamped",
      "Location required",
      "You need to be at the shop",
      "Invalid code",
      "Code required",
      "Business not on this crawl",
      "Not authenticated",
      "Unknown business"
    ];
    for (const line of known) {
      if (raw.toLowerCase().includes(line.toLowerCase())) return line;
    }
    return raw.replace(/^ERROR:\s*/i, "").trim() || "Could not claim that stamp.";
  }

  async function claimStamp({ crawl, business, code, lat, lng }) {
    if (demoMode()) throw new Error("Demo mode only shows sample data. It does not stamp.");
    const c = client();
    if (!c) throw new Error("Supabase not loaded");
    let s = await getSession();
    if (!s) s = await ensureAuth();
    if (!s) throw new Error("Please sign in with email to stamp.");
    let coords = { lat, lng };
    if (coords.lat == null || coords.lng == null) coords = await getPosition();
    if (coords.lat == null || coords.lng == null) {
      throw new Error("Location required");
    }
    const { data, error } = await c.rpc("claim_stamp", {
      p_crawl: crawl || CRAWL,
      p_business: business,
      p_code: code,
      p_lat: coords.lat,
      p_lng: coords.lng
    });
    if (error) throw new Error(plainStampError(error));
    return data;
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
    signOut,
    loadShops,
    loadCrawl,
    joinCrawl,
    myStamps,
    myJoins,
    claimStamp,
    getPosition,
    renderShopList,
    renderStamps,
    stampLabel,
    demoMode,
    initMap,
    escapeHtml,
    claimOrganizer,
    dashboardRoles,
    dashboardView,
    rememberDashboardView,
    landOnPreferredDashboard,
    syncRoleSwitch
  };
})();
