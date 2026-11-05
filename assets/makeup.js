/* One-time makeup stamp page. The token in ?t= is the secret.
   No sign-in and no device location. */
(function () {
  var PASSPORT_PATH = {
    "puy-coffee": "/puyallup/holiday-coffee-crawl",
    "arl-coffee": "/arlington/holiday-coffee-crawl"
  };

  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function tokenFromSearch(search) {
    var params = new URLSearchParams(search || "");
    var raw = (params.get("t") || "").trim();
    if (!UUID_RE.test(raw)) return "";
    return raw.toLowerCase();
  }

  function passportHref(crawlId) {
    if (crawlId && PASSPORT_PATH[crawlId]) return PASSPORT_PATH[crawlId];
    return "/account";
  }

  function shopLabel(payload) {
    var name = payload && payload.business_name;
    if (!name) return "that shop";
    return String(name);
  }

  function shopsFrom(payload) {
    var rows = payload && Array.isArray(payload.shops) ? payload.shops : [];
    return rows
      .filter(function (shop) { return shop && shop.id && shop.name; })
      .map(function (shop) { return { id: String(shop.id), name: String(shop.name) }; })
      .sort(function (a, b) {
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id);
      });
  }

  function asPayload(data) {
    if (!data) return { status: "invalid" };
    if (typeof data === "string") {
      try { return JSON.parse(data); } catch (e) { return { status: "invalid" }; }
    }
    return data;
  }

  function viewFor(payload) {
    var status = payload && payload.status;
    var crawlName = payload && payload.crawl_name ? String(payload.crawl_name) : "";
    var base = {
      kicker: "Makeup stamp",
      shops: [],
      note: "",
      error: "",
      passportHref: "",
      passportLabel: ""
    };

    if (status === "loading") {
      return Object.assign(base, {
        mode: "loading",
        title: "One stamp, on the house",
        body: "Pulling up the shops on your crawl."
      });
    }

    if (status === "ready") {
      var shops = shopsFrom(payload);
      if (!shops.length) {
        return Object.assign(base, {
          mode: "empty",
          title: "No shops to stamp yet",
          body: crawlName
            ? "Nothing with a map pin is on the " + crawlName + " right now. Reply to the email and we will sort it out."
            : "Nothing with a map pin is on this crawl right now. Reply to the email and we will sort it out."
        });
      }
      var where = crawlName ? " on the " + crawlName : "";
      return Object.assign(base, {
        mode: "ready",
        title: "Pick the shop that missed you",
        body: "Launch day GPS was fussy" + where + ". Tap the shop you were trying to stamp. It lands once, then this link closes.",
        shops: shops,
        note: "One free makeup stamp for this crawl. After it lands, this link will not stamp again."
      });
    }

    if (status === "claimed") {
      return Object.assign(base, {
        mode: "success",
        title: "That stamp is yours",
        body: shopLabel(payload) + " is on your passport. This link is used up, so it will not add another stamp.",
        passportHref: passportHref(payload && payload.crawl_id),
        passportLabel: "See your passport"
      });
    }

    if (status === "used") {
      var named = payload && payload.business_name;
      return Object.assign(base, {
        mode: "used",
        title: named ? "This one is already on your passport" : "This makeup stamp is already used",
        body: named
          ? "Your makeup stamp for " + shopLabel(payload) + " is already there. Each guest gets one free makeup stamp for a crawl, and this link is closed."
          : "Each guest gets one free makeup stamp for a crawl. This link is closed.",
        passportHref: passportHref(payload && payload.crawl_id),
        passportLabel: "See your passport"
      });
    }

    if (status === "expired") {
      return Object.assign(base, {
        mode: "expired",
        title: "This makeup link has expired",
        body: "These links only stay open for a little while. If the stamp still is not on your passport, reply to the email and we will help."
      });
    }

    if (status === "error") {
      return Object.assign(base, {
        mode: "error",
        title: "One stamp, on the house",
        body: "We could not reach the stamp book. Check your connection and try again."
      });
    }

    return Object.assign(base, {
      mode: "invalid",
      title: "We can't open this link",
      body: "Use the makeup link from your email. If it still will not load, reply to that note and we will send a fresh one."
    });
  }

  function nextView(readyPayload, result) {
    var status = result && result.status;
    if (status === "claimed" || status === "used" || status === "expired" || status === "invalid") {
      return viewFor(result);
    }
    if (status === "already_stamped" || status === "not_joined" || status === "invalid_shop") {
      var view = viewFor(readyPayload && readyPayload.status === "ready" ? readyPayload : { status: "error" });
      if (view.mode !== "ready") return viewFor({ status: "error" });
      if (status === "already_stamped") {
        view.error = "You already have that shop on your passport. Tap the stop that did not land.";
      } else if (status === "not_joined") {
        view.error = "This link belongs to a passport on this crawl, and that passport is not joined yet. Join from your crawl email, then open this link again.";
      } else {
        view.error = "That shop is not on this crawl. Pick one of the shops listed here.";
      }
      return view;
    }
    return viewFor({ status: "error" });
  }

  function shopsHtml(shops) {
    return (shops || []).map(function (shop) {
      return '<button type="button" class="btn btn-primary btn-lg makeup-shop" data-business="' +
        esc(shop.id) + '">' + esc(shop.name) + "</button>";
    }).join("");
  }

  function client() {
    var env = window.__HC_ENV__ || {};
    if (!window.supabase || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
    return window.supabase.createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
  }

  function paint(view) {
    var title = document.getElementById("makeup-title");
    if (!title) return;
    document.getElementById("makeup-kicker").textContent = view.kicker;
    title.textContent = view.title;
    document.getElementById("makeup-copy").textContent = view.body;
    var shops = document.getElementById("makeup-shops");
    shops.innerHTML = view.mode === "ready" ? shopsHtml(view.shops) : "";
    var note = document.getElementById("makeup-note");
    note.textContent = view.note || "";
    note.hidden = !view.note;
    var err = document.getElementById("makeup-err");
    err.textContent = view.error || "";
    err.classList.toggle("show", !!view.error);
    var next = document.getElementById("makeup-next");
    if (view.passportHref) {
      next.hidden = false;
      next.innerHTML = '<a class="btn btn-ghost" href="' + esc(view.passportHref) + '">' + esc(view.passportLabel || "See your passport") + "</a>";
    } else {
      next.hidden = true;
      next.innerHTML = "";
    }
  }

  async function rpc(name, args) {
    var sb = client();
    if (!sb) throw new Error("Supabase not loaded");
    var res = await sb.rpc(name, args);
    if (res.error) throw res.error;
    return asPayload(res.data);
  }

  function boot() {
    if (!document.getElementById("makeup-title")) return;
    var token = tokenFromSearch(location.search);
    if (!token) {
      paint(viewFor({ status: "invalid" }));
      return;
    }
    paint(viewFor({ status: "loading" }));
    var readyPayload = null;
    var busy = false;

    rpc("get_makeup_claim", { p_token: token }).then(function (payload) {
      readyPayload = payload;
      paint(viewFor(payload));
    }).catch(function () {
      paint(viewFor({ status: "error" }));
    });

    document.getElementById("makeup-shops").addEventListener("click", function (event) {
      var button = event.target.closest("button[data-business]");
      if (!button || busy) return;
      var business = button.getAttribute("data-business");
      if (!business) return;
      busy = true;
      var buttons = document.querySelectorAll(".makeup-shop");
      for (var i = 0; i < buttons.length; i++) buttons[i].disabled = true;
      rpc("claim_makeup_stamp", { p_token: token, p_business: business }).then(function (result) {
        var view = nextView(readyPayload, result);
        if (view.mode === "ready") busy = false;
        paint(view);
      }).catch(function () {
        busy = false;
        var view = viewFor(readyPayload && readyPayload.status === "ready" ? readyPayload : { status: "error" });
        if (view.mode === "ready") {
          view.error = "We could not reach the stamp book. Check your connection and try that shop again.";
          paint(view);
        } else {
          paint(viewFor({ status: "error" }));
        }
      });
    });
  }

  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("DOMContentLoaded", boot);
  }

  window.HCMakeup = {
    tokenFromSearch: tokenFromSearch,
    passportHref: passportHref,
    viewFor: viewFor,
    nextView: nextView,
    shopsHtml: shopsHtml,
    esc: esc
  };
})();
