/* Organizer tab. Demo mode shows Bryan's crawls with labeled sample data.
   Invite links are created locally in the demo and are not emailed. */
(function () {
  var KEY = "hc-organizer-demo";
  var onDrawSubmit = function () {};
  var drawingView = { crawlId: "", title: "", winners: [], demo: false, canDraw: false };

  var DEMO_POOLS = {
    "puy-coffee": [
      { userId: "puy-maya", name: "Maya Chen", email: "maya.chen@example.com", stamps: 3 },
      { userId: "puy-sam", name: "Sam Ortiz", email: "sam.ortiz@example.com", stamps: 0 },
      { userId: "puy-priya", name: "Priya Shah", email: "priya.shah@example.com", stamps: 2 },
      { userId: "puy-jordan", name: "Jordan Lee", email: "jordan.lee@example.com", stamps: 1 },
      { userId: "puy-avery", name: "Avery Brooks", email: "avery.brooks@example.com", stamps: 0 },
      { userId: "puy-noah", name: "Noah Patel", email: "noah.patel@example.com", stamps: 4 }
    ],
    "puy-summer-demo": [
      { userId: "summer-riley", name: "Riley Kim", email: "riley.kim@example.com", stamps: 1 },
      { userId: "summer-quinn", name: "Quinn Alvarez", email: "quinn.alvarez@example.com", stamps: 0 },
      { userId: "summer-harper", name: "Harper Diaz", email: "harper.diaz@example.com", stamps: 2 }
    ]
  };

  var DEMO_SEED = {
    "puy-coffee": [
      {
        userId: "puy-maya",
        displayName: "Maya Chen",
        email: "maya.chen@example.com",
        label: "Week 1",
        entryCount: 4,
        drawnAt: "2026-11-02T18:00:00.000Z"
      }
    ]
  };

  function canDraw(role) {
    return role === "owner" || role === "organizer" || role === "co-organizer";
  }

  function personId(row) {
    return String((row && (row.userId || row.user_id)) || "");
  }

  function storedEntryCount(row) {
    if (!row) return null;
    var raw = row.entryCount != null ? row.entryCount : row.entry_count;
    if (raw == null || raw === "") return null;
    var count = Number(raw);
    if (!Number.isFinite(count) || count < 1) return null;
    return Math.floor(count);
  }

  function entryCountOf(row) {
    var stored = storedEntryCount(row);
    if (stored != null) return stored;
    if (row && row.stamps != null && row.stamps !== "") {
      var stamps = Number(row.stamps);
      if (Number.isFinite(stamps) && stamps >= 0) return 1 + Math.floor(stamps);
    }
    return 1;
  }

  function entryPhrase(count) {
    if (count == null || !Number.isFinite(Number(count))) return "";
    var n = Math.floor(Number(count));
    if (n < 1) return "";
    return n === 1 ? "1 entry" : n + " entries";
  }

  function winnerLabel(row) {
    var name = String((row && (row.displayName || row.display_name || row.name || row.email)) || "Guest");
    var phrase = entryPhrase(storedEntryCount(row));
    return phrase ? name + " (" + phrase + ")" : name;
  }

  function cloneWinner(row) {
    return {
      userId: personId(row),
      displayName: String((row && (row.displayName || row.display_name || row.name)) || "Guest"),
      email: String((row && row.email) || ""),
      label: String((row && row.label) || ""),
      entryCount: storedEntryCount(row),
      drawnAt: String((row && (row.drawnAt || row.drawn_at)) || "")
    };
  }

  function seedDrawings() {
    var drawings = {};
    Object.keys(DEMO_POOLS).forEach(function (id) {
      drawings[id] = (DEMO_SEED[id] || []).map(cloneWinner);
    });
    return drawings;
  }

  function eligibleCount(people, winners) {
    var taken = {};
    (winners || []).forEach(function (row) { taken[personId(row)] = true; });
    return (people || []).filter(function (row) { return personId(row) && !taken[personId(row)]; }).length;
  }

  function eligibleEntries(people, winners) {
    var taken = {};
    (winners || []).forEach(function (row) { taken[personId(row)] = true; });
    return (people || []).reduce(function (sum, row) {
      if (!personId(row) || taken[personId(row)]) return sum;
      return sum + entryCountOf(row);
    }, 0);
  }

  function pickFromPool(people, already, count, random) {
    var taken = {};
    (already || []).forEach(function (row) { taken[personId(row)] = true; });
    var rand = typeof random === "function" ? random : Math.random;
    var seen = {};
    var pool = (people || []).filter(function (row) {
      var id = personId(row);
      if (!id || taken[id] || seen[id]) return false;
      seen[id] = true;
      return true;
    }).map(function (row) {
      var weight = entryCountOf(row);
      var unit = Number(rand());
      if (!Number.isFinite(unit) || unit <= 0) unit = 1e-12;
      if (unit >= 1) unit = 1 - 1e-12;
      return {
        userId: personId(row),
        displayName: String(row.displayName || row.name || row.display_name || "Guest"),
        email: String(row.email || ""),
        entryCount: weight,
        drawKey: -Math.log(unit) / weight
      };
    });
    pool.sort(function (a, b) {
      return a.drawKey - b.drawKey || String(a.userId).localeCompare(String(b.userId));
    });
    var n = count | 0;
    if (n < 0) n = 0;
    if (n > pool.length) n = pool.length;
    return pool.slice(0, n).map(function (row) {
      return {
        userId: row.userId,
        displayName: row.displayName,
        email: row.email,
        entryCount: row.entryCount
      };
    });
  }

  function groupWinners(winners) {
    var groups = [];
    var byLabel = {};
    (winners || []).slice().sort(function (a, b) {
      return String(b.drawnAt).localeCompare(String(a.drawnAt)) || String(a.displayName).localeCompare(String(b.displayName));
    }).forEach(function (row) {
      var label = row.label ? String(row.label) : "No label";
      if (!byLabel[label]) {
        byLabel[label] = { label: label, rows: [] };
        groups.push(byLabel[label]);
      }
      byLabel[label].rows.push(row);
    });
    return groups;
  }

  function poolSentence(joined, eligible, entries) {
    var people = Number(joined) || 0;
    var left = Number(eligible) || 0;
    var tickets = entries == null || entries === "" ? null : Number(entries);
    if (!Number.isFinite(tickets)) tickets = null;
    if (!people) return "Nobody has joined this crawl yet. The pool fills in as people join.";
    var joinedText = people === 1 ? "1 person has joined this crawl." : people + " people have joined this crawl.";
    if (!left) return joinedText + " Everyone in the pool has already won.";
    var peopleLeft = left === 1 ? "1 person is still in the drawing" : left + " people are still in the drawing";
    if (tickets == null) return joinedText + " " + peopleLeft + ".";
    var ticketText = tickets === 0 ? "0 entries" : entryPhrase(tickets);
    return joinedText + " " + peopleLeft + ", with " + ticketText + ".";
  }

  function csvCell(value) {
    return '"' + String(value == null ? "" : value).replace(/"/g, '""') + '"';
  }

  function winnersCsv(crawlId, winners) {
    var lines = ["crawl_id,label,name,email,entries,drawn_at"];
    (winners || []).forEach(function (row) {
      lines.push([
        crawlId,
        row.label,
        row.displayName,
        row.email,
        row.entryCount == null ? "" : row.entryCount,
        row.drawnAt
      ].map(csvCell).join(","));
    });
    return lines.join("\n");
  }

  function winnersText(title, crawlId, winners) {
    var lines = [title || "Crawl", crawlId || ""];
    groupWinners(winners).forEach(function (group) {
      lines.push("");
      lines.push(group.label);
      group.rows.forEach(function (row) {
        lines.push(row.displayName);
        lines.push(row.email);
        var phrase = entryPhrase(row.entryCount);
        if (phrase) lines.push(phrase);
      });
    });
    return lines.join("\n");
  }

  function formatWhen(value) {
    var date = new Date(value);
    if (isNaN(date.getTime())) return "";
    try {
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "America/Los_Angeles"
      });
    } catch (e) {
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    }
  }

  function setDrawingMessage(id, text) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("show", !!text);
  }

  function readCount() {
    var el = document.getElementById("drawing-count");
    var n = el ? Number(el.value) : 1;
    if (!Number.isInteger(n) || n < 1 || n > 25) return 0;
    return n;
  }

  function readLabel() {
    var el = document.getElementById("drawing-label");
    return el ? el.value.trim().slice(0, 80) : "";
  }

  function plainDrawingError(error) {
    var message = (error && error.message) || "Could not run the drawing.";
    if (/organizer_draw_winners|organizer_drawing_status|schema cache|could not find the function/i.test(message)) {
      return "The weekly drawing is not on this server yet. The database update still needs to be applied.";
    }
    return String(message).replace(/^ERROR:\s*/i, "");
  }

  function paintDrawing(view) {
    var next = view || {};
    var changed = drawingView.crawlId && next.crawlId && drawingView.crawlId !== next.crawlId;
    drawingView = {
      crawlId: next.crawlId || "",
      title: next.title || "",
      winners: (next.winners || []).map(cloneWinner),
      demo: !!next.demo,
      canDraw: next.canDraw !== false && !next.locked,
      participantCount: next.participantCount,
      eligibleCount: next.eligibleCount,
      entryCount: next.entryCount
    };
    var pool = document.getElementById("drawing-pool");
    var history = document.getElementById("drawing-history");
    var form = document.getElementById("drawing-form");
    var locked = document.getElementById("drawing-locked");
    var banner = document.getElementById("drawing-demo");
    var note = document.getElementById("drawing-history-note");
    if (changed) {
      setDrawingMessage("drawing-ok", "");
      setDrawingMessage("drawing-err", "");
    }
    if (banner) {
      banner.classList.toggle("hidden", !drawingView.demo);
      banner.textContent = drawingView.demo
        ? "DEMO DATA. Sample names for this crawl only. Drawing here does not change the live pool."
        : "";
    }
    if (form) {
      var showForm = !!drawingView.canDraw;
      form.classList.toggle("hidden", !showForm);
      form.hidden = !showForm;
    }
    if (locked) {
      locked.textContent = next.locked || "";
      locked.classList.toggle("show", !!next.locked);
    }
    if (pool) {
      if (next.loading) pool.textContent = "Counting everyone who joined this crawl.";
      else if (next.locked) pool.textContent = "The pool and the winner list stay with the owner and organizers of this crawl.";
      else if (next.poolText) pool.textContent = next.poolText;
      else pool.textContent = poolSentence(drawingView.participantCount, drawingView.eligibleCount, drawingView.entryCount);
    }
    if (note) {
      note.textContent = drawingView.winners.length
        ? "Grouped by the label from each draw."
        : "Winners show up here after a draw, with the label you gave that week.";
    }
    if (history) {
      history.replaceChildren();
      if (!drawingView.winners.length) {
        var empty = document.createElement("p");
        empty.className = "muted small";
        empty.textContent = next.loading ? "Loading past winners." : "No winners yet for this crawl.";
        history.append(empty);
      } else {
        groupWinners(drawingView.winners).forEach(function (group) {
          var block = document.createElement("section");
          block.className = "stack";
          var heading = document.createElement("p");
          heading.className = "eyebrow";
          heading.textContent = group.label;
          block.append(heading);
          group.rows.forEach(function (row) {
            var article = document.createElement("article");
            article.className = "record-card";
            var name = document.createElement("b");
            name.textContent = row.displayName || "Guest";
            var email = document.createElement("p");
            email.className = "small";
            email.style.overflowWrap = "anywhere";
            email.textContent = row.email || "No email on the account";
            var when = document.createElement("p");
            when.className = "muted small";
            var drawn = formatWhen(row.drawnAt);
            var phrase = entryPhrase(row.entryCount);
            if (phrase && drawn) when.textContent = phrase + ". Drawn " + drawn;
            else if (phrase) when.textContent = phrase;
            else when.textContent = drawn ? "Drawn " + drawn : "Drawn";
            article.append(name, email, when);
            block.append(article);
          });
          history.append(block);
        });
      }
    }
    ["drawing-copy", "drawing-csv"].forEach(function (id) {
      var button = document.getElementById(id);
      if (button) button.disabled = !drawingView.winners.length || !!next.locked;
    });
  }

  function paintDemoDrawing(state) {
    var crawl = activeCrawl(state);
    var pool = DEMO_POOLS[crawl.id] || [];
    var winners = (state.drawings && state.drawings[crawl.id]) || [];
    paintDrawing({
      crawlId: crawl.id,
      title: crawl.title,
      participantCount: pool.length,
      eligibleCount: eligibleCount(pool, winners),
      entryCount: eligibleEntries(pool, winners),
      winners: winners.map(function (row) {
        var cloned = cloneWinner(row);
        if (cloned.entryCount == null) {
          var match = pool.filter(function (person) { return personId(person) === cloned.userId; })[0];
          if (match) cloned.entryCount = entryCountOf(match);
        }
        return cloned;
      }),
      canDraw: true,
      demo: true,
      locked: ""
    });
  }

  function runDemoDraw(state) {
    var crawl = activeCrawl(state);
    setDrawingMessage("drawing-ok", "");
    setDrawingMessage("drawing-err", "");
    var count = readCount();
    if (!count) {
      setDrawingMessage("drawing-err", "Pick a number of winners from 1 to 25.");
      return;
    }
    var label = readLabel();
    var pool = DEMO_POOLS[crawl.id] || [];
    var already = (state.drawings && state.drawings[crawl.id]) || [];
    var left = eligibleCount(pool, already);
    if (!pool.length) {
      setDrawingMessage("drawing-err", "Nobody has joined this crawl yet.");
      return;
    }
    if (!left) {
      setDrawingMessage("drawing-err", "No one is left in this drawing.");
      return;
    }
    if (count > left) {
      setDrawingMessage("drawing-err", left === 1
        ? "Only 1 person is still in this drawing."
        : "Only " + left + " people are still in this drawing.");
      return;
    }
    var picked = pickFromPool(pool, already, count);
    var when = new Date().toISOString();
    picked.forEach(function (row) {
      already.push({
        userId: row.userId,
        displayName: row.displayName,
        email: row.email,
        label: label,
        entryCount: row.entryCount,
        drawnAt: when
      });
    });
    state.drawings[crawl.id] = already;
    saveState(state);
    paintDemoDrawing(state);
    setDrawingMessage("drawing-ok", "Drawn. " + picked.map(winnerLabel).join(", ") + ". Demo only, and they stay out of the next drawing for this crawl.");
  }

  function fixture() {
    return (window.__HC_ENV__ && window.__HC_ENV__.DEMO_ORGANIZER) || null;
  }

  function demoOn() {
    return new URLSearchParams(location.search).get("demo") === "1";
  }

  function esc(value) {
    return window.HCStoreDemo && HCStoreDemo.esc ? HCStoreDemo.esc(value) : String(value || "");
  }

  function escText(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function rowsForCrawl(rows, crawlId) {
    return (rows || []).filter(function (row) {
      return row && row.crawl_id === crawlId;
    });
  }

  function reasonLabel(reason) {
    if (reason === "not_signed_in") return "Not signed in";
    if (reason === "not_joined") return "Not joined";
    if (reason === "bad_code") return "Bad code";
    if (reason === "already_stamped") return "Already stamped";
    return "Error";
  }

  function whenLabel(value) {
    var text = String(value || "");
    return text ? text.slice(0, 16).replace("T", " ") : "";
  }

  function renderFailureList(crawlId, rows) {
    var mine = rowsForCrawl(rows, crawlId);
    if (!mine.length) return '<p class="muted small">No failed scans for this crawl.</p>';
    return mine.map(function (row) {
      return '<article class="record-card"><b class="record-name">' + escText(reasonLabel(row.reason)) +
        '</b><p class="record-email">' + escText(row.business_id || "No shop") + " · " + escText(row.code_entered || "No code") +
        '</p><p class="small muted">' + escText(whenLabel(row.created_at)) + " · " + escText(row.user_agent || "") + "</p></article>";
    }).join("");
  }

  function renderFixList(crawlId, rows) {
    var mine = rowsForCrawl(rows, crawlId);
    if (!mine.length) return '<p class="muted small">No stamp fix requests for this crawl.</p>';
    return mine.map(function (row) {
      var shops = Array.isArray(row.business_ids) ? row.business_ids.join(", ") : "";
      return '<article class="record-card"><b class="record-name">' + escText(row.guest_email || row.user_id || "Guest") +
        '</b><p class="record-email">' + escText(shops) + '</p><p class="small">' + escText(row.note || "") +
        '</p><p class="small muted">' + escText(whenLabel(row.created_at)) +
        '</p><button class="btn btn-soft mt-1" type="button" data-approve-fix="' + escText(row.id) +
        '" data-crawl="' + escText(crawlId) + '">Approve</button></article>';
    }).join("");
  }

  function paintScanLists(crawlId, failures, fixes) {
    var scans = document.getElementById("failed-scans");
    var requests = document.getElementById("stamp-fix-requests");
    if (scans) scans.innerHTML = renderFailureList(crawlId, failures);
    if (requests) requests.innerHTML = renderFixList(crawlId, fixes);
  }

  function demoFailureRows(crawlId) {
    return [
      {
        crawl_id: crawlId,
        business_id: "demo-shop",
        code_entered: "DEMOCODE",
        reason: "bad_code",
        user_agent: "DEMO DATA",
        created_at: "2026-11-05T18:00:00Z"
      },
      {
        crawl_id: crawlId === "puy-coffee" ? "arl-coffee" : "puy-coffee",
        business_id: "other-shop",
        code_entered: "OTHERCODE",
        reason: "bad_code",
        user_agent: "other crawl",
        created_at: "2026-11-05T18:00:00Z"
      }
    ];
  }

  function demoFixRows(crawlId) {
    return [
      {
        id: "demo-fix-" + crawlId,
        crawl_id: crawlId,
        guest_email: "guest@example.com",
        business_ids: ["demo-shop"],
        note: "DEMO DATA. The counter code did not stick.",
        created_at: "2026-11-05T18:04:00Z"
      },
      {
        id: "demo-fix-other",
        crawl_id: crawlId === "puy-coffee" ? "arl-coffee" : "puy-coffee",
        guest_email: "other@example.com",
        business_ids: ["other-shop"],
        note: "OTHER CRAWL NOTE",
        created_at: "2026-11-05T18:05:00Z"
      }
    ];
  }

  function loadState(base) {
    var state = {
      active: base.crawls[0].id,
      crawls: JSON.parse(JSON.stringify(base.crawls)),
      invites: [],
      drawings: seedDrawings()
    };
    try {
      var saved = JSON.parse(localStorage.getItem(KEY) || "null");
      if (saved && Array.isArray(saved.crawls)) {
        saved.crawls.forEach(function (row) {
          var match = state.crawls.filter(function (c) { return c.id === row.id; })[0];
          if (!match) return;
          if (row.title) match.title = String(row.title).slice(0, 120);
          if (row.starts) match.starts = row.starts;
          if (row.ends) match.ends = row.ends;
          if (typeof row.videoUrl === "string") match.videoUrl = row.videoUrl.slice(0, 500);
          if (Array.isArray(row.stores)) {
            row.stores.forEach(function (saved) {
              var shop = (match.stores || []).filter(function (item) { return item.name === saved.name; })[0];
              if (shop && saved.visible === false) shop.visible = false;
            });
          }
        });
      }
      if (saved && Array.isArray(saved.invites)) state.invites = saved.invites;
      if (saved && saved.drawings && typeof saved.drawings === "object") {
        Object.keys(DEMO_POOLS).forEach(function (id) {
          if (!Array.isArray(saved.drawings[id])) return;
          var poolIds = {};
          DEMO_POOLS[id].forEach(function (person) { poolIds[person.userId] = true; });
          state.drawings[id] = saved.drawings[id].map(cloneWinner).filter(function (row) {
            return poolIds[row.userId];
          });
        });
      }
      if (saved && saved.active && state.crawls.some(function (c) { return c.id === saved.active; })) state.active = saved.active;
    } catch (e) {}
    return state;
  }

  function saveState(state) {
    localStorage.setItem(KEY, JSON.stringify({
      active: state.active,
      crawls: state.crawls.map(function (c) {
        return {
          id: c.id,
          title: c.title,
          starts: c.starts,
          ends: c.ends,
          videoUrl: c.videoUrl || "",
          stores: (c.stores || []).map(function (row) { return { name: row.name, visible: row.visible !== false }; })
        };
      }),
      invites: state.invites,
      drawings: state.drawings || seedDrawings()
    }));
  }

  function activeCrawl(state) {
    return state.crawls.filter(function (c) { return c.id === state.active; })[0] || state.crawls[0];
  }

  function guestsFor(crawl) {
    var store = window.__HC_ENV__ && window.__HC_ENV__.DEMO_STORE;
    var rows = (store && store.guests) || [];
    return rows.filter(function (row) { return row && row.consentedAt; }).map(function (row) {
      return {
        name: row.name,
        email: row.email,
        crawlsJoined: crawl.title,
        stamps: row.stamps,
        consentedAt: row.consentedAt
      };
    });
  }

  function render(state, person) {
    var crawl = activeCrawl(state);
    var picker = document.getElementById("org-crawl");
    if (picker) {
      picker.innerHTML = state.crawls.map(function (c) {
        return '<option value="' + esc(c.id) + '">' + esc(c.title) + "</option>";
      }).join("");
      picker.value = crawl.id;
    }
    var title = document.getElementById("org-title");
    var start = document.getElementById("org-start");
    var end = document.getElementById("org-end");
    if (title && document.activeElement !== title) title.value = crawl.title || "";
    if (start && document.activeElement !== start) start.value = crawl.starts || "";
    if (end && document.activeElement !== end) end.value = crawl.ends || "";
    var video = document.getElementById("org-video");
    if (video && document.activeElement !== video) video.value = crawl.videoUrl || "";
    var who = document.getElementById("org-who");
    if (who) who.textContent = person.name + " · " + person.email + " · " + person.role;

    var stores = crawl.stores || [];
    var scans = stores.reduce(function (sum, row) { return sum + Number(row.scans || 0); }, 0);
    var paid = stores.filter(function (row) { return row.paid; }).length;
    var set = function (id, value) {
      var el = document.getElementById(id);
      if (el) el.textContent = String(value);
    };
    set("org-total-stores", stores.length);
    set("org-total-paid", paid);
    set("org-total-unpaid", stores.length - paid);
    set("org-total-scans", scans);

    var list = document.getElementById("org-stores");
    if (list) {
      list.innerHTML = stores.map(function (row) {
        var pay = row.paid
          ? '<span class="pill pill-ok">Paid</span>'
          : '<span class="pill pill-wait">Unpaid</span>';
        var shown = row.visible !== false;
        return '<article class="record-card"><b class="record-name">' + esc(row.name) + '</b><p class="record-email">' +
          esc(row.code) + ' · ' + esc(row.scans) + ' scans · DEMO DATA</p><div class="record-chips">' + pay +
          '</div><label class="check"><input type="checkbox" data-visible="' + esc(row.name) + '"' +
          (shown ? " checked" : "") + "> Show on the passport</label></article>";
      }).join("");
    }

    var people = document.getElementById("co-list");
    if (people) {
      var mine = '<article class="record-card"><b class="record-name">Chris Miller</b><p class="record-email">chris@beekings.com</p><span class="chip">owner</span></article>' +
        '<article class="record-card"><b class="record-name">' + esc(person.name) + '</b><p class="record-email">' +
        esc(person.email) + '</p><span class="chip">' + esc(person.role) + "</span></article>" +
        '<article class="record-card"><b class="record-name">Contributor</b><p class="record-email">No store required. The migration does not replace the owner.</p><span class="chip">contributor</span></article>';
      var pending = state.invites.filter(function (row) { return row.crawlId === crawl.id; }).map(function (row) {
        return '<article class="guest-card"><b>' + esc(row.email) + '</b><div class="row mt-1"><span class="pill pill-wait">Pending invite</span><span class="pill pill-muted">co-organizer</span></div><p class="small mt-1" style="overflow-wrap:anywhere">' +
          esc(row.link) + "</p></article>";
      }).join("");
      people.innerHTML = mine + pending;
    }
    paintScanLists(crawl.id, demoFailureRows(crawl.id), demoFixRows(crawl.id));
    paintDemoDrawing(state);
  }

  document.addEventListener("DOMContentLoaded", function () {
    var base = fixture();
    if (!base || !demoOn() || !document.getElementById("panel-organizer")) return;
    var state = loadState(base);
    render(state, base.person);
    var fixList = document.getElementById("stamp-fix-requests");
    if (fixList) {
      fixList.addEventListener("click", function (ev) {
        var btn = ev.target.closest && ev.target.closest("[data-approve-fix]");
        if (!btn) return;
        var crawl = activeCrawl(state);
        if (btn.getAttribute("data-crawl") !== crawl.id) return;
        var ok = document.getElementById("stamp-fix-ok");
        var err = document.getElementById("stamp-fix-err");
        if (err) err.textContent = "";
        if (ok) ok.textContent = "DEMO DATA. No stamp was added.";
      });
    }
    onDrawSubmit = function () {
      if (!demoOn()) return;
      runDemoDraw(state);
    };

    var storeList = document.getElementById("org-stores");
    if (storeList) {
      storeList.addEventListener("change", function (ev) {
        var box = ev.target.closest && ev.target.closest("[data-visible]");
        if (!box) return;
        var crawl = activeCrawl(state);
        (crawl.stores || []).forEach(function (row) {
          if (row.name === box.getAttribute("data-visible")) row.visible = box.checked;
        });
        saveState(state);
      });
    }

    var picker = document.getElementById("org-crawl");
    if (picker) {
      picker.onchange = function () {
        state.active = picker.value;
        saveState(state);
        render(state, base.person);
      };
    }

    var details = document.getElementById("org-details");
    if (details) {
      details.onsubmit = function (ev) {
        ev.preventDefault();
        var crawl = activeCrawl(state);
        var title = document.getElementById("org-title").value.trim();
        var start = document.getElementById("org-start").value;
        var end = document.getElementById("org-end").value;
        var videoUrl = document.getElementById("org-video") ? document.getElementById("org-video").value.trim() : "";
        var err = document.getElementById("org-err");
        var ok = document.getElementById("org-ok");
        if (err) { err.textContent = ""; err.classList.remove("show"); }
        if (ok) { ok.textContent = ""; ok.classList.remove("show"); }
        if (!title || title.length > 120) {
          if (err) { err.textContent = "Title needs 1–120 characters."; err.classList.add("show"); }
          return;
        }
        if (!start || !end || end < start) {
          if (err) { err.textContent = "End date needs to be on or after the start date."; err.classList.add("show"); }
          return;
        }
        if (window.HCVideo && HCVideo.problem(videoUrl)) {
          if (err) { err.textContent = HCVideo.problem(videoUrl); err.classList.add("show"); }
          return;
        }
        crawl.title = title;
        crawl.starts = start;
        crawl.ends = end;
        crawl.videoUrl = videoUrl;
        saveState(state);
        render(state, base.person);
        if (ok) { ok.textContent = "DEMO DATA. Title and dates saved in this browser only."; ok.classList.add("show"); }
        if (window.HC) HC.toast("Crawl details saved");
      };
    }

    var csv = document.getElementById("btn-org-csv");
    if (csv) {
      csv.onclick = function () {
        var crawl = activeCrawl(state);
        if (window.HCStoreDemo) HCStoreDemo.downloadGuests(guestsFor(crawl), crawl.id);
        if (window.HC) HC.toast("Guest CSV downloaded");
      };
    }

    var invite = document.getElementById("co-invite-form");
    if (invite) {
      invite.onsubmit = function (ev) {
        ev.preventDefault();
        var email = document.getElementById("co-email").value.trim().toLowerCase();
        var err = document.getElementById("co-err");
        var ok = document.getElementById("co-ok");
        if (err) { err.textContent = ""; err.classList.remove("show"); }
        if (ok) { ok.textContent = ""; ok.classList.remove("show"); }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          if (err) { err.textContent = "Enter a valid email address."; err.classList.add("show"); }
          return;
        }
        var token = (window.crypto && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, "") : String(Date.now());
        var link = location.origin + "/account?tab=organizer&demo=1&invite=" + token;
        state.invites.push({ crawlId: activeCrawl(state).id, email: email, token: token, link: link, role: "co-organizer" });
        saveState(state);
        document.getElementById("co-email").value = "";
        render(state, base.person);
        if (ok) {
          ok.textContent = "Invite recorded for " + email + ". Nothing was emailed. Share the link yourself.";
          ok.classList.add("show");
        }
        if (window.HC) HC.toast("Invite link ready");
      };
    }

    var params = new URLSearchParams(location.search);
    if (params.get("invite")) {
      var banner = document.getElementById("org-invite-banner");
      if (banner) {
        banner.classList.remove("hidden");
        banner.textContent = "DEMO DATA. This invite link is recorded only. No email was sent, and it does not change live organizer access.";
      }
    }
  });

  function dateOnly(value) {
    return value ? String(value).slice(0, 10) : "";
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (demoOn() || !document.getElementById("panel-organizer") || !window.HCCrawl || !HCCrawl.client) return;
    var crawls = [];
    var shops = [];
    var team = [];
    var active = "";
    var drawingToken = 0;

    function showTab() {
      var tabs = document.getElementById("role-tabs");
      var btn = document.getElementById("tab-organizer");
      if (tabs) tabs.classList.remove("hidden");
      if (btn) btn.classList.remove("hidden");
      if (window.HCStoreDemo && HCStoreDemo.openRequestedTab) HCStoreDemo.openRequestedTab();
    }

    function current() {
      return crawls.filter(function (row) { return row.crawl_id === active; })[0] || crawls[0];
    }

    function renderLive() {
      var crawl = current();
      if (!crawl) return;
      active = crawl.crawl_id;
      var picker = document.getElementById("org-crawl");
      if (picker) {
        picker.innerHTML = crawls.map(function (row) {
          return '<option value="' + esc(row.crawl_id) + '">' + esc(row.name) + "</option>";
        }).join("");
        picker.value = active;
      }
      var title = document.getElementById("org-title");
      var start = document.getElementById("org-start");
      var end = document.getElementById("org-end");
      if (title && document.activeElement !== title) title.value = crawl.name || "";
      if (start && document.activeElement !== start) start.value = dateOnly(crawl.starts_at);
      if (end && document.activeElement !== end) end.value = dateOnly(crawl.ends_at);
      var video = document.getElementById("org-video");
      if (video && document.activeElement !== video) video.value = crawl.video_url || "";
      var who = document.getElementById("org-who");
      if (who) who.textContent = (crawl.role || "organizer") + " · shop fees are not split";
      var scans = shops.reduce(function (sum, row) { return sum + Number(row.scans || 0); }, 0);
      var paid = shops.filter(function (row) { return row.is_paid; }).length;
      ["org-total-stores", "org-total-paid", "org-total-unpaid", "org-total-scans"].forEach(function (id, index) {
        var el = document.getElementById(id);
        var values = [shops.length, paid, shops.length - paid, scans];
        if (el) el.textContent = String(values[index]);
      });
      var list = document.getElementById("org-stores");
      if (list) {
        list.innerHTML = shops.map(function (row) {
          var pay = row.is_paid ? '<span class="pill pill-ok">Paid</span>' : '<span class="pill pill-wait">Unpaid</span>';
          return '<article class="record-card"><b class="record-name">' + esc(row.display_name) + '</b><p class="record-email">' +
            esc(row.scans || 0) + ' scans</p><div class="record-chips">' + pay +
            '</div><div class="row mt-1"><button class="btn btn-soft" type="button" data-counter-card="' + esc(row.listing_id) +
            '">Counter card</button><button class="btn btn-soft" type="button" data-edit-shop="' + esc(row.listing_id) +
            '">Edit</button></div><label class="check"><input type="checkbox" data-listing="' +
            esc(row.listing_id) + '"' + (row.is_visible ? " checked" : "") + "> Show on the passport</label></article>";
        }).join("") || '<p class="muted small">No stores yet.</p>';
      }
      var people = document.getElementById("co-list");
      if (people) {
        people.innerHTML = team.map(function (row) {
          return '<article class="record-card"><b class="record-name">' + esc(row.name || row.email) + '</b><p class="record-email">' +
            esc(row.email) + '</p><span class="chip">' + esc(row.role) + "</span></article>";
        }).join("") || '<p class="muted small">No teammates loaded.</p>';
      }
    }

    async function loadShops() {
      var res = await HCCrawl.client().rpc("organizer_crawl_shops", { p_crawl: active });
      shops = res.error ? [] : (res.data || []);
    }

    async function loadTeam() {
      var res = await HCCrawl.client().rpc("organizer_list_co_organizers", { p_crawl_id: active });
      team = res.error ? [] : (res.data || []);
    }

    async function loadScanLists() {
      var failures = await HCCrawl.client().rpc("organizer_stamp_failures", { p_crawl: active });
      var fixes = await HCCrawl.client().rpc("organizer_list_stamp_fix_requests", { p_crawl: active });
      var err = document.getElementById("stamp-fix-err");
      if (err) err.textContent = "";
      if (failures.error || fixes.error) {
        if (err) err.textContent = (failures.error && failures.error.message) || (fixes.error && fixes.error.message) || "Could not load this crawl.";
      }
      paintScanLists(
        active,
        failures.error ? [] : (failures.data || []),
        fixes.error ? [] : (fixes.data || [])
      );
    }

    function statusView(crawl, data) {
      return {
        crawlId: crawl.crawl_id,
        title: crawl.name || "",
        participantCount: Number(data && data.participant_count) || 0,
        eligibleCount: Number(data && data.eligible_count) || 0,
        entryCount: data && data.entry_count != null && data.entry_count !== "" ? Number(data.entry_count) : null,
        winners: (data && data.winners) || [],
        canDraw: true,
        demo: false,
        locked: ""
      };
    }

    async function loadDrawing() {
      var request = ++drawingToken;
      var crawl = current();
      if (!crawl) return;
      if (!canDraw(crawl.role)) {
        paintDrawing({
          crawlId: crawl.crawl_id,
          title: crawl.name || "",
          winners: [],
          canDraw: false,
          demo: false,
          locked: "Only the owner, an organizer, or a co-organizer of this crawl can run the weekly drawing."
        });
        return;
      }
      paintDrawing({
        crawlId: crawl.crawl_id,
        title: crawl.name || "",
        winners: [],
        canDraw: true,
        demo: false,
        loading: true
      });
      var res = await HCCrawl.client().rpc("organizer_drawing_status", { p_crawl: crawl.crawl_id });
      if (request !== drawingToken) return;
      var now = current();
      if (!now || now.crawl_id !== crawl.crawl_id) return;
      if (res.error) {
        paintDrawing({
          crawlId: crawl.crawl_id,
          title: crawl.name || "",
          winners: [],
          canDraw: true,
          demo: false,
          locked: "",
          poolText: "The pool could not be loaded for this crawl."
        });
        setDrawingMessage("drawing-err", plainDrawingError(res.error));
        return;
      }
      paintDrawing(statusView(crawl, res.data || {}));
    }

    onDrawSubmit = async function () {
      if (demoOn()) return;
      var crawl = current();
      if (!crawl || !canDraw(crawl.role)) return;
      var crawlId = crawl.crawl_id;
      setDrawingMessage("drawing-ok", "");
      setDrawingMessage("drawing-err", "");
      var count = readCount();
      if (!count) {
        setDrawingMessage("drawing-err", "Pick a number of winners from 1 to 25.");
        return;
      }
      var label = readLabel();
      var button = document.getElementById("drawing-submit");
      if (button) button.disabled = true;
      try {
        var res = await HCCrawl.client().rpc("organizer_draw_winners", {
          p_crawl: crawlId,
          p_count: count,
          p_label: label || null
        });
        var now = current();
        if (!now || now.crawl_id !== crawlId) {
          await loadDrawing();
          return;
        }
        if (res.error) {
          setDrawingMessage("drawing-err", plainDrawingError(res.error));
          return;
        }
        var data = res.data || {};
        if (data.crawl_id && data.crawl_id !== crawlId) {
          setDrawingMessage("drawing-err", "That result was for a different crawl, so it was not shown here.");
          await loadDrawing();
          return;
        }
        paintDrawing(statusView(crawl, data));
        var names = (data.drawn || []).map(winnerLabel).filter(Boolean);
        setDrawingMessage("drawing-ok", names.length
          ? "Drawn. " + names.join(", ") + ". They are out of the next drawing for this crawl."
          : "Drawn.");
      } finally {
        if (button) button.disabled = false;
      }
    };

    HCCrawl.getSession().then(async function (session) {
      if (!session || !session.user || session.user.is_anonymous || !session.user.email) return;
      var mine = await HCCrawl.client().rpc("organizer_my_crawls");
      if (mine.error || !mine.data || !mine.data.length) return;
      crawls = mine.data;
      active = crawls[0].crawl_id;
      showTab();
      await loadShops();
      await loadTeam();
      renderLive();
      await loadDrawing();
      await loadScanLists();
    }).catch(function () {});

    var closeCounterCard = function () {};
    var picker = document.getElementById("org-crawl");
    if (picker) {
      picker.addEventListener("change", async function () {
        if (demoOn()) return;
        closeCounterCard();
        active = picker.value;
        await loadShops();
        await loadTeam();
        renderLive();
        await loadDrawing();
        await loadScanLists();
      });
    }

    var fixList = document.getElementById("stamp-fix-requests");
    if (fixList) {
      fixList.addEventListener("click", async function (ev) {
        var btn = ev.target.closest && ev.target.closest("[data-approve-fix]");
        if (!btn || demoOn()) return;
        if (btn.getAttribute("data-crawl") !== active) return;
        var ok = document.getElementById("stamp-fix-ok");
        var err = document.getElementById("stamp-fix-err");
        if (ok) ok.textContent = "";
        if (err) err.textContent = "";
        btn.disabled = true;
        var saved = await HCCrawl.client().rpc("organizer_approve_stamp_fix", {
          p_crawl: active,
          p_request: btn.getAttribute("data-approve-fix")
        });
        btn.disabled = false;
        if (saved.error) {
          if (err) err.textContent = saved.error.message || "Could not approve that request.";
          return;
        }
        if (ok) ok.textContent = "Approved. A manual stamp was added for the shops on this crawl.";
        await loadScanLists();
      });
    }

    var details = document.getElementById("org-details");
    if (details) {
      details.addEventListener("submit", async function (ev) {
        if (demoOn()) return;
        ev.preventDefault();
        var err = document.getElementById("org-err");
        var ok = document.getElementById("org-ok");
        if (err) { err.textContent = ""; err.classList.remove("show"); }
        if (ok) { ok.textContent = ""; ok.classList.remove("show"); }
        var title = document.getElementById("org-title").value.trim();
        var start = document.getElementById("org-start").value;
        var end = document.getElementById("org-end").value;
        var videoUrl = document.getElementById("org-video") ? document.getElementById("org-video").value.trim() : "";
        if (!title || !start || !end || end < start) {
          if (err) { err.textContent = "Title and dates need an end date on or after the start."; err.classList.add("show"); }
          return;
        }
        if (window.HCVideo && HCVideo.problem(videoUrl)) {
          if (err) { err.textContent = HCVideo.problem(videoUrl); err.classList.add("show"); }
          return;
        }
        var saved = await HCCrawl.client().rpc("organizer_update_crawl", {
          p_crawl: active,
          p_name: title,
          p_starts: start,
          p_ends: end,
          p_video_url: videoUrl
        });
        if (saved.error) {
          if (err) { err.textContent = saved.error.message || "Could not save the crawl."; err.classList.add("show"); }
          return;
        }
        var crawl = current();
        if (crawl) { crawl.name = title; crawl.starts_at = start; crawl.ends_at = end; crawl.video_url = videoUrl; }
        renderLive();
        if (ok) { ok.textContent = "Crawl details saved."; ok.classList.add("show"); }
      });
    }

    var editing = null;
    var shopPaths = [];

    function shopForm() {
      return document.getElementById("org-shop-form");
    }

    function shopMessage(id, text) {
      var el = document.getElementById(id);
      if (!el) return;
      el.textContent = text || "";
      el.classList.toggle("show", !!text);
    }

    function shopImageUrl(path) {
      if (!path || !window.HCCrawl) return "";
      var out = HCCrawl.client().storage.from("shop-images").getPublicUrl(path);
      return (out && out.data && out.data.publicUrl) || "";
    }

    function setShopPreview(imgId, emptyId, path) {
      var img = document.getElementById(imgId);
      var empty = document.getElementById(emptyId);
      var src = shopImageUrl(path);
      if (!img) return;
      if (src) {
        img.src = src;
        img.classList.remove("hidden");
        if (empty) empty.classList.add("hidden");
      } else {
        img.removeAttribute("src");
        img.classList.add("hidden");
        if (empty) empty.classList.remove("hidden");
      }
    }

    function paintShopGallery() {
      var gallery = document.getElementById("org-shop-gallery");
      if (!gallery) return;
      var rest = shopPaths.slice(1);
      gallery.innerHTML = rest.map(function (src, index) {
        return '<figure class="gallery-item"><img src="' + esc(shopImageUrl(src)) + '" alt=""><button type="button" data-remove-org-photo="' + (index + 1) + '">Remove</button></figure>';
      }).join("") || '<p class="muted small">No gallery photos yet.</p>';
    }

    function paintShopForm(row) {
      editing = row;
      shopPaths = Array.isArray(row.photo_paths) ? row.photo_paths.slice() : [];
      var form = shopForm();
      if (form) {
        form.classList.remove("hidden");
        form.hidden = false;
      }
      var fields = {
        "org-shop-name": row.display_name || "",
        "org-shop-stamp-label": row.stamp_label || "",
        "org-shop-address": row.address || "",
        "org-shop-postal": row.postal_code || "",
        "org-shop-phone": row.phone || "",
        "org-shop-hours": row.hours || "",
        "org-shop-description": row.blurb || "",
        "org-shop-website": row.website || "",
        "org-shop-instagram": row.instagram || "",
        "org-shop-video": row.video_url || ""
      };
      Object.keys(fields).forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.value = fields[id];
      });
      setShopPreview("org-shop-cover-preview", "org-shop-cover-empty", shopPaths[0]);
      setShopPreview("org-shop-logo-preview", "org-shop-logo-empty", row.logo_path);
      setShopPreview("org-shop-stamp-preview", "org-shop-stamp-empty", row.stamp_image_path);
      paintShopGallery();
      shopMessage("org-shop-ok", "");
      shopMessage("org-shop-err", "");
    }

    function closeShopForm() {
      editing = null;
      shopPaths = [];
      var form = shopForm();
      if (!form) return;
      form.classList.add("hidden");
      form.hidden = true;
    }

    function shopFileType(file) {
      if (!file) return "";
      return file.type === "image/jpg" ? "image/jpeg" : file.type;
    }

    async function uploadShopFile(folder, file, limitMb) {
      var type = shopFileType(file);
      if (["image/jpeg", "image/png", "image/webp"].indexOf(type) === -1) throw new Error("Use a PNG, JPG, or WebP image.");
      if (file.size > limitMb * 1024 * 1024) throw new Error("Images need to be " + limitMb + " MB or smaller.");
      var ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
      var path = editing.listing_id + "/" + folder + "/" + (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())) + "." + ext;
      var up = await HCCrawl.client().storage.from("shop-images").upload(path, file, { contentType: type, upsert: false });
      if (up.error) throw up.error;
      return path;
    }

    var counterListing = null;
    var counterRequest = 0;

    function counterBox(id) {
      return document.getElementById(id);
    }

    function showCounter(on) {
      var panel = counterBox("org-counter-card");
      if (!panel) return;
      panel.classList.toggle("hidden", !on);
      panel.hidden = !on;
    }

    function counterMessage(text) {
      var el = counterBox("org-counter-err");
      if (!el) return;
      el.textContent = text || "";
      el.classList.toggle("show", !!text);
    }

    function counterErrorText(error) {
      var message = (error && error.message) || "";
      if (/not authorized/i.test(message)) return "That counter card is only available to the crawl team.";
      if (/organizer_shop_counter_card|schema cache|could not find the function/i.test(message)) {
        return "Counter cards are not on this server yet. The database update still needs to be applied.";
      }
      return message || "Could not open that counter card.";
    }

    function paintCounter(row) {
      counterListing = row;
      var name = counterBox("org-counter-name");
      var lead = counterBox("org-counter-lead");
      var codeEl = counterBox("org-counter-code");
      var actions = counterBox("org-counter-actions");
      var note = counterBox("org-counter-print-note");
      var tent = counterBox("org-counter-tent");
      var cardReady = !!(window.HCCounterCard && HCCounterCard.ready(row));
      if (name) name.textContent = row.display_name || "Shop";
      if (codeEl) {
        codeEl.textContent = row.store_code || "";
        codeEl.hidden = !row.store_code;
      }
      if (cardReady) {
        if (lead) lead.textContent = "Same tent the host sets on the counter. Guests scan the QR or type the counter code.";
        if (actions) actions.classList.remove("hidden");
        if (note) note.classList.remove("hidden");
        if (tent) {
          tent.classList.remove("hidden");
          tent.innerHTML = HCCounterCard.tentHtml(row);
        }
        return;
      }
      if (actions) actions.classList.add("hidden");
      if (note) note.classList.add("hidden");
      if (tent) {
        tent.innerHTML = "";
        tent.classList.add("hidden");
      }
      if (!lead) return;
      if (!row.is_paid && !row.store_code && !row.qr_secret) {
        lead.textContent = "This shop is not paid yet, so there is no counter card. It shows up here after payment.";
      } else if (row.store_code && window.HCCounterCard && !HCCounterCard.stampPage(row.crawl_id)) {
        lead.textContent = "The counter code is ready. This crawl does not have a public stamp page yet, so the QR is not on the card.";
      } else {
        lead.textContent = "This counter card is still being prepared. Email hello@hometowncrawls.com if this stays blank.";
      }
    }

    function closeCounter() {
      counterRequest += 1;
      counterListing = null;
      var tent = counterBox("org-counter-tent");
      if (tent) tent.innerHTML = "";
      var codeEl = counterBox("org-counter-code");
      if (codeEl) codeEl.textContent = "";
      counterMessage("");
      showCounter(false);
    }
    closeCounterCard = closeCounter;

    function removePrintStyle() {
      document.body.classList.remove("hc-counter-print");
      var style = document.getElementById("hc-counter-page-size");
      if (style) style.remove();
    }

    function armPrint() {
      if (!counterListing || !window.HCCounterCard || !HCCounterCard.ready(counterListing)) return false;
      document.body.classList.add("hc-counter-print");
      if (!document.getElementById("hc-counter-page-size")) {
        var style = document.createElement("style");
        style.id = "hc-counter-page-size";
        style.textContent = "@media print { @page { size: letter landscape; margin: 0; } }";
        document.head.appendChild(style);
      }
      return true;
    }

    function printCounter() {
      if (!armPrint()) return;
      window.print();
    }

    window.addEventListener("beforeprint", armPrint);
    window.addEventListener("afterprint", removePrintStyle);

    async function downloadCounter() {
      if (!counterListing || !window.HCCounterCard || !HCCounterCard.ready(counterListing)) return;
      var css = "";
      try {
        var res = await fetch("/assets/counter-card.css");
        if (res.ok) css = await res.text();
      } catch (ignore) {}
      var file = HCCounterCard.downloadFile(counterListing, css);
      var blob = new Blob([file.html], { type: "text/html" });
      var url = URL.createObjectURL(blob);
      var link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    async function openCounter(listingId) {
      var request = ++counterRequest;
      closeShopForm();
      counterListing = null;
      counterMessage("");
      var tent = counterBox("org-counter-tent");
      if (tent) { tent.innerHTML = ""; tent.classList.add("hidden"); }
      var codeEl = counterBox("org-counter-code");
      if (codeEl) { codeEl.textContent = ""; codeEl.hidden = true; }
      var actions = counterBox("org-counter-actions");
      if (actions) actions.classList.add("hidden");
      var note = counterBox("org-counter-print-note");
      if (note) note.classList.add("hidden");
      showCounter(true);
      var known = shops.filter(function (row) { return row.listing_id === listingId; })[0];
      var name = counterBox("org-counter-name");
      if (name) name.textContent = (known && known.display_name) || "Shop";
      var lead = counterBox("org-counter-lead");
      if (lead) lead.textContent = "Loading the counter card…";
      var res = await HCCrawl.client().rpc("organizer_shop_counter_card", { p_listing: listingId });
      if (request !== counterRequest) return;
      if (res.error || !res.data || !res.data.length) {
        counterListing = null;
        var tent = counterBox("org-counter-tent");
        if (tent) { tent.innerHTML = ""; tent.classList.add("hidden"); }
        var actions = counterBox("org-counter-actions");
        if (actions) actions.classList.add("hidden");
        if (lead) lead.textContent = "";
        counterMessage(counterErrorText(res.error));
        return;
      }
      paintCounter(res.data[0]);
      var panel = counterBox("org-counter-card");
      if (panel && panel.scrollIntoView) panel.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    async function openShop(listingId) {
      closeCounter();
      shopMessage("org-shop-err", "");
      var res = await HCCrawl.client().rpc("organizer_shop_listing", { p_listing: listingId });
      if (res.error || !res.data || !res.data.length) {
        shopMessage("org-shop-err", (res.error && res.error.message) || "Could not open that shop.");
        var form = shopForm();
        if (form) { form.classList.remove("hidden"); form.hidden = false; }
        return;
      }
      paintShopForm(res.data[0]);
      var form = shopForm();
      if (form && form.scrollIntoView) form.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    var storeList = document.getElementById("org-stores");
    if (storeList) {
      storeList.addEventListener("click", function (ev) {
        if (demoOn()) return;
        var cardBtn = ev.target.closest && ev.target.closest("[data-counter-card]");
        if (cardBtn) {
          openCounter(cardBtn.getAttribute("data-counter-card"));
          return;
        }
        var btn = ev.target.closest && ev.target.closest("[data-edit-shop]");
        if (!btn) return;
        openShop(btn.getAttribute("data-edit-shop"));
      });
      storeList.addEventListener("change", async function (ev) {
        if (demoOn()) return;
        var box = ev.target.closest && ev.target.closest("[data-listing]");
        if (!box) return;
        var saved = await HCCrawl.client().rpc("organizer_set_shop_visible", {
          p_listing: box.getAttribute("data-listing"),
          p_visible: box.checked
        });
        if (saved.error) box.checked = !box.checked;
      });
    }

    var shopEditor = shopForm();
    if (shopEditor) {
      var cancelShop = document.getElementById("org-shop-cancel");
      if (cancelShop) cancelShop.addEventListener("click", closeShopForm);
      var closeCard = document.getElementById("org-counter-close");
      if (closeCard) closeCard.addEventListener("click", closeCounter);
      var printCard = document.getElementById("org-counter-print");
      if (printCard) printCard.addEventListener("click", printCounter);
      var downloadCard = document.getElementById("org-counter-download");
      if (downloadCard) downloadCard.addEventListener("click", downloadCounter);
      shopEditor.addEventListener("submit", async function (ev) {
        if (demoOn()) return;
        ev.preventDefault();
        shopMessage("org-shop-ok", "");
        shopMessage("org-shop-err", "");
        if (!editing) { shopMessage("org-shop-err", "Choose a shop from the list."); return; }
        var draft = {
          name: document.getElementById("org-shop-name").value.trim(),
          stampLabel: document.getElementById("org-shop-stamp-label").value.trim(),
          address: document.getElementById("org-shop-address").value.trim(),
          postal: document.getElementById("org-shop-postal").value.trim(),
          phone: document.getElementById("org-shop-phone").value.trim(),
          hours: document.getElementById("org-shop-hours").value.trim(),
          description: document.getElementById("org-shop-description").value.trim(),
          website: document.getElementById("org-shop-website").value.trim(),
          instagram: document.getElementById("org-shop-instagram").value.trim().replace(/^@/, ""),
          video: document.getElementById("org-shop-video").value.trim()
        };
        if (!draft.name || draft.name.length > 200) { shopMessage("org-shop-err", "Shop name needs to be 1–200 characters."); return; }
        if (draft.postal && !/^\d{5}(?:-\d{4})?$/.test(draft.postal)) { shopMessage("org-shop-err", "Zip code needs to be 5 digits."); return; }
        if (draft.website && !/^https?:\/\//i.test(draft.website)) { shopMessage("org-shop-err", "Website must start with http:// or https://."); return; }
        if (window.HCVideo && HCVideo.problem(draft.video)) { shopMessage("org-shop-err", HCVideo.problem(draft.video)); return; }
        var saved = await HCCrawl.client().rpc("shop_save_listing", {
          p_listing: editing.listing_id,
          p_name: draft.name,
          p_address: draft.address,
          p_postal: draft.postal,
          p_phone: draft.phone,
          p_hours: draft.hours,
          p_blurb: draft.description,
          p_website: draft.website,
          p_instagram: draft.instagram,
          p_stamp_label: draft.stampLabel,
          p_video_url: draft.video
        });
        if (saved.error) { shopMessage("org-shop-err", saved.error.message || "Could not save the shop."); return; }
        editing.display_name = draft.name;
        editing.postal_code = draft.postal;
        editing.stamp_label = draft.stampLabel;
        editing.video_url = draft.video;
        var listed = shops.filter(function (row) { return row.listing_id === editing.listing_id; })[0];
        if (listed) listed.display_name = draft.name;
        renderLive();
        shopMessage("org-shop-ok", "Shop saved.");
      });

      async function onOrgFile(inputId, folder, limitMb, apply) {
        var input = document.getElementById(inputId);
        if (!input) return;
        input.addEventListener("change", async function () {
          if (demoOn()) return;
          var file = input.files && input.files[0];
          input.value = "";
          if (!file) return;
          if (!editing) { shopMessage("org-shop-err", "Choose a shop from the list."); return; }
          shopMessage("org-shop-err", "");
          var path = "";
          try {
            path = await uploadShopFile(folder, file, limitMb);
            await apply(path);
            setShopPreview("org-shop-cover-preview", "org-shop-cover-empty", shopPaths[0]);
            setShopPreview("org-shop-logo-preview", "org-shop-logo-empty", editing.logo_path);
            setShopPreview("org-shop-stamp-preview", "org-shop-stamp-empty", editing.stamp_image_path);
            paintShopGallery();
            shopMessage("org-shop-ok", "Image saved.");
          } catch (e) {
            if (path) {
              try { await HCCrawl.client().storage.from("shop-images").remove([path]); } catch (ignore) {}
            }
            shopMessage("org-shop-err", (e && e.message) || "Could not add that image.");
          }
        });
      }

      onOrgFile("file-org-cover", "gallery", 5, async function (path) {
        var next = [path].concat(shopPaths.filter(function (item) { return item !== path; })).slice(0, 8);
        var saved = await HCCrawl.client().rpc("shop_set_photo_paths", { p_listing: editing.listing_id, p_paths: next });
        if (saved.error) throw saved.error;
        shopPaths = next;
        editing.photo_paths = next;
      });
      onOrgFile("file-org-gallery", "gallery", 5, async function (path) {
        if (shopPaths.length >= 8) throw new Error("You can keep up to 8 photos.");
        var next = shopPaths.concat([path]);
        var saved = await HCCrawl.client().rpc("shop_set_photo_paths", { p_listing: editing.listing_id, p_paths: next });
        if (saved.error) throw saved.error;
        shopPaths = next;
        editing.photo_paths = next;
      });
      onOrgFile("file-org-stamp", "stamp", 2, async function (path) {
        var saved = await HCCrawl.client().rpc("shop_set_stamp_art", { p_listing: editing.listing_id, p_kind: "stamp", p_path: path });
        if (saved.error) throw saved.error;
        editing.stamp_image_path = path;
      });
      onOrgFile("file-org-logo", "logo", 2, async function (path) {
        var saved = await HCCrawl.client().rpc("shop_set_stamp_art", { p_listing: editing.listing_id, p_kind: "logo", p_path: path });
        if (saved.error) throw saved.error;
        editing.logo_path = path;
      });

      var orgGallery = document.getElementById("org-shop-gallery");
      if (orgGallery) {
        orgGallery.addEventListener("click", async function (ev) {
          if (demoOn() || !editing) return;
          var btn = ev.target.closest && ev.target.closest("[data-remove-org-photo]");
          if (!btn) return;
          var index = Number(btn.getAttribute("data-remove-org-photo"));
          var removed = shopPaths[index];
          var next = shopPaths.filter(function (_, i) { return i !== index; });
          var saved = await HCCrawl.client().rpc("shop_set_photo_paths", { p_listing: editing.listing_id, p_paths: next });
          if (saved.error) { shopMessage("org-shop-err", saved.error.message || "Could not remove that photo."); return; }
          shopPaths = next;
          editing.photo_paths = next;
          if (removed) {
            try { await HCCrawl.client().storage.from("shop-images").remove([removed]); } catch (ignore) {}
          }
          setShopPreview("org-shop-cover-preview", "org-shop-cover-empty", shopPaths[0]);
          paintShopGallery();
        });
      }
    }

    var optIns = [];
    function paintOptIns(rows) {
      optIns = rows || [];
      var results = document.getElementById("area-opt-in-results");
      if (!results) return;
      results.replaceChildren();
      if (!optIns.length) {
        var empty = document.createElement("p");
        empty.className = "muted small";
        empty.textContent = "No opted-in guests in that region.";
        results.append(empty);
        return;
      }
      optIns.forEach(function (row) {
        var article = document.createElement("article");
        article.className = "record-card";
        var name = document.createElement("b");
        name.className = "record-name";
        name.textContent = row.player_name || row.player_email || "Guest";
        var detail = document.createElement("p");
        detail.className = "small";
        detail.textContent = [row.player_email, row.player_phone, row.region_label || row.region_city, row.crawl_name].filter(Boolean).join(" · ");
        article.append(name, detail);
        results.append(article);
      });
    }
    async function loadOptIns() {
      var err = document.getElementById("area-opt-in-err");
      if (err) { err.textContent = ""; err.classList.remove("show"); }
      if (demoOn()) {
        if (err) { err.textContent = "Demo mode does not list live opt-ins."; err.classList.add("show"); }
        return;
      }
      var regionEl = document.getElementById("area-opt-in-region");
      var region = regionEl ? regionEl.value.trim() : "";
      var res = await HCCrawl.client().rpc("organizer_area_opt_ins", { p_region: region });
      if (res.error) {
        if (err) { err.textContent = res.error.message || "Could not load opt-ins."; err.classList.add("show"); }
        return;
      }
      paintOptIns(res.data || []);
    }
    var optForm = document.getElementById("area-opt-in-form");
    if (optForm) {
      optForm.addEventListener("submit", function (ev) {
        ev.preventDefault();
        loadOptIns();
      });
    }
    var optCsv = document.getElementById("area-opt-in-csv");
    if (optCsv) {
      optCsv.addEventListener("click", function () {
        if (demoOn()) return;
        var header = ["name", "email", "phone", "crawl", "region", "city", "state", "postal", "opted_in_at"];
        var lines = [header.join(",")];
        optIns.forEach(function (row) {
          lines.push([
            row.player_name, row.player_email, row.player_phone, row.crawl_name,
            row.region_label, row.region_city, row.region_state, row.region_postal, row.opted_in_at
          ].map(function (value) {
            return '"' + String(value == null ? "" : value).replace(/"/g, '""') + '"';
          }).join(","));
        });
        var blob = new Blob([lines.join("\n")], { type: "text/csv" });
        var url = URL.createObjectURL(blob);
        var link = document.createElement("a");
        link.href = url;
        link.download = "area-crawl-opt-ins.csv";
        link.click();
        URL.revokeObjectURL(url);
      });
    }

    var invite = document.getElementById("co-invite-form");
    if (invite) {
      invite.addEventListener("submit", async function (ev) {
        if (demoOn()) return;
        ev.preventDefault();
        var email = document.getElementById("co-email").value.trim().toLowerCase();
        var err = document.getElementById("co-err");
        var ok = document.getElementById("co-ok");
        if (err) { err.textContent = ""; err.classList.remove("show"); }
        if (ok) { ok.textContent = ""; ok.classList.remove("show"); }
        var saved = await HCCrawl.client().rpc("organizer_add_co_organizer", {
          p_crawl_id: active,
          p_email: email,
          p_name: null
        });
        if (saved.error) {
          if (err) { err.textContent = saved.error.message || "Could not add that co-organizer."; err.classList.add("show"); }
          return;
        }
        document.getElementById("co-email").value = "";
        await loadTeam();
        renderLive();
        if (ok) { ok.textContent = "Co-organizer added. No email was sent. They sign in with that address."; ok.classList.add("show"); }
      });
    }
  });

  function copyDrawingText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return Promise.reject(new Error("Copy is not available in this browser."));
  }

  document.addEventListener("DOMContentLoaded", function () {
    var form = document.getElementById("drawing-form");
    if (form) {
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        Promise.resolve(onDrawSubmit()).catch(function (error) {
          setDrawingMessage("drawing-err", (error && error.message) || "Could not run the drawing.");
        });
      });
    }
    var copy = document.getElementById("drawing-copy");
    if (copy) {
      copy.addEventListener("click", function () {
        if (!drawingView.winners.length) {
          setDrawingMessage("drawing-err", "No winners to copy yet.");
          return;
        }
        var text = winnersText(drawingView.title, drawingView.crawlId, drawingView.winners);
        copyDrawingText(text).then(function () {
          setDrawingMessage("drawing-err", "");
          var count = drawingView.winners.length;
          setDrawingMessage("drawing-ok", "Copied " + count + (count === 1 ? " winner" : " winners") + " for this crawl.");
        }).catch(function () {
          setDrawingMessage("drawing-err", "Copy did not work in this browser. Download the CSV instead.");
        });
      });
    }
    var csv = document.getElementById("drawing-csv");
    if (csv) {
      csv.addEventListener("click", function () {
        if (!drawingView.winners.length) {
          setDrawingMessage("drawing-err", "No winners to download yet.");
          return;
        }
        var blob = new Blob([winnersCsv(drawingView.crawlId, drawingView.winners)], { type: "text/csv" });
        var url = URL.createObjectURL(blob);
        var link = document.createElement("a");
        var safe = String(drawingView.crawlId || "crawl").replace(/[^a-z0-9-]+/gi, "");
        link.href = url;
        link.download = "hometown-drawing-" + (safe || "crawl") + ".csv";
        link.click();
        URL.revokeObjectURL(url);
      });
    }
  });

  window.HCDrawing = {
    pickFromPool: pickFromPool,
    canDraw: canDraw,
    groupWinners: groupWinners,
    winnersCsv: winnersCsv,
    winnersText: winnersText,
    poolSentence: poolSentence,
    entryCountOf: entryCountOf,
    eligibleEntries: eligibleEntries,
    demoPools: DEMO_POOLS,
    demoSeed: DEMO_SEED
  };

  window.HCOrganizerScans = {
    rowsForCrawl: rowsForCrawl,
    renderFailureList: renderFailureList,
    renderFixList: renderFixList
  };
})();
