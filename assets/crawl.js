/* Supabase crawl client: auth, shops, join, stamps, map helpers */
(function () {
  const env = window.__HC_ENV__ || {};
  const CRAWL = env.CRAWL_ID || "puy-coffee";
  let sb = null;
  let session = null;

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

  async function ensureAuth() {
    const c = client();
    if (!c) throw new Error("Supabase not loaded");
    const { data } = await c.auth.getSession();
    session = data.session;
    if (session) return session;
    // Prefer anonymous when enabled; fall back to requiring magic link
    const { data: anon, error } = await c.auth.signInAnonymously();
    if (!error && anon?.session) {
      session = anon.session;
      return session;
    }
    return null;
  }

  async function getSession() {
    const c = client();
    if (!c) return null;
    const { data } = await c.auth.getSession();
    session = data.session;
    return session;
  }

  async function magicLink(email) {
    const c = client();
    if (!c) throw new Error("Supabase not loaded");
    const redirectTo = location.origin + (window.HC?.base || "") + "account.html";
    const { error } = await c.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo }
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
    const list = (data || [])
      .filter((row) => row && row.business_id)
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
        const avatar = s.logo_url
          ? `<span class="shop-avatar"><img src="${s.logo_url}" alt=""></span>`
          : `<span class="shop-avatar">${init}</span>`;
        return `<div class="shop-row" data-id="${s.id}">
          ${avatar}
          <div style="flex:1;min-width:0">
            <b>${escapeHtml(s.name)}</b>
            <div class="muted small">${escapeHtml(s.address || "")}</div>
          </div>
          <span class="pill ${got ? "pill-ok" : "pill-muted"}">${got ? "Stamped" : "Open"}</span>
        </div>`;
      })
      .join("");
  }

  function renderStamps(container, shops, stamps) {
    if (!container) return;
    const stamped = new Set((stamps || []).map((s) => s.business_id));
    container.innerHTML = `<div class="row" style="gap:0.65rem">${shops
      .map((s) => {
        const got = stamped.has(s.id);
        const label = (s.name || "").split(" ")[0];
        const photos = Array.isArray(s.photo_urls) ? s.photo_urls : [];
        const stampSrc = s.logo_url || photos[0] || "";
        const inner = stampSrc && got ? `<img src="${escapeHtml(stampSrc)}" alt="">` : escapeHtml(label);
        return `<div class="stamp ${got ? "got" : ""}" title="${escapeHtml(s.name)}">${inner}</div>`;
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
        .bindPopup(`<b>${escapeHtml(s.name)}</b><br><span style="color:#6b6558">${escapeHtml(s.address || "")}</span>`);
    });
    if (bounds.length > 1) map.fitBounds(bounds, { padding: [28, 28] });
    setTimeout(() => map.invalidateSize(), 120);
    return map;
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Pub trail still falls back only when active memberships cannot be loaded.
  const FALLBACK_PUB_SHOPS = [
    { id: "powerhouse", name: "Powerhouse Brewery", address: "454 E Main Ave, Puyallup, WA", lat: 47.1919, lng: -122.2885, type: "pub" },
    { id: "the-club", name: "The Club Bar & Grill", address: "117 W Pioneer Ave, Puyallup, WA", lat: 47.1914, lng: -122.2939, type: "pub" },
    { id: "pioneer", name: "Pioneer Ale House", address: "108 W Pioneer Ave, Puyallup, WA", lat: 47.1915, lng: -122.2937, type: "pub" },
    { id: "meridian-tap", name: "Meridian Taproom", address: "320 S Meridian, Puyallup, WA", lat: 47.1891, lng: -122.2932, type: "pub" }
  ];

  window.HCCrawl = {
    CRAWL,
    client,
    ready,
    ensureAuth,
    getSession,
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
    initMap,
    FALLBACK_PUB_SHOPS,
    escapeHtml
  };
})();
