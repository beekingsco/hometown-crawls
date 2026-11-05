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

  function thanksCopy(names) {
    var list = [];
    (names || []).forEach(function (name) {
      var text = String(name || "").trim();
      if (text) list.push(text);
    });
    var shops = list.length ? list.join(", ") : "those shops";
    return "Thanks! We got your request for " + shops + ". Your organizer will review it soon.";
  }

  function openShops(shops, blockedIds) {
    var blocked = {};
    (blockedIds || []).forEach(function (id) {
      var token = crawlToken(id);
      if (token) blocked[token] = true;
    });
    return (shops || []).filter(function (shop) {
      var id = crawlToken(shop && shop.id);
      return id && !blocked[id];
    });
  }

  function pendingShopIds(rows) {
    var ids = [];
    (rows || []).forEach(function (row) {
      var list = row && (row.business_ids || row.shops);
      (list || []).forEach(function (id) {
        var token = crawlToken(id);
        if (token && ids.indexOf(token) === -1) ids.push(token);
      });
    });
    return ids;
  }

  function shopLabel(shops, id) {
    var token = crawlToken(id);
    var match = (shops || []).filter(function (shop) { return crawlToken(shop && shop.id) === token; })[0];
    return (match && match.name) || token || String(id || "");
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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

  var submitting = false;
  var holdConfirmation = false;

  function show(el, on) {
    if (!el) return;
    if (el.classList && el.classList.toggle) el.classList.toggle("hidden", !on);
    var notice = el.id === "stamp-fix-err" || el.id === "stamp-fix-msg";
    if (!notice && el.classList && el.classList.contains) {
      notice = el.classList.contains("form-error") || el.classList.contains("form-success");
    }
    if (notice && el.classList && el.classList.toggle) el.classList.toggle("show", !!on);
    el.style.display = on ? "block" : "none";
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text || "";
  }

  function showNotice(id, text) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text || "";
    var on = !!text;
    if (el.classList) el.classList.toggle("show", on);
    el.style.display = on ? "block" : "none";
    if (on && window.HCCrawl && HCCrawl.revealNotice) HCCrawl.revealNotice(el);
  }

  async function loadPending(crawlId) {
    if (!window.HCCrawl || !HCCrawl.client) return [];
    var client = HCCrawl.client();
    if (!client) return [];
    var res = await client.rpc("my_stamp_fix_requests", { p_crawl: crawlId });
    if (res && res.error) throw new Error(res.error.message || "Could not load your requests.");
    return (res && res.data) || [];
  }

  async function stampedIds(crawlId) {
    if (!window.HCCrawl || !HCCrawl.myStamps) return [];
    var rows = await HCCrawl.myStamps(crawlId);
    var ids = [];
    (rows || []).forEach(function (row) {
      var token = crawlToken(row && row.business_id);
      if (token && ids.indexOf(token) === -1) ids.push(token);
    });
    return ids;
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
    if (holdConfirmation) return;
    if (window.HCCrawl && HCCrawl.consumeAutoJoin) {
      try { await HCCrawl.consumeAutoJoin(); } catch (e) {}
    }
    var list = await loadShops(crawlId);
    var pending = await loadPending(crawlId);
    var blocked = pendingShopIds(pending).concat(await stampedIds(crawlId));
    var open = openShops(list, blocked);
    var pendingNames = pendingShopIds(pending).map(function (id) { return shopLabel(list, id); });
    var pendingCard = document.getElementById("stamp-fix-pending");
    if (pendingNames.length) {
      setText("stamp-fix-pending-copy", thanksCopy(pendingNames));
      show(pendingCard, true);
    } else {
      setText("stamp-fix-pending-copy", "");
      show(pendingCard, false);
    }
    if (shops) {
      shops.innerHTML = open.map(function (shop) {
        var shopId = crawlToken(shop && shop.id);
        if (!shopId) return "";
        return '<label class="check"><input type="checkbox" name="shop" value="' + esc(shopId) + '"> ' +
          esc(shop.name || shopId) + "</label>";
      }).join("") || '<p class="muted small">No shops left to request on this crawl.</p>';
    }
    show(form, open.length > 0);
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
        showNotice("stamp-fix-err", "");
        if (submitting) return;
        var button = document.getElementById("stamp-fix-submit");
        var picked = selectedShops(form);
        var names = picked.map(function (id) {
          var box = form.querySelector('input[name="shop"][value="' + id + '"]');
          var label = box && box.parentNode ? box.parentNode.textContent : id;
          return String(label || id).trim();
        });
        submitting = true;
        if (button) {
          button.disabled = true;
          button.setAttribute("aria-busy", "true");
          button.textContent = "Sending…";
        }
        try {
          var note = document.getElementById("stamp-fix-note");
          await submit(crawlFromLocation(), picked, note ? note.value.trim() : "");
          holdConfirmation = true;
          setText("stamp-fix-done-copy", thanksCopy(names));
          show(document.getElementById("stamp-fix-done"), true);
          show(form, false);
        } catch (error) {
          showNotice("stamp-fix-err", (error && error.message) || "Could not save that request.");
          if (button) {
            button.disabled = false;
            button.textContent = "Request a stamp fix";
          }
        } finally {
          submitting = false;
          if (button) button.removeAttribute("aria-busy");
        }
      });
    }
    if (crawlId && window.HCCrawl && HCCrawl.rememberStampFixReturn) HCCrawl.rememberStampFixReturn(crawlId);
    paint(crawlId).catch(function (error) {
      showNotice("stamp-fix-err", (error && error.message) || "Could not open this crawl.");
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
    thanksCopy: thanksCopy,
    openShops: openShops,
    pendingShopIds: pendingShopIds,
    loadShops: loadShops,
    submit: submit,
    paint: paint,
    start: start
  };
})();
