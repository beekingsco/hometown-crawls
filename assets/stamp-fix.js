/* Guest stamp-fix requests for the crawl in ?crawl=. No default crawl. */
(function () {
  var PAGES = {
    "puy-coffee": "/puyallup/holiday-coffee-crawl",
    "arl-coffee": "/arlington/holiday-coffee-crawl"
  };

  function crawlToken(value) {
    var id = String(value == null ? "" : value).trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id)) return "";
    return id;
  }

  function crawlFromLocation() {
    try {
      return crawlToken(new URLSearchParams(location.search).get("crawl"));
    } catch (e) {
      return "";
    }
  }

  function crawlHref(id) {
    return PAGES[id] || "";
  }

  function emailSession(session) {
    return !!(session && session.user && !session.user.is_anonymous && session.user.email);
  }

  function selectedShops(root) {
    if (!root || !root.querySelectorAll) return [];
    return Array.prototype.map.call(root.querySelectorAll('input[name="shop"]:checked'), function (box) {
      return box.value;
    }).filter(Boolean);
  }

  async function loadShops(crawlId) {
    var id = crawlToken(crawlId);
    if (!id || !window.HCCrawl || !HCCrawl.loadShops) return [];
    var res = await HCCrawl.loadShops(id);
    return (res && res.shops) || [];
  }

  async function submit(crawlId, businessIds, note) {
    var id = crawlToken(crawlId);
    if (!id) throw new Error("Open the stamp fix link from your crawl.");
    if (!window.HCCrawl || !HCCrawl.client) throw new Error("Supabase not loaded");
    var session = await HCCrawl.getSession();
    if (!emailSession(session)) throw new Error("Sign in with email to request a stamp fix.");
    var joins = await HCCrawl.myJoins();
    var joined = (joins || []).some(function (row) { return row && row.crawl_id === id; });
    if (!joined) throw new Error("Join this crawl before requesting a stamp fix.");
    var shops = (businessIds || []).map(crawlToken).filter(Boolean);
    if (!shops.length) throw new Error("Pick at least one shop.");
    var saved = await HCCrawl.client().rpc("request_stamp_fix", {
      p_crawl: id,
      p_businesses: shops,
      p_note: note || ""
    });
    if (saved.error) throw new Error(saved.error.message || "Could not save that request.");
    return saved.data;
  }

  function show(el, on) {
    if (!el) return;
    el.classList.toggle("hidden", !on);
    el.style.display = on ? "block" : "none";
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text || "";
  }

  async function paint(crawlId) {
    var form = document.getElementById("stamp-fix-form");
    var auth = document.getElementById("stamp-fix-auth");
    var shops = document.getElementById("stamp-fix-shops");
    var join = document.getElementById("stamp-fix-join");
    setText("stamp-fix-err", "");
    if (!crawlId) {
      setText("stamp-fix-status", "Open the stamp fix link from your crawl. This page will not pick one for you.");
      show(form, false);
      show(auth, false);
      show(join, false);
      return;
    }
    setText("stamp-fix-status", "Request a fix for " + crawlId + ".");
    var session = window.HCCrawl && HCCrawl.getSession ? await HCCrawl.getSession() : null;
    if (!emailSession(session)) {
      show(auth, true);
      show(form, false);
      show(join, false);
      return;
    }
    show(auth, false);
    show(join, false);
    if (window.HCCrawl && HCCrawl.consumeAutoJoin) {
      try { await HCCrawl.consumeAutoJoin(); } catch (e) {}
    }
    var list = await loadShops(crawlId);
    if (shops) {
      shops.innerHTML = list.map(function (shop) {
        var shopId = crawlToken(shop && shop.id);
        if (!shopId) return "";
        return '<label class="check"><input type="checkbox" name="shop" value="' + shopId + '"> ' +
          String(shop.name || shopId).replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</label>";
      }).join("") || '<p class="muted small">No shops are on this crawl yet.</p>';
    }
    show(form, true);
  }

  function start() {
    var crawlId = crawlFromLocation();
    var form = document.getElementById("stamp-fix-form");
    var send = document.getElementById("stamp-fix-send");
    if (send) {
      send.addEventListener("click", async function () {
        setText("stamp-fix-err", "");
        setText("stamp-fix-msg", "");
        var email = document.getElementById("stamp-fix-email");
        var crawlId = crawlFromLocation();
        send.disabled = true;
        try {
          if (HCCrawl.rememberStampFixReturn) HCCrawl.rememberStampFixReturn(crawlId);
          await HCCrawl.magicLink((email && email.value || "").trim(), crawlId);
          setText("stamp-fix-msg", "Check your email for the sign-in link. It brings you back to this page.");
        } catch (error) {
          setText("stamp-fix-err", (error && error.message) || "Could not send the sign-in link.");
        } finally {
          send.disabled = false;
        }
      });
    }
    if (form) {
      form.addEventListener("submit", async function (ev) {
        ev.preventDefault();
        setText("stamp-fix-err", "");
        setText("stamp-fix-msg", "");
        var button = document.getElementById("stamp-fix-submit");
        if (button) button.disabled = true;
        try {
          await submit(crawlFromLocation(), selectedShops(form), (document.getElementById("stamp-fix-note").value || "").trim());
          setText("stamp-fix-msg", "Request saved. An organizer for this crawl can add those stamps.");
          form.reset();
        } catch (error) {
          setText("stamp-fix-err", (error && error.message) || "Could not save that request.");
        } finally {
          if (button) button.disabled = false;
        }
      });
    }
    if (crawlId && window.HCCrawl && HCCrawl.rememberStampFixReturn) HCCrawl.rememberStampFixReturn(crawlId);
    paint(crawlId).catch(function (error) {
      setText("stamp-fix-err", (error && error.message) || "Could not open this crawl.");
    });
    if (window.HCCrawl && HCCrawl.watchSession) {
      HCCrawl.watchSession(function () {
        paint(crawlFromLocation()).catch(function () {});
      });
    }
  }

  window.HCStampFix = {
    crawlFromLocation: crawlFromLocation,
    crawlHref: crawlHref,
    selectedShops: selectedShops,
    loadShops: loadShops,
    submit: submit,
    paint: paint,
    start: start
  };
})();
