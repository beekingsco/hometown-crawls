/* Store tab helpers: stats, optional coupon, consented guest export, demo code.
   ?demo=1 shows DEMO_STORE / DEMO_ORGANIZER from assets/config.js.
   The coupon is off until the shop turns it on.
   Demo coupons stay on hc-coupon-anthemco. A signed-in shop uses its own
   listing id, and the guest card uses that listing's display name. */
(function () {
  var DEMO_COUPON_KEY = "hc-coupon-anthemco";
  var CODE_KEY = "hc-code-anthemco";
  var liveShop = null;
  var currentCoupon = null;

  function env() {
    return window.__HC_ENV__ || {};
  }

  function fixture() {
    return env().DEMO_STORE || null;
  }

  function demoRequested() {
    return new URLSearchParams(location.search).get("demo") === "1";
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function percent(part, whole) {
    var p = Number(part) || 0;
    var w = Number(whole) || 0;
    if (!w) return "0%";
    var n = Math.round((p / w) * 1000) / 10;
    return (n % 1 === 0 ? String(n) : n.toFixed(1)) + "%";
  }

  function alphabet() {
    return (fixture() && fixture().codeAlphabet) || "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  }

  function randomStoreCode(len) {
    var chars = alphabet();
    var n = Math.min(8, Math.max(6, Number(len) || 8));
    var out = "";
    var bytes = new Uint8Array(n);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (var i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
    for (var j = 0; j < n; j++) out += chars[bytes[j] % chars.length];
    return out;
  }

  function fmtWhen(iso) {
    if (!iso) return "";
    var date = new Date(iso);
    if (isNaN(date.getTime())) return String(iso);
    try {
      return new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "America/Chicago"
      }).format(date);
    } catch (e) {
      return date.toLocaleString();
    }
  }

  function consentedGuests(list) {
    return (list || []).filter(function (row) {
      return row && row.consentedAt && row.email && row.name;
    });
  }

  function storageKey() {
    if (demoRequested()) return DEMO_COUPON_KEY;
    if (liveShop && liveShop.listingId) return "hc-coupon-listing-" + liveShop.listingId;
    return "";
  }

  function blankCoupon() {
    return { enabled: false, reward: "", expiryDays: 30, issued: null, redeemed: null };
  }

  function rememberCoupon(coupon) {
    currentCoupon = {
      enabled: coupon.enabled === true,
      reward: String(coupon.reward || "").trim(),
      expiryDays: Number(coupon.expiryDays) || 30,
      issued: coupon.issued != null ? coupon.issued : null,
      redeemed: coupon.redeemed != null ? coupon.redeemed : null
    };
    return currentCoupon;
  }

  function loadCoupon(base) {
    var coupon = {
      enabled: false,
      reward: (base && base.reward) || "",
      expiryDays: (base && base.expiryDays) || 30,
      issued: base && base.issued != null ? base.issued : (demoRequested() ? 0 : null),
      redeemed: base && base.redeemed != null ? base.redeemed : (demoRequested() ? 0 : null)
    };
    var key = storageKey();
    if (!key) return coupon;
    try {
      var saved = JSON.parse(localStorage.getItem(key) || "null");
      if (saved && typeof saved === "object") {
        coupon.enabled = saved.enabled === true;
        if (typeof saved.reward === "string" && saved.reward.trim()) coupon.reward = saved.reward.trim();
        var days = Number(saved.expiryDays);
        if (days >= 1 && days <= 365) coupon.expiryDays = Math.round(days);
      }
    } catch (e) {}
    return coupon;
  }

  function saveCoupon(coupon) {
    var key = storageKey();
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify({
        enabled: coupon.enabled === true,
        reward: String(coupon.reward || "").trim(),
        expiryDays: Number(coupon.expiryDays) || 30
      }));
    } catch (e) {}
  }

  function listingHasReward(listing) {
    return !!(listing && (
      Object.prototype.hasOwnProperty.call(listing, "reward_enabled") ||
      Object.prototype.hasOwnProperty.call(listing, "reward_text") ||
      Object.prototype.hasOwnProperty.call(listing, "reward_expiry_days")
    ));
  }

  function couponFromListing(listing) {
    var days = Number(listing && listing.reward_expiry_days);
    return {
      enabled: !!(listing && listing.reward_enabled === true),
      reward: listing && typeof listing.reward_text === "string" ? listing.reward_text.trim() : "",
      expiryDays: days >= 1 && days <= 365 ? Math.round(days) : 30,
      issued: null,
      redeemed: null
    };
  }

  function readFormCoupon() {
    var base = currentCoupon || (demoRequested() ? loadCoupon(fixture() && fixture().coupon) : blankCoupon());
    var rewardEl = document.getElementById("coupon-reward");
    var daysEl = document.getElementById("coupon-days");
    var toggle = document.getElementById("coupon-enabled");
    var days = daysEl && daysEl.value !== "" ? Number(daysEl.value) : base.expiryDays;
    if (!days || days < 1 || days > 365) days = base.expiryDays || 30;
    return rememberCoupon({
      enabled: toggle ? toggle.checked === true : base.enabled === true,
      reward: rewardEl ? rewardEl.value.trim() : base.reward,
      expiryDays: days,
      issued: base.issued,
      redeemed: base.redeemed
    });
  }

  function rewardShopName(sample) {
    if (sample || demoRequested()) {
      var shop = (fixture() && fixture().shop) || {};
      return shop.name || "Anthem Coffee & Tea";
    }
    if (liveShop && liveShop.name) return liveShop.name;
    return "This shop";
  }

  async function persistCoupon(coupon) {
    if (demoRequested()) {
      saveCoupon(coupon);
      return { ok: true, message: "Reward saved on this browser. Guests see it after they stamp." };
    }
    if (!liveShop || !liveShop.listingId) {
      return { ok: false, message: "Sign in as the store owner to save this reward." };
    }
    if (!window.HCCrawl || !HCCrawl.client) {
      saveCoupon(coupon);
      return { ok: true, message: "Reward saved on this browser for this shop. Guests see it after they stamp." };
    }
    try {
      var res = await HCCrawl.client().rpc("shop_save_reward", {
        p_listing: liveShop.listingId,
        p_enabled: coupon.enabled === true,
        p_reward: String(coupon.reward || "").trim(),
        p_expiry_days: Math.round(Number(coupon.expiryDays) || 30)
      });
      if (res && res.error) throw res.error;
      saveCoupon(coupon);
      return {
        ok: true,
        remote: true,
        message: coupon.enabled
          ? "Reward saved for this shop. Guests see it after they stamp."
          : "Reward turned off for this shop."
      };
    } catch (e) {
      var message = (e && e.message) || "Could not save the reward.";
      if (/shop_save_reward|schema cache|reward_enabled|reward_text/i.test(message)) {
        saveCoupon(coupon);
        return { ok: true, message: "Reward saved on this browser for this shop. Guests see it after they stamp." };
      }
      return { ok: false, message: message };
    }
  }

  function useLiveListing(listing) {
    if (demoRequested() || !listing || !listing.listing_id) return;
    liveShop = {
      listingId: String(listing.listing_id),
      name: (listing.display_name && String(listing.display_name).trim()) || "Your shop",
      businessId: listing.business_id || "",
      crawlId: listing.crawl_id || ""
    };
    var coupon;
    if (listingHasReward(listing)) {
      coupon = couponFromListing(listing);
      if (!coupon.enabled && !coupon.reward) {
        var stored = loadCoupon(blankCoupon());
        if (stored.enabled || stored.reward) {
          coupon = stored;
          persistCoupon(coupon).catch(function () {});
        }
      }
    } else {
      coupon = loadCoupon(blankCoupon());
    }
    rememberCoupon(coupon);
    fillCoupon(coupon, false);
  }

  function setLiveShopName(name) {
    if (demoRequested() || !liveShop) return;
    var next = String(name || "").trim();
    if (!next) return;
    liveShop.name = next;
    if (currentCoupon) fillCoupon(currentCoupon, false);
  }

  function currentCode(demo) {
    var live = (demo && demo.shop && demo.shop.storeCode) || "ANTHEMCO";
    if (!demoRequested()) return live;
    try {
      var saved = localStorage.getItem(CODE_KEY);
      if (saved && /^[A-Z2-9]{6,8}$/.test(saved)) return saved;
    } catch (e) {}
    return live;
  }

  function csvCell(value) {
    var s = value == null ? "" : String(value);
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function downloadGuests(guests, storeCode) {
    var rows = consentedGuests(guests);
    var header = ["name", "email", "crawls_joined", "stamps_count", "consented_at", "demo"];
    var lines = [header.join(",")];
    rows.forEach(function (row) {
      lines.push([
        csvCell(row.name),
        csvCell(row.email),
        csvCell(row.crawlsJoined),
        csvCell(row.stamps),
        csvCell(row.consentedAt),
        csvCell(demoRequested() ? "DEMO DATA" : "")
      ].join(","));
    });
    var blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    var day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    a.href = URL.createObjectURL(blob);
    a.download = (storeCode || "guests") + "-guests-" + day + ".csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function fillStats(demo) {
    var stats = demo.stats || {};
    var map = {
      "stat-players": stats.players,
      "stat-scans": stats.scans,
      "stat-shop-scans": stats.shopScans,
      "stat-share": percent(stats.shopScans, stats.scans),
      "stat-first": stats.firstTime
    };
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.textContent = map[id] == null ? "—" : String(map[id]);
    });
  }

  function statsRows(data) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object") return [data];
    return [];
  }

  async function fillLiveStats(listingId) {
    if (demoRequested() || !listingId || !window.HCCrawl || !HCCrawl.client) return false;
    try {
      var res = await HCCrawl.client().rpc("shop_my_stats");
      if (!res || res.error) return false;
      var row = null;
      statsRows(res.data).forEach(function (item) {
        if (!row && item && item.listing_id === listingId) row = item;
      });
      if (!row) return false;
      fillStats({
        stats: {
          players: row.players,
          scans: row.scans,
          shopScans: row.shop_scans,
          firstTime: row.first_time
        }
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  function fillShop(demo) {
    var shop = demo.shop || {};
    var name = document.getElementById("store-name");
    var code = document.getElementById("store-code");
    var big = document.getElementById("store-code-big");
    var crawl = document.getElementById("store-crawl");
    var shown = currentCode(demo);
    if (name) name.textContent = shop.name || "Your shop";
    if (code) code.textContent = shown;
    if (big) big.textContent = shown;
    if (crawl) crawl.textContent = (shop.crawlName || "") + (demo.dates ? " · " + demo.dates.label : "");
  }

  function fillCoupon(coupon, sample) {
    var toggle = document.getElementById("coupon-enabled");
    var fields = document.getElementById("coupon-fields");
    var reward = document.getElementById("coupon-reward");
    var days = document.getElementById("coupon-days");
    var issued = document.getElementById("coupon-issued");
    var redeemed = document.getElementById("coupon-redeemed");
    if (toggle) toggle.checked = coupon.enabled === true;
    if (fields) fields.classList.toggle("hidden", coupon.enabled !== true);
    if (reward && document.activeElement !== reward) reward.value = coupon.reward;
    if (days && document.activeElement !== days) days.value = String(coupon.expiryDays);
    if (issued) issued.textContent = coupon.issued == null ? "—" : String(coupon.issued);
    if (redeemed) redeemed.textContent = coupon.redeemed == null ? "—" : String(coupon.redeemed);
    var guestText = document.getElementById("guest-reward-text");
    var guestMeta = document.getElementById("guest-reward-meta");
    var guestNote = document.getElementById("guest-reward-note");
    var guestCard = document.getElementById("guest-reward");
    var showGuest = coupon.enabled === true && !!coupon.reward;
    if (guestText) guestText.textContent = coupon.reward;
    if (guestMeta) {
      guestMeta.textContent = rewardShopName(sample) + " · show within " + coupon.expiryDays + " days of your stamp";
    }
    if (guestNote) {
      guestNote.textContent = sample
        ? "DEMO DATA. Guests see this only after the shop turns the reward on and they stamp."
        : "Unlocked because you stamped this shop.";
    }
    if (guestCard) guestCard.classList.toggle("hidden", !showGuest);
  }

  function guestTableRow(row, label) {
    return "<tr><td><b>" + esc(row.name) + '</b> <span class="pill pill-wait">' + esc(label) + "</span></td><td>" +
      esc(row.email) + "</td><td>" + esc(row.crawlsJoined) + "</td><td>" + esc(row.stamps) + "</td><td>" +
      esc(fmtWhen(row.consentedAt)) + "</td></tr>";
  }

  function guestCard(row, label) {
    return '<article class="record-card"><b class="record-name">' + esc(row.name) + "</b>" +
      '<p class="record-email">' + esc(row.email) + "</p>" +
      '<div class="record-chips">' +
      '<span class="chip">' + esc(String(row.stamps)) + " stamps</span>" +
      '<span class="chip">' + esc(row.crawlsJoined) + "</span>" +
      '<span class="chip">' + esc(fmtWhen(row.consentedAt)) + "</span>" +
      (label ? '<span class="chip">' + esc(label) + "</span>" : "") +
      "</div></article>";
  }

  function fillGuests(demo) {
    var rows = consentedGuests(demo.guests);
    var label = demo.label || "DEMO DATA";
    var body = document.getElementById("guest-rows");
    var cards = document.getElementById("guest-cards");
    if (body) body.innerHTML = rows.map(function (row) { return guestTableRow(row, label); }).join("");
    if (cards) cards.innerHTML = rows.map(function (row) { return guestCard(row, label); }).join("");
    var empty = document.getElementById("guests-empty");
    if (empty) empty.classList.toggle("hidden", rows.length > 0);
  }

  function showRoleTabs(which) {
    var tabs = document.getElementById("role-tabs");
    if (tabs) tabs.classList.remove("hidden");
    which.forEach(function (name) {
      var btn = document.getElementById("tab-" + name);
      if (btn) btn.classList.remove("hidden");
    });
  }

  function showSample(demo) {
    var banner = document.getElementById("demo-banner");
    if (banner) {
      banner.innerHTML = '<span class="pill pill-wait">DEMO DATA</span><p><strong>DEMO DATA.</strong> Sample numbers for <strong>' +
        esc((demo.shop && demo.shop.name) || "Anthem Coffee & Tea") + "</strong>, store code " +
        esc((demo.shop && demo.shop.storeCode) || "ANTHEMCO") +
        ". This is not live crawl data. Guests who have not agreed to be contacted are left out.</p>";
      banner.classList.remove("hidden");
    }
    document.querySelectorAll("[data-demo-pill]").forEach(function (el) {
      el.classList.remove("hidden");
    });
    fillShop(demo);
    fillStats(demo);
    fillCoupon(loadCoupon(demo.coupon), true);
    fillGuests(demo);
    showRoleTabs(["guest", "store", "organizer"]);
    var note = document.getElementById("code-note");
    if (note) {
      note.textContent = "DEMO DATA. The live counter code stays ANTHEMCO until the per-crawl code migration runs after today's demo.";
    }
  }

  function openRequestedTab() {
    var want = new URLSearchParams(location.search).get("tab");
    if (want !== "guest" && want !== "store" && want !== "organizer") return;
    var btn = document.getElementById("tab-" + want);
    if (!btn || btn.classList.contains("hidden")) return;
    selectTab(want);
  }

  function selectTab(name) {
    if (name !== "guest" && name !== "store" && name !== "organizer") name = "guest";
    ["guest", "store", "organizer"].forEach(function (tab) {
      var panel = document.getElementById("panel-" + tab);
      var btn = document.getElementById("tab-" + tab);
      var on = tab === name;
      if (panel) {
        panel.classList.toggle("hidden", !on);
        panel.hidden = !on;
      }
      if (btn) btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    var tabs = document.getElementById("role-tabs");
    if (tabs) tabs.classList.remove("hidden");
    var url = new URL(location.href);
    url.searchParams.set("tab", name);
    if (demoRequested()) url.searchParams.set("demo", "1");
    history.replaceState({}, "", url.pathname + "?" + url.searchParams.toString());
  }

  function bind(demo) {
    ["guest", "store", "organizer"].forEach(function (name) {
      var btn = document.getElementById("tab-" + name);
      if (btn) btn.onclick = function () { selectTab(name); };
    });
    var toggle = document.getElementById("coupon-enabled");
    if (toggle) {
      toggle.onchange = async function () {
        var coupon = readFormCoupon();
        var result = await persistCoupon(coupon);
        var err = document.getElementById("coupon-err");
        if (!result.ok) {
          coupon.enabled = toggle.checked !== true;
          rememberCoupon(coupon);
          toggle.checked = coupon.enabled;
          fillCoupon(coupon, demoRequested());
          if (err) { err.textContent = result.message; err.classList.add("show"); }
          if (window.HC) HC.toast(result.message);
          return;
        }
        if (err) { err.textContent = ""; err.classList.remove("show"); }
        fillCoupon(coupon, demoRequested());
      };
    }
    var form = document.getElementById("coupon-form");
    if (form) {
      form.onsubmit = async function (ev) {
        ev.preventDefault();
        var coupon = readFormCoupon();
        if (!coupon.enabled) return;
        var reward = coupon.reward;
        var days = coupon.expiryDays;
        var err = document.getElementById("coupon-err");
        var ok = document.getElementById("coupon-ok");
        if (err) { err.textContent = ""; err.classList.remove("show"); }
        if (ok) { ok.textContent = ""; ok.classList.remove("show"); }
        if (!reward || reward.length > 140) {
          if (err) { err.textContent = "Enter a reward, up to 140 characters."; err.classList.add("show"); }
          return;
        }
        if (!days || days < 1 || days > 365) {
          if (err) { err.textContent = "Expiry needs to be between 1 and 365 days."; err.classList.add("show"); }
          return;
        }
        coupon.reward = reward;
        coupon.expiryDays = Math.round(days);
        coupon.enabled = true;
        rememberCoupon(coupon);
        var result = await persistCoupon(coupon);
        if (!result.ok) {
          if (err) { err.textContent = result.message; err.classList.add("show"); }
          return;
        }
        var shown = demoRequested() ? loadCoupon(demo.coupon) : coupon;
        rememberCoupon(shown);
        fillCoupon(shown, demoRequested());
        if (ok) { ok.textContent = result.message; ok.classList.add("show"); }
        if (window.HC) HC.toast("Reward saved");
      };
    }
    var preview = document.getElementById("btn-preview-guest");
    if (preview) preview.onclick = function () { selectTab("guest"); };
    var csv = document.getElementById("btn-guest-csv");
    if (csv) {
      csv.onclick = function () {
        downloadGuests(demo.guests, currentCode(demo));
        if (window.HC) HC.toast("Guest CSV downloaded");
      };
    }
    var rotate = document.getElementById("btn-rotate-code");
    if (rotate) {
      rotate.onclick = async function () {
        if (demoRequested()) {
          var previewOk = window.confirm("Generate a new preview code? The live counter code ANTHEMCO is not changed. Guests at the shop still use ANTHEMCO until the database update after today's demo.");
          if (!previewOk) return;
          var next = randomStoreCode(8);
          try { localStorage.setItem(CODE_KEY, next); } catch (e) {}
          fillShop(demo);
          var note = document.getElementById("code-note");
          if (note) note.textContent = "DEMO DATA preview code " + next + ". Live code is still ANTHEMCO.";
          if (window.HC) HC.toast("Preview code updated");
          return;
        }
        var noteLive = document.getElementById("code-note");
        if (!window.HCCrawl || !HCCrawl.client) {
          if (noteLive) noteLive.textContent = "Sign in as the store owner to generate a code.";
          return;
        }
        var session = await HCCrawl.getSession();
        if (!session || !session.user || session.user.is_anonymous || !session.user.email) {
          if (noteLive) noteLive.textContent = "Sign in as the store owner to generate a code.";
          return;
        }
        var liveOk = window.confirm("Generate a new counter code for this crawl? Guests will need the new code. The old code stops working once this save succeeds.");
        if (!liveOk) return;
        try {
          var listings = await HCCrawl.client().rpc("shop_my_listings");
          if (listings.error) throw listings.error;
          var row = (listings.data || [])[0];
          if (!row) throw new Error("No listing is linked to this account.");
          var rotated = await HCCrawl.client().rpc("shop_rotate_store_code", { p_listing: row.listing_id });
          if (rotated.error) throw rotated.error;
          var codeEl = document.getElementById("store-code");
          var big = document.getElementById("store-code-big");
          if (codeEl) codeEl.textContent = rotated.data;
          if (big) big.textContent = rotated.data;
          if (noteLive) noteLive.textContent = "New code saved for this crawl. Print a fresh counter sign.";
          if (window.HC) HC.toast("Counter code updated");
        } catch (e) {
          var message = (e && e.message) || "Could not generate a code.";
          if (/shop_rotate_store_code|schema cache|crawl_shop_codes/i.test(message)) {
            message = "New codes save after the database update is applied.";
          }
          if (noteLive) noteLive.textContent = message;
        }
      };
    }
    var printBtn = document.getElementById("btn-print-sign");
    if (printBtn) {
      printBtn.onclick = function () {
        var code = demoRequested() ? currentCode(demo) : ((document.getElementById("store-code-big") || {}).textContent || "");
        var shop = (demo.shop && demo.shop.businessId) || "anthem";
        var href = "/puyallup/coffee-crawl/shop/sign?code=" + encodeURIComponent(code) + "&shop=" + encodeURIComponent(shop);
        if (demoRequested()) href += "&demo=1";
        window.open(href, "_blank", "noopener");
      };
    }
  }

  async function refreshGuest() {
    if (demoRequested()) {
      var demo = fixture();
      if (!demo) return;
      var sample = loadCoupon(demo.coupon);
      rememberCoupon(sample);
      fillCoupon(sample, true);
      return;
    }
    if (!liveShop) {
      var card = document.getElementById("guest-reward");
      if (card) card.classList.add("hidden");
      return;
    }
    fillCoupon(currentCoupon || blankCoupon(), false);
  }

  document.addEventListener("DOMContentLoaded", function () {
    var demo = fixture();
    if (!demo || !document.getElementById("panel-store")) return;
    bind(demo);
    if (demoRequested()) {
      showSample(demo);
      var want = new URLSearchParams(location.search).get("tab");
      if (want !== "guest" && want !== "store" && want !== "organizer") want = "store";
      selectTab(want);
      return;
    }
  });

  window.HCStoreDemo = {
    percent: percent,
    fillStats: fillStats,
    fillLiveStats: fillLiveStats,
    consentedGuests: consentedGuests,
    downloadGuests: downloadGuests,
    refreshGuest: refreshGuest,
    selectTab: selectTab,
    openRequestedTab: openRequestedTab,
    randomStoreCode: randomStoreCode,
    loadCoupon: loadCoupon,
    esc: esc,
    useLiveListing: useLiveListing,
    setLiveShopName: setLiveShopName,
    couponStorageKey: storageKey,
    paintCoupon: fillCoupon
  };
})();
