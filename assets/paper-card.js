/* Paper-card signup, printable-card links, and organizer manual stamps.
   Demo mode (?demo=1) does not send a magic link or call these RPCs. */
(function () {
  var PENDING = "hc-paper-signup";
  var TURN_IN = "Bring your finished card to a co-organizer shop (e.g. Holiday Cafe, Anthem).";

  function demoOn() {
    return new URLSearchParams(location.search).get("demo") === "1";
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function params() {
    return new URLSearchParams(location.search);
  }

  function crawlId() {
    return params().get("crawl") || "puy-coffee";
  }

  function shopParam() {
    return params().get("shop") || "";
  }

  function paperOn() {
    var box = document.getElementById("play-paper");
    return !!(box && box.checked);
  }

  function phoneDigits(value) {
    var digits = String(value || "").replace(/\D/g, "");
    if (digits.length === 11 && digits.charAt(0) === "1") digits = digits.slice(1);
    return digits;
  }

  function validPhone(value) {
    var digits = phoneDigits(value);
    return digits.length >= 10 && digits.length <= 15;
  }

  function signupError(row) {
    if (!row || !String(row.name || "").trim()) return "Enter your name.";
    if (!String(row.email || "").trim()) return "Enter your email.";
    if (!validPhone(row.phone)) return "Enter a valid phone number.";
    if (!row.contact) return "Check the box to approve contact if you win or receive prizes.";
    if (!row.photo) return "Check the box to approve photo use on the website.";
    if (row.paper && !row.terms) return "Check the box to agree to the official rules.";
    return "";
  }

  function readPending() {
    try {
      var parsed = JSON.parse(sessionStorage.getItem(PENDING) || "null");
      return parsed && parsed.contact === true && parsed.photo === true ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  function writePending(row) {
    sessionStorage.setItem(PENDING, JSON.stringify(row));
  }

  function clearPending() {
    sessionStorage.removeItem(PENDING);
  }

  function matchShop(rows, shop) {
    var key = String(shop || "").trim();
    if (!key) return null;
    return (rows || []).filter(function (row) {
      return row && (row.business_id === key || String(row.listing_id) === key);
    })[0] || null;
  }

  function cardHref(crawl, extra) {
    var query = "crawl=" + encodeURIComponent(crawl || crawlId());
    if (extra) query += "&" + extra;
    return "/card.html?" + query;
  }

  function showBlock(id, on) {
    var el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle("hidden", !on);
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text || "";
  }

  async function publicShops(crawl) {
    var client = window.HCCrawl && HCCrawl.client && HCCrawl.client();
    if (!client) return [];
    var res = await client.rpc("get_public_crawl_shops", { p_crawl: crawl });
    return res.error ? [] : (res.data || []);
  }

  async function paintShopNote() {
    var note = document.getElementById("paper-shop-note");
    if (!note) return;
    var shop = shopParam();
    if (!shop) {
      note.textContent = "";
      return;
    }
    var match = matchShop(await publicShops(crawlId()), shop);
    note.textContent = match ? "This signup is at " + match.display_name + "." : "";
  }

  function showSuccess(mailNote) {
    showBlock("paper-success", true);
    setText("paper-mail-note", mailNote || "");
    var form = document.getElementById("auth-signed-out");
    if (form) form.classList.add("hidden");
  }

  function showRewards(crawl) {
    var link = document.getElementById("paper-download");
    var reprint = document.getElementById("paper-reprint");
    var href = cardHref(crawl || crawlId());
    if (link) link.href = href;
    if (reprint) {
      reprint.href = href;
      reprint.classList.remove("hidden");
    }
    showBlock("paper-rewards", true);
    showBlock("paper-success", true);
  }

  async function turnInCopy(crawl) {
    var client = HCCrawl.client();
    var res = await client.rpc("card_turn_in_shops", { p_crawl: crawl });
    var names = (res.error ? [] : (res.data || [])).map(function (row) { return row.display_name; }).filter(Boolean);
    return TURN_IN + (names.length ? " " + names.join(", ") + "." : "");
  }

  function formSignup() {
    var phone = document.getElementById("auth-phone");
    var terms = document.getElementById("paper-terms");
    var consent = document.getElementById("contact-consent");
    var photo = document.getElementById("photo-promo-consent");
    return {
      name: (document.getElementById("auth-name").value || "").trim(),
      email: (document.getElementById("auth-email").value || "").trim(),
      phone: phone ? phone.value.trim() : "",
      contact: !!(consent && consent.checked),
      photo: !!(photo && photo.checked),
      terms: !!(terms && terms.checked),
      paper: paperOn(),
      shop: shopParam(),
      crawl: crawlId()
    };
  }

  function signupFromLocation() {
    var query = params();
    if (query.get("contact") !== "1" || query.get("photo") !== "1") return null;
    var name = query.get("signup_name") || query.get("card_name") || "";
    var phone = query.get("signup_phone") || "";
    if (!name || !phone) return null;
    return {
      name: name,
      email: query.get("signup_email") || "",
      phone: phone,
      contact: true,
      photo: true,
      terms: query.get("terms") === "1",
      paper: query.get("play") === "paper",
      shop: query.get("shop") || "",
      crawl: query.get("crawl") || "puy-coffee"
    };
  }

  async function submit(ui) {
    var show = ui.show;
    var msg = ui.msg;
    var err = ui.err;
    show(msg, false);
    show(err, false);
    var row = formSignup();
    var problem = signupError(row);
    if (problem) { err.textContent = problem; show(err, true); return; }
    writePending(row);
    try { sessionStorage.setItem("hc-contact-consent", "1"); } catch (e) {}
    var next = new URLSearchParams(location.search);
    next.set("crawl", row.crawl);
    next.set("signup_name", row.name);
    next.set("signup_email", row.email);
    next.set("signup_phone", row.phone);
    next.set("contact", "1");
    next.set("photo", "1");
    if (row.paper) {
      next.set("play", "paper");
      next.set("card_name", row.name);
      next.set("terms", "1");
    } else {
      next.delete("play");
      next.delete("card_name");
      next.delete("terms");
    }
    if (row.shop) next.set("shop", row.shop);
    else next.delete("shop");
    history.replaceState(null, "", location.pathname + "?" + next.toString());
    if (demoOn()) {
      if (row.paper) showSuccess("Demo preview. No email was sent and no account was changed.");
      else { msg.textContent = "Demo preview. No email was sent and no account was changed."; show(msg, true); }
      return;
    }
    var session = await HCCrawl.getSession();
    var same = session && session.user && !session.user.is_anonymous && session.user.email &&
      session.user.email.toLowerCase() === row.email.toLowerCase();
    if (same) {
      await finish();
      if (!row.paper) { msg.textContent = "You're signed in."; show(msg, true); }
      return;
    }
    await HCCrawl.magicLink(row.email);
    if (row.paper) showSuccess("Check your email for the sign-in link. Open it, then choose how to get the card.");
    else { msg.textContent = "Check your email for the magic link."; show(msg, true); }
  }

  async function finish() {
    if (demoOn() || !window.HCCrawl || !HCCrawl.client) return;
    var pending = readPending() || signupFromLocation();
    if (!pending) return;
    var session = await HCCrawl.getSession();
    if (!session || !session.user || session.user.is_anonymous || !session.user.email) return;
    var crawl = pending.crawl || crawlId();
    var name = pending.name || "";
    if (!name || !validPhone(pending.phone) || !pending.contact || !pending.photo) {
      var form = document.getElementById("auth-signed-out");
      if (form) form.classList.remove("hidden");
      return;
    }
    var saved = await HCCrawl.client().rpc("record_guest_signup", {
      p_crawl: crawl,
      p_name: name,
      p_phone: pending.phone,
      p_contact: true,
      p_photo: true,
      p_shop: pending.shop || shopParam(),
      p_paper: !!pending.paper,
      p_terms: !!pending.terms
    });
    if (saved.error) {
      var err = document.getElementById("auth-err");
      if (err) {
        err.textContent = saved.error.message || "Signup did not save.";
        err.classList.add("show");
        err.style.display = "block";
      }
      return;
    }
    clearPending();
    var clean = new URLSearchParams(location.search);
    ["play", "card_name", "signup_name", "signup_email", "signup_phone", "contact", "photo", "terms"].forEach(function (key) {
      clean.delete(key);
    });
    history.replaceState(null, "", location.pathname + (clean.toString() ? "?" + clean.toString() : ""));
    if (pending.paper) {
      showRewards(crawl);
      setText("paper-mail-note", "");
    }
  }

  function bindSignup() {
    var toggle = document.getElementById("play-paper");
    var button = document.getElementById("btn-magic");
    if (params().get("play") === "paper" && toggle) toggle.checked = true;
    function sync() {
      showBlock("paper-fields", paperOn());
      if (button) button.textContent = paperOn() ? "Join with a paper card" : "Send magic link";
    }
    if (toggle) toggle.addEventListener("change", sync);
    sync();
    paintShopNote();
    var next = document.getElementById("paper-next");
    if (next) next.addEventListener("click", function () { showBlock("paper-rewards", true); });
    var ask = document.getElementById("paper-ask");
    if (ask) {
      ask.addEventListener("click", async function () {
        var note = document.getElementById("paper-counter-note");
        if (!note) return;
        note.classList.remove("hidden");
        note.textContent = demoOn() ? TURN_IN : await turnInCopy(crawlId());
      });
    }
  }

  function playerCard(row, crawl, detailId) {
    var article = document.createElement("article");
    article.className = "record-card";
    var name = document.createElement("b");
    name.className = "record-name";
    name.textContent = row.player_name || row.player_email || "Player";
    var email = document.createElement("p");
    email.className = "record-email";
    email.textContent = row.player_email || "";
    var phone = document.createElement("p");
    phone.className = "small";
    phone.textContent = row.player_phone || "No phone";
    var flags = document.createElement("p");
    flags.className = "small muted";
    flags.textContent = "Prize contact: " + (row.contact_consent ? "approved" : "not approved")
      + " · Photo promo: " + (row.photo_promo_consent ? "approved" : "not approved");
    var mode = document.createElement("span");
    mode.className = "chip";
    mode.textContent = row.play_mode === "paper" ? "Paper" : "Digital";
    var count = document.createElement("p");
    count.className = "small muted";
    count.textContent = String(row.stamp_count || 0) + " stamps";
    var open = document.createElement("button");
    open.type = "button";
    open.className = "btn btn-soft";
    open.textContent = "Open player";
    open.addEventListener("click", function () { openPlayer(crawl, row, detailId); });
    article.append(name, email, phone, flags, mode, count, open);
    return article;
  }

  async function openPlayer(crawl, row, detailId) {
    var detail = document.getElementById(detailId || "player-detail");
    if (!detail) return;
    detail.classList.remove("hidden");
    detail.replaceChildren();
    var heading = document.createElement("h3");
    heading.textContent = row.player_name || row.player_email || "Player";
    var print = document.createElement("a");
    print.className = "btn btn-ghost";
    print.href = cardHref(crawl, "user=" + encodeURIComponent(row.user_id));
    print.textContent = "Print this card";
    detail.append(heading, print);
    var res = await HCCrawl.client().rpc("organizer_player_shops", { p_crawl: crawl, p_user: row.user_id });
    if (res.error) {
      var problem = document.createElement("p");
      problem.className = "form-error show";
      problem.textContent = res.error.message || "Could not load shops.";
      detail.append(problem);
      return;
    }
    (res.data || []).forEach(function (shop) {
      var label = document.createElement("label");
      label.className = "check";
      var box = document.createElement("input");
      box.type = "checkbox";
      box.checked = shop.stamp_source === "digital" || shop.stamp_source === "manual";
      box.disabled = shop.stamp_source === "digital";
      var caption = document.createElement("span");
      var status = shop.stamp_source === "digital" ? "Digital stamp" : shop.stamp_source === "manual" ? "Manual stamp" : "Not stamped";
      caption.textContent = shop.display_name + " · " + status;
      box.addEventListener("change", async function () {
        if (demoOn()) { box.checked = !box.checked; return; }
        var saved = await HCCrawl.client().rpc("organizer_set_manual_stamp", {
          p_crawl: crawl,
          p_user: row.user_id,
          p_business: shop.business_id,
          p_on: box.checked
        });
        if (saved.error) {
          box.checked = !box.checked;
          caption.textContent = shop.display_name + " · " + (saved.error.message || "Could not update");
          return;
        }
        var next = saved.data === "manual" ? "Manual stamp" : saved.data === "digital" ? "Digital stamp" : "Not stamped";
        caption.textContent = shop.display_name + " · " + next;
        box.disabled = saved.data === "digital";
      });
      label.append(box, caption);
      detail.append(label);
    });
  }

  function bindPlayerSearch(ids, crawlFn) {
    var form = document.getElementById(ids.form);
    if (!form) return;
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      var err = document.getElementById(ids.err);
      var results = document.getElementById(ids.results);
      if (err) { err.textContent = ""; err.classList.remove("show"); }
      var query = (document.getElementById(ids.query).value || "").trim();
      if (query.length < 2) {
        if (err) { err.textContent = "Enter at least 2 characters."; err.classList.add("show"); }
        return;
      }
      if (demoOn()) {
        if (err) { err.textContent = "Demo mode does not search live players."; err.classList.add("show"); }
        return;
      }
      var crawl = crawlFn();
      var res = await HCCrawl.client().rpc("organizer_search_players", { p_crawl: crawl, p_query: query });
      if (res.error) {
        if (err) { err.textContent = res.error.message || "Could not search players."; err.classList.add("show"); }
        return;
      }
      if (results) {
        results.replaceChildren();
        var rows = res.data || [];
        if (!rows.length) {
          var empty = document.createElement("p");
          empty.className = "muted small";
          empty.textContent = "No players matched.";
          results.append(empty);
          return;
        }
        rows.forEach(function (row) { results.append(playerCard(row, crawl, ids.detail)); });
      }
    });
  }

  function bindOrganizer() {
    var picker = document.getElementById("org-crawl");
    var print = document.getElementById("org-print-card");
    function crawl() {
      return (picker && picker.value) || crawlId();
    }
    function syncPrint() {
      if (print) print.href = cardHref(crawl(), "blank=1");
    }
    if (picker) picker.addEventListener("change", syncPrint);
    syncPrint();
    bindPlayerSearch({
      form: "player-search",
      query: "player-query",
      err: "player-err",
      results: "player-results",
      detail: "player-detail"
    }, crawl);
    bindPlayerSearch({
      form: "store-player-search",
      query: "store-player-query",
      err: "store-player-err",
      results: "store-player-results",
      detail: "store-player-detail"
    }, crawlId);
  }

  document.addEventListener("DOMContentLoaded", function () {
    bindSignup();
    bindOrganizer();
  });

  window.HCPaper = {
    TURN_IN: TURN_IN,
    paperOn: paperOn,
    matchShop: matchShop,
    validPhone: validPhone,
    signupError: signupError,
    submit: submit,
    finish: finish,
    cardHref: cardHref
  };
})();
