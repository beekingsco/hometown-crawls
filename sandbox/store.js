/* Hometown Crawls sandbox store. Fictional demo data only. No network calls. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HCSandboxStore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const STORAGE_KEY = "hc-sandbox-demo-v1";
  const GEOFENCE_M = 150;
  const DEMO_TODAY = "2026-11-22";
  const CRAWL_ID = "c-holiday";
  const YOU_ID = "g0";

  const STATUS_CYCLE = ["proposed", "approved", "changes", "skip"];
  const STATUS_LABEL = {
    proposed: "Proposed",
    approved: "Approved",
    changes: "Needs changes",
    skip: "Skip"
  };

  const TEMPLATES = [
    {
      id: "coffee",
      label: "Coffee",
      logo: "☕",
      color: "#1f3a24",
      price: 49,
      blurb: "Independent cafés, one walking passport.",
      prizes: [
        { stamps: 5, name: "Sticker" },
        { stamps: 8, name: "Grand-prize drawing" }
      ],
      shops: ["North Porch Coffee", "Second Kettle", "Little Window Cafe", "Depot Pour"]
    },
    {
      id: "taco",
      label: "Taco",
      logo: "🌮",
      color: "#6b3a22",
      price: 45,
      blurb: "A taco trail through a fictional downtown.",
      prizes: [
        { stamps: 4, name: "Hot-sauce sticker" },
        { stamps: 8, name: "Grand-prize drawing" }
      ],
      shops: ["Calle Verde Tacos", "Two Salsa", "Night Market Tacos", "Barrio Basket"]
    },
    {
      id: "ice-cream",
      label: "Ice Cream",
      logo: "🍦",
      color: "#245c6b",
      price: 39,
      blurb: "Scoop shops on a short summer walk.",
      prizes: [
        { stamps: 3, name: "Sprinkle sticker" },
        { stamps: 6, name: "Grand-prize drawing" }
      ],
      shops: ["Sprinkle & Co.", "The Cold Spoon", "Sunday Scoop", "Lantern Custard"]
    },
    {
      id: "small-business-saturday",
      label: "Small Business Saturday",
      logo: "🛍️",
      color: "#1f3a24",
      price: 29,
      blurb: "A one-weekend trail for independent storefronts.",
      prizes: [
        { stamps: 5, name: "Window sticker" },
        { stamps: 8, name: "Grand-prize drawing" }
      ],
      shops: ["Main Street Books", "Kindred Hardware", "Petal & Stem", "Round Window Goods"]
    }
  ];

  const IDEAS = [
    {
      id: "guest-passport",
      group: "Guest",
      title: "Crawl map and passport",
      summary: "A crawl page with a Leaflet map, shop pins, a stamp passport, and a progress bar. Alex Rivera starts this demo at 6 of 8.",
      hash: "#/ds/demo-town/holiday-coffee-crawl",
      role: "guest"
    },
    {
      id: "scan",
      group: "Guest",
      title: "Scan to stamp",
      summary: "Pick a shop, type its counter code, and pass a simulated 150 meter geofence. No camera and no live location call are required.",
      hash: "#/ds/demo-town/holiday-coffee-crawl/scan",
      role: "guest"
    },
    {
      id: "nudge",
      group: "Guest",
      title: "You're 2 away",
      summary: "When two stamps are left, the passport shows a “You're 2 away” nudge naming the next example shops.",
      hash: "#/ds/demo-town/holiday-coffee-crawl",
      role: "guest"
    },
    {
      id: "finish",
      group: "Guest",
      title: "Completion voucher and share card",
      summary: "A full passport shows a prize voucher code and a shareable “I finished” card. An example card is visible before Alex finishes.",
      hash: "#/ds/demo-town/holiday-coffee-crawl/done",
      role: "guest"
    },
    {
      id: "shop-checklist",
      group: "Shop",
      title: "Onboarding checklist",
      summary: "Confirm address, photo, hours, and the example offer. Edits stay in this browser only.",
      hash: "#/shop/checklist",
      role: "shop"
    },
    {
      id: "tent",
      group: "Shop",
      title: "Printable counter tent card",
      summary: "A counter card with a QR code and the shop code, plus print styles for a one-page handout.",
      hash: "#/shop/tent",
      role: "shop"
    },
    {
      id: "stats",
      group: "Shop",
      title: "Visit stats",
      summary: "Visits per day for the sample three weeks, plus repeat guests who also stamped other shops.",
      hash: "#/shop/stats",
      role: "shop"
    },
    {
      id: "redeem",
      group: "Shop",
      title: "Voucher redemption",
      summary: "Enter a guest's example voucher code and mark it redeemed. Nothing is emailed.",
      hash: "#/shop/redeem",
      role: "shop"
    },
    {
      id: "launch",
      group: "Organizer",
      title: "Launch a crawl",
      summary: "A wizard for town, template (Coffee, Taco, Ice Cream, or Small Business Saturday), dates, colors, prize tiers, and price per shop. Checkout is simulated.",
      hash: "#/organizer/launch",
      role: "organizer"
    },
    {
      id: "dashboard",
      group: "Organizer",
      title: "Organizer dashboard and CSV",
      summary: "Shops, guests, stamps, and completions for the selected demo crawl, with CSV downloads.",
      hash: "#/organizer",
      role: "organizer"
    },
    {
      id: "roi",
      group: "Organizer",
      title: "Post-event ROI one-pager",
      summary: "Foot traffic per shop, completions, and new guests, laid out to print on one page.",
      hash: "#/organizer/roi",
      role: "organizer"
    },
    {
      id: "admin-crawls",
      group: "Admin",
      title: "All crawls",
      summary: "Every demo crawl, including ones created in the launch wizard.",
      hash: "#/admin",
      role: "admin"
    },
    {
      id: "admin-apps",
      group: "Admin",
      title: "Organizer applications",
      summary: "Approve or reject example applications. Approval is local only and does not email anyone.",
      hash: "#/admin/applications",
      role: "admin"
    },
    {
      id: "admin-shops",
      group: "Admin",
      title: "Shop status",
      summary: "Toggle paid, on the map, and counter card ready. Map pins follow the on-map flag.",
      hash: "#/admin/shops",
      role: "admin"
    },
    {
      id: "admin-log",
      group: "Admin",
      title: "Refund and resend log",
      summary: "Simulated refund and simulated resend-email actions, written to an on-screen log. No Stripe call and no email.",
      hash: "#/admin/log",
      role: "admin"
    }
  ];

  const FIRST = ["Alex", "Jordan", "Sam", "Riley", "Casey", "Morgan", "Avery", "Quinn", "Taylor", "Jamie", "Reese", "Skyler", "Drew", "Parker", "Rowan", "Emery", "Hayden", "Finley", "Cameron", "Sage", "River", "Blake", "Logan", "Payton", "Kendall", "Harper", "Elliot", "Marlow", "Shiloh", "Dakota", "Remy", "Noah", "Luis", "Priya", "Omar", "Nina", "Theo", "Willa", "Jonah", "Maya"];
  const LAST = ["Rivera", "Nguyen", "Patel", "Brooks", "Coleman", "Diaz", "Edwards", "Foster", "Garcia", "Hansen", "Ibrahim", "Jensen", "Khan", "Lopez", "Martin", "Nwosu", "Owens", "Park", "Quintero", "Shah"];

  const SHOP_SEED = [
    { name: "Maple & Mug", code: "MAPL42", street: "18 Oak Lane", photo: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=1200&q=70", lat: 38.9719, lng: -95.2356, paid: true, cardReady: true, addressOk: false, photoOk: false, hoursOk: false, offerOk: false },
    { name: "The Lantern Pour", code: "LNTR18", street: "24 Oak Lane", photo: "https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&w=1200&q=70", lat: 38.9712, lng: -95.2353, paid: true, cardReady: true, addressOk: true, photoOk: true, hoursOk: true, offerOk: true },
    { name: "Cedar Spoon Cafe", code: "CEDR07", street: "31 Pine Street", photo: "https://images.unsplash.com/photo-1442512595331-e89e73853f31?auto=format&fit=crop&w=1200&q=70", lat: 38.9705, lng: -95.235, paid: true, cardReady: false, addressOk: true, photoOk: false, hoursOk: true, offerOk: true },
    { name: "Button & Bean", code: "BTNB55", street: "40 Pine Street", photo: "https://images.unsplash.com/photo-1511920170033-f8396924c348?auto=format&fit=crop&w=1200&q=70", lat: 38.9716, lng: -95.2344, paid: false, cardReady: true, addressOk: true, photoOk: true, hoursOk: false, offerOk: true },
    { name: "Hearth & Steam", code: "HRTH23", street: "7 Market Row", photo: "https://images.unsplash.com/photo-1498804103079-a6351b050096?auto=format&fit=crop&w=1200&q=70", lat: 38.9708, lng: -95.2342, paid: true, cardReady: true, addressOk: true, photoOk: true, hoursOk: true, offerOk: false },
    { name: "Little Wren Roasters", code: "WREN90", street: "15 Market Row", photo: "https://images.unsplash.com/photo-1507133750040-4a8f57021571?auto=format&fit=crop&w=1200&q=70", lat: 38.97, lng: -95.2355, paid: true, cardReady: true, addressOk: false, photoOk: true, hoursOk: true, offerOk: true },
    { name: "Copper Kettle Corner", code: "CPPR31", street: "22 Elm Court", photo: "https://images.unsplash.com/photo-1447933601403-0c6688de566e?auto=format&fit=crop&w=1200&q=70", lat: 38.9724, lng: -95.2348, paid: true, cardReady: true, addressOk: true, photoOk: true, hoursOk: true, offerOk: true },
    { name: "Starling Street Coffee", code: "STRL64", street: "3 Starling Street", photo: "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=1200&q=70", lat: 38.9698, lng: -95.2346, paid: false, cardReady: true, addressOk: true, photoOk: true, hoursOk: true, offerOk: true }
  ];

  function templateById(id) {
    return TEMPLATES.find((item) => item.id === id) || TEMPLATES[0];
  }

  function defaultWizard() {
    const template = TEMPLATES[0];
    return {
      step: 1,
      town: "",
      stateName: "",
      templateId: template.id,
      crawlName: "",
      nameTouched: false,
      start: "2026-11-01",
      end: "2026-12-31",
      color: template.color,
      logo: template.logo,
      logoImage: "",
      prizes: template.prizes.map((prize) => ({ stamps: prize.stamps, name: prize.name })),
      pricePerShop: template.price
    };
  }

  function slugify(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);
  }

  function stateSlug(value) {
    const trimmed = String(value || "").trim();
    if (/^[a-z]{2}$/i.test(trimmed)) return trimmed.toLowerCase();
    return slugify(trimmed);
  }

  function voucherCode(guestId) {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let hash = 0;
    const source = "sandbox|" + guestId;
    for (let i = 0; i < source.length; i += 1) hash = (hash * 33 + source.charCodeAt(i)) >>> 0;
    let out = "EX-";
    for (let i = 0; i < 6; i += 1) {
      out += alphabet[hash % alphabet.length];
      hash = (hash * 1664525 + 1013904223) >>> 0;
    }
    return out;
  }

  function haversineMeters(a, b) {
    const R = 6371000;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function simulatedFix(shop, place) {
    if (!shop) return null;
    if (place === "far") return { lat: shop.lat + 0.02, lng: shop.lng + 0.02 };
    return { lat: shop.lat + 0.00008, lng: shop.lng + 0.00008 };
  }

  function stampPlan(guestIndex) {
    if (guestIndex === 0) return [0, 1, 2, 3, 4, 5];
    if (guestIndex >= 1 && guestIndex <= 8) return [0, 1, 2, 3, 4, 5, 6, 7];
    let count = 1;
    if (guestIndex <= 18) count = 5 + (guestIndex % 3);
    else if (guestIndex <= 30) count = 2 + (guestIndex % 3);
    const offset = guestIndex % 8;
    const shops = [];
    for (let i = 0; i < count; i += 1) shops.push((offset + i) % 8);
    return shops;
  }

  function stampTime(guestIndex, shopIndex, slot) {
    const day = (guestIndex * 5 + shopIndex * 2 + slot) % 21;
    const date = String(1 + day).padStart(2, "0");
    const hour = String(8 + ((guestIndex + shopIndex) % 10)).padStart(2, "0");
    const minute = String((guestIndex * 11 + shopIndex * 5) % 60).padStart(2, "0");
    return `2026-11-${date}T${hour}:${minute}:00.000Z`;
  }

  function shopRecord(crawlId, index, seed) {
    const id = `${crawlId}-s${index}`;
    return {
      id,
      crawlId,
      name: seed.name,
      code: seed.code,
      address: `${seed.street}, Demo Town, DS 00000`,
      photo: seed.photo,
      hours: "Mon–Fri 7:00 a.m.–4:00 p.m. · Sat 8:00 a.m.–2:00 p.m.",
      offer: "EXAMPLE offer: a free flavor shot with any drink. Not a real shop decision.",
      lat: seed.lat,
      lng: seed.lng,
      paid: seed.paid,
      onMap: true,
      cardReady: seed.cardReady,
      checks: {
        address: !!seed.addressOk,
        photo: !!seed.photoOk,
        hours: !!seed.hoursOk,
        offer: !!seed.offerOk
      },
      email: `hello@${slugify(seed.name) || "shop"}.example`
    };
  }

  function createSeed() {
    const template = templateById("coffee");
    const crawl = {
      id: CRAWL_ID,
      name: "Holiday Coffee Crawl",
      templateId: "coffee",
      stateName: "Demo State",
      stateSlug: "ds",
      city: "Demo Town",
      citySlug: "demo-town",
      slug: "holiday-coffee-crawl",
      start: "2026-11-01",
      end: "2026-12-31",
      color: template.color,
      logo: template.logo,
      logoImage: "",
      pricePerShop: 49,
      status: "live",
      organizer: "Riley Chen",
      organization: "Demo Town Main Street Alliance (example)",
      prizes: [
        { stamps: 5, name: "Demo Town sticker", example: true },
        { stamps: 8, name: "Grand-prize drawing", example: true }
      ],
      createdAt: "2026-10-01T15:00:00.000Z"
    };

    const shops = SHOP_SEED.map((seed, index) => shopRecord(CRAWL_ID, index, seed));
    const guests = [];
    const stamps = [];

    for (let i = 0; i < 40; i += 1) {
      const id = `g${i}`;
      const first = FIRST[i];
      const last = LAST[i % LAST.length];
      const plan = stampPlan(i);
      const completed = plan.length === 8;
      guests.push({
        id,
        crawlId: CRAWL_ID,
        first,
        last,
        name: `${first} ${last}`,
        email: `${first}.${last}@guests.example`.toLowerCase(),
        you: i === 0,
        newToCrawl: i === 0 || i % 5 !== 0,
        voucher: completed ? voucherCode(id) : "",
        joinedAt: "2026-10-20T16:00:00.000Z"
      });
      plan.forEach((shopIndex, slot) => {
        stamps.push({
          id: `st-${id}-s${shopIndex}`,
          crawlId: CRAWL_ID,
          guestId: id,
          shopId: shops[shopIndex].id,
          at: stampTime(i, shopIndex, slot)
        });
      });
    }

    const redeemedGuest = guests.find((guest) => guest.id === "g1");
    const redemptions = [
      {
        id: "red-g1",
        crawlId: CRAWL_ID,
        guestId: "g1",
        shopId: shops[0].id,
        voucher: redeemedGuest.voucher,
        at: "2026-11-20T18:05:00.000Z"
      }
    ];

    const applications = [
      {
        id: "app-frostford",
        name: "Jordan Hale",
        organization: "Frostford Main Street (example)",
        town: "Frostford",
        stateName: "DS",
        templateId: "ice-cream",
        crawlId: "",
        status: "pending",
        submitted: "2026-10-28",
        note: "Example application. Not a real organizer."
      },
      {
        id: "app-riverbend",
        name: "Sam Okonkwo",
        organization: "Riverbend Chamber (example)",
        town: "Riverbend",
        stateName: "DS",
        templateId: "coffee",
        crawlId: "",
        status: "pending",
        submitted: "2026-10-30",
        note: "Example application. Not a real chamber."
      },
      {
        id: "app-mesa",
        name: "Priya Shah",
        organization: "Mesa Verde BID (example)",
        town: "Mesa Verde",
        stateName: "DS",
        templateId: "taco",
        crawlId: "",
        status: "rejected",
        submitted: "2026-10-12",
        note: "Example rejection — dates overlapped another sample crawl."
      }
    ];

    const actionLog = [
      {
        id: "log-seed-resend",
        at: "2026-11-02T15:10:00.000Z",
        kind: "resend",
        summary: "Simulated resend of the counter-card note to hello@maple-and-mug.example. No email was sent."
      },
      {
        id: "log-seed-refund",
        at: "2026-11-04T17:40:00.000Z",
        kind: "refund",
        summary: "Simulated refund noted for an unpaid example seat at Button & Bean. No Stripe call was made."
      }
    ];

    return {
      version: 1,
      role: "guest",
      activeCrawlId: CRAWL_ID,
      activeShopId: shops[0].id,
      youGuestId: YOU_ID,
      demoToday: DEMO_TODAY,
      crawls: [crawl],
      shops,
      guests,
      stamps,
      redemptions,
      applications,
      actionLog,
      ideaStatus: {},
      wizard: defaultWizard(),
      scanDraft: { shopId: shops[6].id, code: "", place: "near" }
    };
  }

  function loadState(storage) {
    const seed = createSeed();
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return seed;
      const saved = JSON.parse(raw);
      if (!saved || saved.version !== 1 || !Array.isArray(saved.crawls) || !saved.crawls.length) return seed;
      saved.wizard = Object.assign(defaultWizard(), saved.wizard || {});
      saved.scanDraft = Object.assign({ shopId: "", code: "", place: "near" }, saved.scanDraft || {});
      saved.ideaStatus = saved.ideaStatus || {};
      saved.actionLog = saved.actionLog || [];
      saved.redemptions = saved.redemptions || [];
      saved.applications = saved.applications || [];
      saved.role = saved.role || "guest";
      saved.youGuestId = saved.youGuestId || YOU_ID;
      saved.demoToday = DEMO_TODAY;
      return saved;
    } catch (err) {
      return seed;
    }
  }

  function saveState(storage, state) {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function resetState(storage) {
    storage.removeItem(STORAGE_KEY);
    return createSeed();
  }

  function crawlById(state, id) {
    return state.crawls.find((crawl) => crawl.id === id) || null;
  }

  function activeCrawl(state) {
    return crawlById(state, state.activeCrawlId) || state.crawls[0];
  }

  function crawlByRoute(state, stateSlugValue, citySlug, slug) {
    return state.crawls.find((crawl) => crawl.stateSlug === stateSlugValue && crawl.citySlug === citySlug && crawl.slug === slug) || null;
  }

  function shopsFor(state, crawlId) {
    return state.shops.filter((shop) => shop.crawlId === crawlId);
  }

  function onMapShops(state, crawlId) {
    return shopsFor(state, crawlId).filter((shop) => shop.onMap);
  }

  function guestsFor(state, crawlId) {
    return state.guests.filter((guest) => guest.crawlId === crawlId);
  }

  function stampsFor(state, crawlId, guestId) {
    return state.stamps.filter((stamp) => stamp.crawlId === crawlId && (!guestId || stamp.guestId === guestId));
  }

  function shopById(state, id) {
    return state.shops.find((shop) => shop.id === id) || null;
  }

  function guestById(state, id) {
    return state.guests.find((guest) => guest.id === id) || null;
  }

  function activeShop(state) {
    const crawl = activeCrawl(state);
    const shops = shopsFor(state, crawl.id);
    return shops.find((shop) => shop.id === state.activeShopId) || shops[0] || null;
  }

  function guestStampCount(state, crawlId, guestId, onlyOnMap) {
    const allowed = new Set((onlyOnMap ? onMapShops(state, crawlId) : shopsFor(state, crawlId)).map((shop) => shop.id));
    return stampsFor(state, crawlId, guestId).filter((stamp) => allowed.has(stamp.shopId)).length;
  }

  function progress(state, crawlId, guestId) {
    const stops = onMapShops(state, crawlId);
    const mine = new Set(stampsFor(state, crawlId, guestId).map((stamp) => stamp.shopId));
    const gotShops = stops.filter((shop) => mine.has(shop.id));
    const nextShops = stops.filter((shop) => !mine.has(shop.id));
    const total = stops.length;
    const got = gotShops.length;
    const remaining = Math.max(0, total - got);
    let nudge = "";
    if (remaining === 2) nudge = "You're 2 away";
    else if (remaining === 1) nudge = "You're 1 away";
    return {
      total,
      got,
      remaining,
      done: total > 0 && remaining === 0,
      nudge,
      nextShops,
      gotShops
    };
  }

  function normalizeCode(code) {
    return String(code || "").replace(/\s+/g, "").toUpperCase();
  }

  function claimStamp(state, input) {
    const shop = shopById(state, input.shopId);
    if (!shop) return { ok: false, error: "Pick a shop on this crawl." };
    if (!shop.onMap) return { ok: false, error: "That shop is not on the map yet." };
    const code = normalizeCode(input.code);
    if (!code || code !== normalizeCode(shop.code)) return { ok: false, error: "Invalid code" };
    const lat = Number(input.lat);
    const lng = Number(input.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, error: "Location required" };
    const distance = haversineMeters(shop, { lat, lng });
    if (distance > GEOFENCE_M) {
      return { ok: false, error: "You need to be at the shop", distance };
    }
    const guestId = input.guestId || state.youGuestId;
    const exists = state.stamps.some((stamp) => stamp.crawlId === shop.crawlId && stamp.guestId === guestId && stamp.shopId === shop.id);
    if (exists) return { ok: false, error: "Already stamped", distance };
    state.stamps.push({
      id: `st-${guestId}-${shop.id}-${state.stamps.length}`,
      crawlId: shop.crawlId,
      guestId,
      shopId: shop.id,
      at: `${DEMO_TODAY}T18:30:00.000Z`
    });
    const after = progress(state, shop.crawlId, guestId);
    const guest = guestById(state, guestId);
    if (after.done && guest && !guest.voucher) guest.voucher = voucherCode(guestId);
    return { ok: true, distance, completed: after.done, voucher: guest ? guest.voucher : "" };
  }

  function findVoucherGuest(state, code) {
    const wanted = normalizeCode(code);
    return state.guests.find((guest) => guest.voucher && normalizeCode(guest.voucher) === wanted) || null;
  }

  function redeemVoucher(state, input) {
    const code = normalizeCode(input.code);
    if (!code) return { ok: false, error: "Enter a voucher code." };
    const guest = findVoucherGuest(state, code);
    if (!guest) return { ok: false, error: "No demo guest has that voucher code." };
    const shop = shopById(state, input.shopId);
    if (!shop || shop.crawlId !== guest.crawlId) return { ok: false, error: "Choose a shop on that guest's crawl." };
    const existing = state.redemptions.find((row) => normalizeCode(row.voucher) === code);
    if (existing) return { ok: false, error: "Already redeemed", redemption: existing, guest };
    const redemption = {
      id: `red-${guest.id}-${state.redemptions.length}`,
      crawlId: guest.crawlId,
      guestId: guest.id,
      shopId: shop.id,
      voucher: guest.voucher,
      at: `${DEMO_TODAY}T19:00:00.000Z`
    };
    state.redemptions.push(redemption);
    return { ok: true, redemption, guest };
  }

  function money(amount) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount || 0);
  }

  function dayKey(iso) {
    return String(iso || "").slice(0, 10);
  }

  function visitsByDay(state, shopId) {
    const shop = shopById(state, shopId);
    if (!shop) return [];
    const counts = new Map();
    stampsFor(state, shop.crawlId).forEach((stamp) => {
      if (stamp.shopId !== shopId) return;
      const key = dayKey(stamp.at);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    const days = [...counts.keys()].sort();
    if (!days.length) return [];
    return days.map((date) => ({ date, count: counts.get(date) }));
  }

  function repeatGuests(state, shopId) {
    const shop = shopById(state, shopId);
    if (!shop) return [];
    const stamps = stampsFor(state, shop.crawlId);
    return guestsFor(state, shop.crawlId)
      .map((guest) => {
        const mine = stamps.filter((stamp) => stamp.guestId === guest.id);
        const here = mine.some((stamp) => stamp.shopId === shopId);
        return { guest, here, total: mine.length, others: mine.filter((stamp) => stamp.shopId !== shopId).length };
      })
      .filter((row) => row.here && row.others > 0)
      .sort((a, b) => b.total - a.total || a.guest.name.localeCompare(b.guest.name));
  }

  function firstOnlyGuests(state, shopId) {
    const shop = shopById(state, shopId);
    if (!shop) return [];
    const stamps = stampsFor(state, shop.crawlId);
    return guestsFor(state, shop.crawlId).filter((guest) => {
      const mine = stamps.filter((stamp) => stamp.guestId === guest.id);
      return mine.length === 1 && mine[0].shopId === shopId;
    });
  }

  function roi(state, crawlId) {
    const crawl = crawlById(state, crawlId);
    const shops = shopsFor(state, crawlId);
    const guests = guestsFor(state, crawlId);
    const stops = onMapShops(state, crawlId);
    const traffic = shops.map((shop) => {
      const stamps = stampsFor(state, crawlId).filter((stamp) => stamp.shopId === shop.id);
      const people = new Set(stamps.map((stamp) => stamp.guestId));
      return { shop, visits: stamps.length, guests: people.size };
    });
    const completions = guests.filter((guest) => progress(state, crawlId, guest.id).done).length;
    const stampedGuestIds = new Set(stampsFor(state, crawlId).map((stamp) => stamp.guestId));
    const participating = guests.filter((guest) => stampedGuestIds.has(guest.id));
    const newGuests = participating.filter((guest) => guest.newToCrawl).length;
    const returningGuests = participating.length - newGuests;
    return {
      crawl,
      stops: stops.length,
      traffic,
      completions,
      guests: participating.length,
      newGuests,
      returningGuests
    };
  }

  function csvEscape(value) {
    const text = String(value ?? "");
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  }

  function toCsv(rows) {
    return rows.map((row) => row.map(csvEscape).join(",")).join("\n") + "\n";
  }

  function guestsCsv(state, crawlId) {
    const header = ["name", "email", "stamps", "passport_stops", "completed", "new_guest", "voucher", "redeemed"];
    const rows = [header];
    guestsFor(state, crawlId).forEach((guest) => {
      const prog = progress(state, crawlId, guest.id);
      const redeemed = state.redemptions.some((row) => row.guestId === guest.id);
      rows.push([
        guest.name,
        guest.email,
        prog.got,
        prog.total,
        prog.done ? "yes" : "no",
        guest.newToCrawl ? "yes" : "no",
        guest.voucher || "",
        redeemed ? "yes" : "no"
      ]);
    });
    return toCsv(rows);
  }

  function stampsCsv(state, crawlId) {
    const rows = [["date", "guest", "shop", "crawl"]];
    const crawl = crawlById(state, crawlId);
    stampsFor(state, crawlId)
      .slice()
      .sort((a, b) => a.at.localeCompare(b.at))
      .forEach((stamp) => {
        const guest = guestById(state, stamp.guestId);
        const shop = shopById(state, stamp.shopId);
        rows.push([dayKey(stamp.at), guest ? guest.name : stamp.guestId, shop ? shop.name : stamp.shopId, crawl ? crawl.name : crawlId]);
      });
    return toCsv(rows);
  }

  function dashboard(state, crawlId) {
    const guests = guestsFor(state, crawlId);
    const stamps = stampsFor(state, crawlId);
    const shops = shopsFor(state, crawlId);
    const completions = guests.filter((guest) => progress(state, crawlId, guest.id).done).length;
    return {
      shops: shops.length,
      guests: guests.length,
      stamps: stamps.length,
      completions
    };
  }

  function log(state, kind, summary) {
    state.actionLog.unshift({
      id: `log-${Date.now()}-${kind}`,
      at: new Date().toISOString(),
      kind,
      summary
    });
  }

  function setShopFlag(state, shopId, flag, value) {
    const shop = shopById(state, shopId);
    if (!shop) return { ok: false, error: "Shop not found." };
    if (flag === "paid") shop.paid = !!value;
    else if (flag === "onMap") shop.onMap = !!value;
    else if (flag === "cardReady") shop.cardReady = !!value;
    else return { ok: false, error: "Unknown status." };
    return { ok: true, shop };
  }

  function simulateRefund(state, shopId) {
    const shop = shopById(state, shopId);
    if (!shop) return { ok: false, error: "Pick a shop." };
    if (!shop.paid) return { ok: false, error: "That example seat is not marked paid." };
    const crawl = crawlById(state, shop.crawlId);
    shop.paid = false;
    const summary = `Simulated refund of ${money(crawl.pricePerShop)} for ${shop.name}. No Stripe call was made.`;
    log(state, "refund", summary);
    return { ok: true, summary };
  }

  function simulateResend(state, shopId) {
    const shop = shopById(state, shopId);
    if (!shop) return { ok: false, error: "Pick a shop." };
    const summary = `Simulated resend of the counter-card note to ${shop.email}. No email was sent.`;
    log(state, "resend", summary);
    return { ok: true, summary };
  }

  function decideApplication(state, appId, status) {
    const app = state.applications.find((item) => item.id === appId);
    if (!app) return { ok: false, error: "Application not found." };
    if (app.status !== "pending") return { ok: false, error: "That application is already decided." };
    app.status = status === "approved" ? "approved" : "rejected";
    if (app.crawlId) {
      const crawl = crawlById(state, app.crawlId);
      if (crawl) crawl.status = app.status === "approved" ? "live" : "rejected";
    }
    const summary = `${app.status === "approved" ? "Approved" : "Rejected"} the example application from ${app.name} (${app.town}). No email was sent.`;
    log(state, app.status === "approved" ? "approve" : "reject", summary);
    return { ok: true, application: app, summary };
  }

  function nextStatus(current) {
    const index = STATUS_CYCLE.indexOf(current);
    if (index === -1) return STATUS_CYCLE[1];
    return STATUS_CYCLE[(index + 1) % STATUS_CYCLE.length];
  }

  function ideaLabel(status) {
    return STATUS_LABEL[status] || STATUS_LABEL.proposed;
  }

  function routeFor(crawl, tab) {
    const base = `#/${crawl.stateSlug}/${crawl.citySlug}/${crawl.slug}`;
    if (!tab || tab === "passport") return base;
    return `${base}/${tab}`;
  }

  function homeForRole(role, state) {
    if (role === "shop") return "#/shop/checklist";
    if (role === "organizer") return "#/organizer";
    if (role === "admin") return "#/admin";
    const crawl = activeCrawl(state);
    return routeFor(crawl, "passport");
  }

  function validateWizard(wizard, step) {
    const errors = [];
    const current = step || wizard.step;
    if (current === 1) {
      if (!String(wizard.town || "").trim()) errors.push("Enter a town name.");
      if (!String(wizard.stateName || "").trim()) errors.push("Enter a state or a two-letter code.");
    }
    if (current === 2 && !templateById(wizard.templateId)) errors.push("Choose a crawl template.");
    if (current === 3) {
      if (!wizard.start || !wizard.end) errors.push("Choose a start and end date.");
      else if (wizard.end < wizard.start) errors.push("The end date needs to be on or after the start date.");
    }
    if (current === 4) {
      if (!/^#[0-9a-fA-F]{6}$/.test(wizard.color || "")) errors.push("Use a hex color like #1f3a24.");
    }
    if (current === 5) {
      const prizes = wizard.prizes || [];
      if (!prizes.length) errors.push("Add at least one example prize tier.");
      prizes.forEach((prize, index) => {
        const stamps = Number(prize.stamps);
        if (!Number.isFinite(stamps) || stamps < 1) errors.push(`Prize ${index + 1} needs a stamp count.`);
        if (!String(prize.name || "").trim()) errors.push(`Prize ${index + 1} needs a name.`);
      });
    }
    if (current === 6) {
      const price = Number(wizard.pricePerShop);
      if (!Number.isFinite(price) || price < 0) errors.push("Enter a price per shop, or 0.");
    }
    if (current === 7) {
      for (let step = 1; step <= 6; step += 1) errors.push(...validateWizard(wizard, step));
    }
    return errors;
  }

  function pinFor(citySlug, index) {
    let hash = 0;
    const source = citySlug || "town";
    for (let i = 0; i < source.length; i += 1) hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
    const lat = 39.05 + ((hash % 200) - 100) / 400;
    const lng = -96.1 + (((hash >> 8) % 200) - 100) / 400;
    return {
      lat: Math.round((lat + index * 0.0045) * 10000) / 10000,
      lng: Math.round((lng + (index % 2 === 0 ? 0.003 : -0.003)) * 10000) / 10000
    };
  }

  function createCrawl(state, wizard) {
    for (let step = 1; step <= 6; step += 1) {
      const errors = validateWizard(wizard, step);
      if (errors.length) return { ok: false, error: errors[0], step };
    }
    const template = templateById(wizard.templateId);
    const city = String(wizard.town).trim();
    const stateName = String(wizard.stateName).trim();
    const citySlug = slugify(city);
    const st = stateSlug(stateName);
    if (!citySlug || !st) return { ok: false, error: "Town and state need letters or numbers.", step: 1 };
    let slug = slugify(wizard.crawlName || `${city} ${template.label} Crawl`);
    let candidate = slug || "crawl";
    const reserved = new Set(["ideas", "shop", "organizer", "admin", "guest", "sandbox"]);
    if (reserved.has(candidate)) candidate = `${candidate}-trail`;
    let n = 2;
    while (state.crawls.some((crawl) => crawl.stateSlug === st && crawl.citySlug === citySlug && crawl.slug === candidate)) {
      candidate = `${slug || "crawl"}-${n}`;
      n += 1;
    }
    const crawl = {
      id: `c-${st}-${citySlug}-${candidate}`.slice(0, 64),
      name: String(wizard.crawlName || `${city} ${template.label} Crawl`).trim(),
      templateId: template.id,
      stateName: /^[a-z]{2}$/i.test(stateName) ? stateName.toUpperCase() : stateName,
      stateSlug: st,
      city,
      citySlug,
      slug: candidate,
      start: wizard.start,
      end: wizard.end,
      color: wizard.color,
      logo: wizard.logo || template.logo,
      logoImage: wizard.logoImage || "",
      pricePerShop: Number(wizard.pricePerShop) || 0,
      status: "pending",
      organizer: "You (demo organizer)",
      organization: `${city} example group`,
      prizes: (wizard.prizes || []).map((prize) => ({
        stamps: Number(prize.stamps),
        name: String(prize.name).trim(),
        example: true
      })),
      createdAt: `${DEMO_TODAY}T16:00:00.000Z`
    };
    const shops = template.shops.map((name, index) => {
      const pin = pinFor(citySlug, index);
      const record = shopRecord(crawl.id, index, {
        name,
        code: `EX${index + 1}${candidate.slice(0, 2).toUpperCase()}${10 + index}`,
        street: `${100 + index * 12} Example Avenue`,
        photo: SHOP_SEED[index % SHOP_SEED.length].photo,
        lat: pin.lat,
        lng: pin.lng,
        paid: false,
        cardReady: false,
        addressOk: false,
        photoOk: false,
        hoursOk: false,
        offerOk: false
      });
      record.address = `${100 + index * 12} Example Avenue, ${city}, ${crawl.stateName}`;
      record.offer = "EXAMPLE offer from the template. Not a real shop decision.";
      record.onMap = false;
      return record;
    });
    const application = {
      id: `app-${crawl.id}`,
      name: crawl.organizer,
      organization: crawl.organization,
      town: city,
      stateName: crawl.stateName,
      templateId: template.id,
      crawlId: crawl.id,
      status: "pending",
      submitted: DEMO_TODAY,
      note: "Created by the sandbox launch wizard. Checkout was simulated."
    };
    state.crawls.push(crawl);
    state.shops.push(...shops);
    state.guests.push({
      id: `you-${crawl.id}`,
      crawlId: crawl.id,
      first: "Alex",
      last: "Rivera",
      name: "Alex Rivera",
      email: "alex.rivera@guests.example",
      you: true,
      newToCrawl: true,
      voucher: "",
      joinedAt: `${DEMO_TODAY}T16:00:00.000Z`
    });
    state.applications.unshift(application);
    state.activeCrawlId = crawl.id;
    state.activeShopId = shops[0].id;
    log(state, "create", `Created demo crawl “${crawl.name}” at /sandbox/${st}/${citySlug}/${candidate}. Simulated checkout only — nothing was charged.`);
    return {
      ok: true,
      crawl,
      receipt: {
        simulated: true,
        message: "Simulated checkout. No card was charged. Stripe was not called.",
        perShop: crawl.pricePerShop
      }
    };
  }

  function applyTemplate(wizard) {
    const template = templateById(wizard.templateId);
    wizard.color = template.color;
    wizard.logo = template.logo;
    wizard.pricePerShop = template.price;
    wizard.prizes = template.prizes.map((prize) => ({ stamps: prize.stamps, name: prize.name }));
    if (!wizard.nameTouched) {
      const town = String(wizard.town || "").trim() || "Your town";
      wizard.crawlName = template.id === "small-business-saturday"
        ? `${town} Small Business Saturday`
        : `${town} ${template.label} Crawl`;
    }
    return wizard;
  }

  function safeColor(color) {
    return /^#[0-9a-fA-F]{6}$/.test(color || "") ? color : "#1f3a24";
  }

  function shortDate(iso) {
    const [year, month, day] = String(iso || "").slice(0, 10).split("-");
    if (!year || !month || !day) return "";
    const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${names[Number(month) - 1]} ${Number(day)}`;
  }

  function displayRange(crawl) {
    return `${shortDate(crawl.start)} – ${shortDate(crawl.end)}`;
  }

  return {
    STORAGE_KEY,
    GEOFENCE_M,
    DEMO_TODAY,
    CRAWL_ID,
    YOU_ID,
    TEMPLATES,
    IDEAS,
    STATUS_CYCLE,
    templateById,
    defaultWizard,
    slugify,
    stateSlug,
    voucherCode,
    haversineMeters,
    simulatedFix,
    createSeed,
    loadState,
    saveState,
    resetState,
    crawlById,
    activeCrawl,
    crawlByRoute,
    shopsFor,
    onMapShops,
    guestsFor,
    stampsFor,
    shopById,
    guestById,
    activeShop,
    guestStampCount,
    progress,
    normalizeCode,
    claimStamp,
    redeemVoucher,
    money,
    visitsByDay,
    repeatGuests,
    firstOnlyGuests,
    roi,
    guestsCsv,
    stampsCsv,
    dashboard,
    setShopFlag,
    simulateRefund,
    simulateResend,
    decideApplication,
    nextStatus,
    ideaLabel,
    routeFor,
    homeForRole,
    validateWizard,
    createCrawl,
    applyTemplate,
    safeColor,
    shortDate,
    displayRange,
    dayKey
  };
});
