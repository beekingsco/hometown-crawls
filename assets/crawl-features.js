/* Organizer feature switches and the guest surfaces they turn on.
   Defaults are off. puy-coffee cannot turn a switch on. */
(function (root) {
  var COMPLETION_LINE = "You're on the completion list.";
  var LOCKED = "puy-coffee";
  var KEYS = ["guest_reviews", "peoples_choice", "completion_badge", "completion_raffle"];
  var DEMO_KEY = "hc-feature-demo";
  var current = { crawlId: "", role: "", demo: false };
  var ticket = 0;
  var bound = false;

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function off() {
    return {
      guest_reviews: false,
      peoples_choice: false,
      completion_badge: false,
      completion_raffle: false
    };
  }

  function flagsFrom(raw, crawlId) {
    var flags = off();
    if (crawlId === LOCKED || !raw || typeof raw !== "object") return flags;
    KEYS.forEach(function (key) {
      flags[key] = raw[key] === true;
    });
    return flags;
  }

  function note(okText, errText) {
    var ok = document.getElementById("org-features-ok");
    var err = document.getElementById("org-features-err");
    if (ok) {
      ok.textContent = okText || "";
      ok.classList.toggle("show", !!okText);
    }
    if (err) {
      err.textContent = errText || "";
      err.classList.toggle("show", !!errText);
    }
  }

  function canWrite(crawlId, role) {
    return crawlId !== LOCKED && (role === "owner" || role === "organizer");
  }

  function readForm() {
    return {
      guest_reviews: !!document.getElementById("feat-guest-reviews").checked,
      peoples_choice: !!document.getElementById("feat-peoples-choice").checked,
      completion_badge: !!document.getElementById("feat-completion-badge").checked,
      completion_raffle: !!document.getElementById("feat-completion-raffle").checked
    };
  }

  function writeForm(flags, enabled) {
    var map = {
      guest_reviews: "feat-guest-reviews",
      peoples_choice: "feat-peoples-choice",
      completion_badge: "feat-completion-badge",
      completion_raffle: "feat-completion-raffle"
    };
    KEYS.forEach(function (key) {
      var box = document.getElementById(map[key]);
      if (!box) return;
      box.checked = flags[key] === true;
      box.disabled = !enabled;
    });
    var save = document.getElementById("org-features-save");
    if (save) save.disabled = !enabled;
  }

  function explain(crawlId, role) {
    var el = document.getElementById("org-features-note");
    if (!el) return;
    if (crawlId === LOCKED) {
      el.textContent = "These stay off for the Puyallup crawl. Paid shop seats only.";
      return;
    }
    if (role !== "owner" && role !== "organizer") {
      el.textContent = "Only an owner or organizer can change these. Paid shop seats only.";
      return;
    }
    el.textContent = "Off until you turn them on. Paid shop seats only. A shop needs a map pin. Paper stamps count the same as phone stamps. Guests who finish the completion list see: " + COMPLETION_LINE;
  }

  function demoAll() {
    try {
      var parsed = JSON.parse(localStorage.getItem(DEMO_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function demoFlags(crawlId) {
    var all = demoAll();
    return flagsFrom(all[crawlId], crawlId);
  }

  function saveDemo(crawlId, flags) {
    var all = demoAll();
    all[crawlId] = flagsFrom(flags, crawlId);
    localStorage.setItem(DEMO_KEY, JSON.stringify(all));
  }

  function client() {
    return window.HCCrawl && HCCrawl.client ? HCCrawl.client() : null;
  }

  function showQueue(flags) {
    var reviews = document.getElementById("org-review-queue");
    var list = document.getElementById("org-completion-list");
    if (reviews) reviews.classList.toggle("hidden", !flags.guest_reviews);
    if (list) list.classList.toggle("hidden", !flags.completion_raffle);
  }

  function paintReviews(rows) {
    var box = document.getElementById("org-review-queue");
    if (!box) return;
    if (!rows.length) {
      box.innerHTML = "<h3>Guest reviews</h3><p class=\"muted small\">No reviews yet. New reviews stay pending until you approve them.</p>";
      return;
    }
    box.innerHTML = "<h3>Guest reviews</h3>" + rows.map(function (row) {
      var pending = row.status === "pending";
      return "<article class=\"record-card\"><b class=\"record-name\">" + esc(row.shop_name || row.business_id) +
        "</b><p class=\"small mt-1\">" + esc(row.body) + "</p><p class=\"small muted mt-1\">" +
        (pending ? "Pending approval" : esc(row.status)) +
        "</p><div class=\"row mt-1\">" +
        "<button class=\"btn btn-soft\" type=\"button\" data-review=\"" + esc(row.id) + "\" data-status=\"approved\">Approve</button>" +
        "<button class=\"btn btn-ghost\" type=\"button\" data-review=\"" + esc(row.id) + "\" data-status=\"hidden\">Hide</button>" +
        "</div></article>";
    }).join("");
  }

  function paintCompletion(rows) {
    var box = document.getElementById("org-completion-list");
    if (!box) return;
    var names = (rows || []).map(function (row) { return esc(row.player_name || "Guest"); });
    box.innerHTML = "<h3>Completion list</h3>" + (names.length
      ? names.map(function (name) { return "<article class=\"record-card\"><b class=\"record-name\">" + name + "</b></article>"; }).join("")
      : "<p class=\"muted small\">No guests have finished yet.</p>");
  }

  async function loadQueues(crawlId, flags) {
    showQueue(flags);
    if (current.demo || !client()) return;
    if (flags.guest_reviews) {
      var reviews = await client().rpc("organizer_shop_reviews", { p_crawl: crawlId });
      if (!reviews.error) paintReviews(reviews.data || []);
    }
    if (flags.completion_raffle) {
      var list = await client().rpc("organizer_completion_list", { p_crawl: crawlId });
      if (!list.error) paintCompletion(list.data || []);
    }
  }

  async function syncOrganizer(opts) {
    if (!document.getElementById("org-features")) return;
    var mine = ++ticket;
    current = {
      crawlId: opts && opts.crawlId || "",
      role: opts && opts.role || "",
      demo: !!(opts && opts.demo)
    };
    explain(current.crawlId, current.role);
    var enabled = canWrite(current.crawlId, current.role);
    writeForm(off(), false);
    var flags = off();
    if (current.demo) {
      flags = demoFlags(current.crawlId);
    } else if (client() && current.crawlId) {
      var res = await client().rpc("public_crawl_features", { p_crawl: current.crawlId });
      if (mine !== ticket) return;
      if (!res.error) flags = flagsFrom(res.data, current.crawlId);
    }
    if (current.crawlId === LOCKED) enabled = false;
    writeForm(current.crawlId === LOCKED ? off() : flags, enabled);
    await loadQueues(current.crawlId, flags);
  }

  function bindOrganizer() {
    if (bound || !document.getElementById("org-features")) return;
    bound = true;
    document.getElementById("org-features").addEventListener("submit", async function (ev) {
      ev.preventDefault();
      note("", "");
      if (!current.crawlId) return;
      if (current.crawlId === LOCKED) {
        writeForm(off(), false);
        note("", "These stay off for the Puyallup crawl.");
        return;
      }
      if (!canWrite(current.crawlId, current.role)) {
        note("", "Only an owner or organizer can change these.");
        return;
      }
      var flags = flagsFrom(readForm(), current.crawlId);
      if (current.demo) {
        saveDemo(current.crawlId, flags);
        writeForm(flags, true);
        note("DEMO DATA. Saved in this browser only.", "");
        showQueue(flags);
        if (flags.guest_reviews) paintReviews([]);
        if (flags.completion_raffle) paintCompletion([]);
        return;
      }
      if (!client()) {
        note("", "Sign in to save features.");
        return;
      }
      var saved = await client().rpc("organizer_set_crawl_features", {
        p_crawl: current.crawlId,
        p_settings: flags
      });
      if (saved.error) {
        note("", saved.error.message || "Could not save features.");
        return;
      }
      flags = flagsFrom(saved.data, current.crawlId);
      writeForm(flags, true);
      note("Features saved.", "");
      await loadQueues(current.crawlId, flags);
    });
    var queue = document.getElementById("org-review-queue");
    if (queue) {
      queue.addEventListener("click", async function (ev) {
        var btn = ev.target.closest && ev.target.closest("[data-review]");
        if (!btn || current.demo || !client()) return;
        var saved = await client().rpc("organizer_set_review_status", {
          p_review: btn.getAttribute("data-review"),
          p_status: btn.getAttribute("data-status")
        });
        if (saved.error) {
          note("", saved.error.message || "Could not update that review.");
          return;
        }
        var flags = readForm();
        await loadQueues(current.crawlId, flags);
      });
    }
  }

  function section(id, title) {
    var el = document.createElement("section");
    el.className = "card mt-2 hidden";
    el.id = id;
    el.hidden = true;
    el.innerHTML = "<h3>" + esc(title) + "</h3><div class=\"feature-body mt-2\"></div>";
    return el;
  }

  function setSection(el, on) {
    if (!el) return;
    el.hidden = !on;
    el.classList.toggle("hidden", !on);
  }

  function stampedShops(shops, stamps) {
    var got = {};
    (stamps || []).forEach(function (row) {
      if (row && row.business_id) got[row.business_id] = true;
    });
    return (shops || []).filter(function (shop) {
      return shop && got[shop.id] && shop.lat != null && shop.lng != null;
    });
  }

  async function mountGuest(opts) {
    var host = opts && opts.root;
    if (!host) return;
    var crawlId = opts.crawlId;
    var shops = opts.shops || [];
    var stamps = opts.stamps || [];
    host.innerHTML = "";
    if (!client() || !crawlId || crawlId === LOCKED) {
      host.hidden = true;
      host.classList.add("hidden");
      return;
    }
    var featureRes = await client().rpc("public_crawl_features", { p_crawl: crawlId });
    var flags = featureRes.error ? off() : flagsFrom(featureRes.data, crawlId);
    if (!flags.guest_reviews && !flags.peoples_choice && !flags.completion_badge && !flags.completion_raffle) {
      host.hidden = true;
      host.classList.add("hidden");
      return;
    }
    host.hidden = false;
    host.classList.remove("hidden");
    var reviews = section("feature-reviews", "Guest reviews");
    var vote = section("feature-vote", "People's choice");
    var badge = section("feature-badge", "Completion badge");
    var list = section("feature-list", "Completion list");
    host.append(reviews, vote, badge, list);
    setSection(reviews, flags.guest_reviews);
    setSection(vote, flags.peoples_choice);
    setSection(badge, flags.completion_badge);
    setSection(list, flags.completion_raffle);

    var session = HCCrawl.getSession ? await HCCrawl.getSession() : null;
    var signedIn = !!(session && session.user && !session.user.is_anonymous && session.user.email);
    var mine = stampedShops(shops, stamps);
    var progress = { stops: 0, stamped: 0, complete: false, show_badge: false, completion_line: null };
    if (flags.completion_badge || flags.completion_raffle) {
      var done = await client().rpc("my_crawl_completion", { p_crawl: crawlId });
      if (!done.error && done.data) progress = done.data;
    }

    if (flags.guest_reviews) {
      var body = reviews.querySelector(".feature-body");
      var approved = await client().rpc("public_shop_reviews", { p_crawl: crawlId });
      var mineReviews = signedIn ? await client().rpc("my_shop_reviews", { p_crawl: crawlId }) : { data: [] };
      var approvedHtml = (!approved.error && approved.data && approved.data.length)
        ? approved.data.map(function (row) {
          return "<article class=\"record-card\"><p>" + esc(row.body) + "</p></article>";
        }).join("")
        : "<p class=\"muted small\">No approved reviews yet.</p>";
      var ownHtml = (!mineReviews.error && mineReviews.data && mineReviews.data.length)
        ? mineReviews.data.map(function (row) {
          var label = row.status === "pending" ? "Pending approval" : row.status === "approved" ? "Approved" : "Hidden";
          return "<p class=\"small mt-1\">" + esc(label) + "</p>";
        }).join("")
        : "";
      var form = "";
      if (signedIn && mine.length) {
        form = "<form id=\"feature-review-form\" class=\"mt-2\"><label class=\"field\"><span>Shop you stamped</span><select class=\"input\" id=\"feature-review-shop\">" +
          mine.map(function (shop) {
            return "<option value=\"" + esc(shop.id) + "\">" + esc(shop.name) + "</option>";
          }).join("") +
          "</select></label><label class=\"field\"><span>Review</span><textarea class=\"input\" id=\"feature-review-body\" maxlength=\"600\" required></textarea></label>" +
          "<button class=\"btn btn-primary\" type=\"submit\">Submit review</button>" +
          "<p class=\"form-success mt-2\" id=\"feature-review-ok\" role=\"status\"></p>" +
          "<p class=\"form-error mt-2\" id=\"feature-review-err\" role=\"alert\"></p></form>";
      } else if (!signedIn) {
        form = "<p class=\"muted small mt-2\">Sign in to review a shop you have stamped.</p>";
      } else {
        form = "<p class=\"muted small mt-2\">Stamp a shop before you review it.</p>";
      }
      body.innerHTML = approvedHtml + ownHtml + form;
      var reviewForm = document.getElementById("feature-review-form");
      if (reviewForm) {
        reviewForm.onsubmit = async function (ev) {
          ev.preventDefault();
          var err = document.getElementById("feature-review-err");
          var ok = document.getElementById("feature-review-ok");
          if (err) { err.textContent = ""; err.classList.remove("show"); }
          if (ok) { ok.textContent = ""; ok.classList.remove("show"); }
          var saved = await client().rpc("submit_shop_review", {
            p_crawl: crawlId,
            p_business: document.getElementById("feature-review-shop").value,
            p_body: document.getElementById("feature-review-body").value.trim()
          });
          if (saved.error) {
            if (err) { err.textContent = saved.error.message || "Could not save that review."; err.classList.add("show"); }
            return;
          }
          if (ok) { ok.textContent = "Pending approval"; ok.classList.add("show"); }
          if (opts.onChange) opts.onChange();
        };
      }
    }

    if (flags.peoples_choice) {
      var voteBody = vote.querySelector(".feature-body");
      var choice = signedIn ? await client().rpc("my_peoples_choice", { p_crawl: crawlId }) : { data: null };
      var tally = await client().rpc("peoples_choice_tally", { p_crawl: crawlId });
      var counts = {};
      if (!tally.error && Array.isArray(tally.data)) {
        tally.data.forEach(function (row) { counts[row.business_id] = Number(row.votes) || 0; });
      }
      if (!mine.length) {
        voteBody.innerHTML = "<p class=\"muted small\">Stamp a shop before you vote.</p>";
      } else if (!signedIn) {
        voteBody.innerHTML = "<p class=\"muted small\">Sign in to vote for a shop you have stamped.</p>";
      } else {
        var selected = choice && !choice.error ? choice.data : "";
        voteBody.innerHTML = "<form id=\"feature-vote-form\">" + mine.map(function (shop) {
          var count = counts[shop.id] || 0;
          return "<label class=\"check\"><input type=\"radio\" name=\"feature-vote\" value=\"" + esc(shop.id) + "\"" +
            (selected === shop.id ? " checked" : "") + "> " + esc(shop.name) +
            " <span class=\"muted small\">" + count + "</span></label>";
        }).join("") +
          "<button class=\"btn btn-primary mt-2\" type=\"submit\">Save vote</button>" +
          "<p class=\"form-success mt-2\" id=\"feature-vote-ok\" role=\"status\"></p>" +
          "<p class=\"form-error mt-2\" id=\"feature-vote-err\" role=\"alert\"></p></form>";
        document.getElementById("feature-vote-form").onsubmit = async function (ev) {
          ev.preventDefault();
          var picked = voteBody.querySelector("input[name=feature-vote]:checked");
          var err = document.getElementById("feature-vote-err");
          var ok = document.getElementById("feature-vote-ok");
          if (err) { err.textContent = ""; err.classList.remove("show"); }
          if (ok) { ok.textContent = ""; ok.classList.remove("show"); }
          if (!picked) {
            if (err) { err.textContent = "Choose a shop you have stamped."; err.classList.add("show"); }
            return;
          }
          var saved = await client().rpc("cast_peoples_choice", {
            p_crawl: crawlId,
            p_business: picked.value
          });
          if (saved.error) {
            if (err) { err.textContent = saved.error.message || "Could not save that vote."; err.classList.add("show"); }
            return;
          }
          if (ok) { ok.textContent = "Vote saved."; ok.classList.add("show"); }
          if (opts.onChange) opts.onChange();
        };
      }
    }

    if (flags.completion_badge) {
      var badgeBody = badge.querySelector(".feature-body");
      if (progress.show_badge === true) {
        badgeBody.innerHTML = "<span class=\"pill pill-ok\">Crawl complete</span>";
      } else {
        badgeBody.innerHTML = "<p class=\"muted small\">" + esc(progress.stamped || 0) + " of " + esc(progress.stops || 0) + " shops stamped.</p>";
      }
    }

    if (flags.completion_raffle && progress.completion_line === COMPLETION_LINE) {
      setSection(list, true);
      list.textContent = COMPLETION_LINE;
    } else {
      setSection(list, false);
    }
  }

  root.HCFeatures = {
    COMPLETION_LINE: COMPLETION_LINE,
    LOCKED: LOCKED,
    flagsFrom: flagsFrom,
    syncOrganizer: syncOrganizer,
    mountGuest: mountGuest
  };

  if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", bindOrganizer);
  }
})(typeof window !== "undefined" ? window : globalThis);
