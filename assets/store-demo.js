/* Store tab: event stats, post-stamp coupon, consented guest export.
   Live totals need a database function that is not required for the demo.
   ?demo=1, or an empty live result, shows DEMO_STORE from assets/config.js. */
(function () {
  var COUPON_KEY = "hc-coupon-anthemco";

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

  function loadCoupon(base) {
    var coupon = {
      reward: (base && base.reward) || "",
      expiryDays: (base && base.expiryDays) || 30,
      issued: base && base.issued != null ? base.issued : 0,
      redeemed: base && base.redeemed != null ? base.redeemed : 0
    };
    try {
      var saved = JSON.parse(localStorage.getItem(COUPON_KEY) || "null");
      if (saved && typeof saved.reward === "string" && saved.reward.trim()) {
        coupon.reward = saved.reward.trim();
        var days = Number(saved.expiryDays);
        if (days >= 1 && days <= 365) coupon.expiryDays = Math.round(days);
      }
    } catch (e) {}
    return coupon;
  }

  function saveCoupon(reward, expiryDays) {
    var payload = { reward: String(reward || "").trim(), expiryDays: Number(expiryDays) };
    localStorage.setItem(COUPON_KEY, JSON.stringify(payload));
    return payload;
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
        csvCell("DEMO DATA")
      ].join(","));
    });
    var blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    var day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    a.href = URL.createObjectURL(blob);
    a.download = (storeCode || "shop") + "-guests-" + day + ".csv";
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

  function fillShop(demo) {
    var shop = demo.shop || {};
    var name = document.getElementById("store-name");
    var code = document.getElementById("store-code");
    var crawl = document.getElementById("store-crawl");
    if (name) name.textContent = shop.name || "Your shop";
    if (code) code.textContent = shop.storeCode || "";
    if (crawl) crawl.textContent = shop.crawlName || "";
  }

  function fillCoupon(coupon, sample) {
    var reward = document.getElementById("coupon-reward");
    var days = document.getElementById("coupon-days");
    var issued = document.getElementById("coupon-issued");
    var redeemed = document.getElementById("coupon-redeemed");
    if (reward && document.activeElement !== reward) reward.value = coupon.reward;
    if (days && document.activeElement !== days) days.value = String(coupon.expiryDays);
    if (issued) issued.textContent = String(coupon.issued);
    if (redeemed) redeemed.textContent = String(coupon.redeemed);
    var guestText = document.getElementById("guest-reward-text");
    var guestMeta = document.getElementById("guest-reward-meta");
    var guestNote = document.getElementById("guest-reward-note");
    var guestCard = document.getElementById("guest-reward");
    var shop = (fixture() && fixture().shop) || {};
    if (guestText) guestText.textContent = coupon.reward;
    if (guestMeta) {
      guestMeta.textContent = shop.name + " · " + shop.storeCode + " · show within " + coupon.expiryDays + " days of your stamp";
    }
    if (guestNote) {
      guestNote.textContent = sample
        ? "DEMO DATA. This is the card a guest sees after they stamp this shop."
        : "Unlocked because you stamped this shop.";
    }
    if (guestCard) guestCard.classList.toggle("hidden", !coupon.reward);
  }

  function fillGuests(demo) {
    var body = document.getElementById("guest-rows");
    if (!body) return;
    var rows = consentedGuests(demo.guests);
    var label = demo.label || "DEMO DATA";
    body.innerHTML = rows.map(function (row) {
      return "<tr><td><b>" + esc(row.name) + '</b> <span class="pill pill-wait">' + esc(label) + "</span></td><td>" +
        esc(row.email) + "</td><td>" + esc(row.crawlsJoined) + "</td><td>" + esc(row.stamps) + "</td><td>" +
        esc(fmtWhen(row.consentedAt)) + "</td></tr>";
    }).join("");
    var empty = document.getElementById("guests-empty");
    if (empty) empty.classList.toggle("hidden", rows.length > 0);
  }

  function showSample(demo) {
    var banner = document.getElementById("demo-banner");
    if (banner) banner.classList.remove("hidden");
    document.querySelectorAll("[data-demo-pill]").forEach(function (el) {
      el.classList.remove("hidden");
    });
    fillShop(demo);
    fillStats(demo);
    fillCoupon(loadCoupon(demo.coupon), true);
    fillGuests(demo);
    var tabs = document.getElementById("role-tabs");
    var storeTab = document.getElementById("tab-store");
    if (tabs) tabs.classList.remove("hidden");
    if (storeTab) storeTab.classList.remove("hidden");
  }

  function selectTab(name) {
    var store = name === "store";
    var guestPanel = document.getElementById("panel-guest");
    var storePanel = document.getElementById("panel-store");
    var guestTab = document.getElementById("tab-guest");
    var storeTab = document.getElementById("tab-store");
    if (!guestPanel || !storePanel) return;
    guestPanel.classList.toggle("hidden", store);
    guestPanel.hidden = store;
    storePanel.classList.toggle("hidden", !store);
    storePanel.hidden = !store;
    if (guestTab) guestTab.setAttribute("aria-selected", store ? "false" : "true");
    if (storeTab) {
      storeTab.classList.remove("hidden");
      storeTab.setAttribute("aria-selected", store ? "true" : "false");
    }
    var tabs = document.getElementById("role-tabs");
    if (tabs) tabs.classList.remove("hidden");
    var url = new URL(location.href);
    url.searchParams.set("tab", store ? "store" : "guest");
    if (demoRequested()) url.searchParams.set("demo", "1");
    history.replaceState({}, "", url.pathname + "?" + url.searchParams.toString());
  }

  function bind(demo) {
    var guestTab = document.getElementById("tab-guest");
    var storeTab = document.getElementById("tab-store");
    if (guestTab) guestTab.onclick = function () { selectTab("guest"); };
    if (storeTab) storeTab.onclick = function () { selectTab("store"); };
    var form = document.getElementById("coupon-form");
    if (form) {
      form.onsubmit = function (ev) {
        ev.preventDefault();
        var reward = document.getElementById("coupon-reward").value.trim();
        var days = Number(document.getElementById("coupon-days").value);
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
        saveCoupon(reward, days);
        var coupon = loadCoupon(demo.coupon);
        coupon.reward = reward;
        coupon.expiryDays = Math.round(days);
        fillCoupon(coupon, true);
        if (ok) { ok.textContent = "Reward saved on this browser. Open the Guest tab to see the unlocked card."; ok.classList.add("show"); }
        if (window.HC) HC.toast("Reward saved");
      };
    }
    var preview = document.getElementById("btn-preview-guest");
    if (preview) preview.onclick = function () { selectTab("guest"); };
    var csv = document.getElementById("btn-guest-csv");
    if (csv) {
      csv.onclick = function () {
        downloadGuests(demo.guests, demo.shop && demo.shop.storeCode);
        if (window.HC) HC.toast("Guest CSV downloaded");
      };
    }
  }

  async function guestHasShopStamp(businessId, crawlId) {
    if (!window.HCCrawl || !businessId) return false;
    try {
      var session = await HCCrawl.getSession();
      if (!session) return false;
      var stamps = await HCCrawl.myStamps(crawlId || "puy-coffee");
      return (stamps || []).some(function (stamp) { return stamp.business_id === businessId; });
    } catch (e) {
      return false;
    }
  }

  async function refreshGuest() {
    var demo = fixture();
    if (!demo) return;
    var card = document.getElementById("guest-reward");
    if (!card) return;
    if (demoRequested()) {
      fillCoupon(loadCoupon(demo.coupon), true);
      card.classList.remove("hidden");
      return;
    }
    var stamped = await guestHasShopStamp(demo.shop.businessId, demo.shop.crawlId);
    if (!stamped) {
      card.classList.add("hidden");
      return;
    }
    fillCoupon(loadCoupon(demo.coupon), false);
    card.classList.remove("hidden");
  }

  document.addEventListener("DOMContentLoaded", function () {
    var demo = fixture();
    if (!demo || !document.getElementById("panel-store")) return;
    bind(demo);
    if (demoRequested()) {
      showSample(demo);
      var want = new URLSearchParams(location.search).get("tab");
      selectTab(want === "guest" ? "guest" : "store");
      return;
    }
    refreshGuest();
  });

  window.HCStoreDemo = {
    percent: percent,
    consentedGuests: consentedGuests,
    downloadGuests: downloadGuests,
    refreshGuest: refreshGuest,
    selectTab: selectTab
  };
})();
