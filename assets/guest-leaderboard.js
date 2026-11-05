/* Guest leaderboard for the Store tab and the Organizer tab.
   One crawl at a time. ?demo=1 uses the sample boards below and does not
   call the leaderboard RPCs. */
(function () {
  var TOP = 50;
  var ZONE = "America/Los_Angeles";

  // Sample guests for ?demo=1. Shop totals follow the demo organizer stores:
  // a paid shop that is still visible is on the passport. Main Street Roasters
  // and Valley Tea Room are unpaid, so they are not part of the card.
  // A later stamp at a shop the guest already has does not raise the count.
  var DEMO_CRAWLS = {
    "puy-coffee": {
      crawlId: "puy-coffee",
      title: "Puyallup Holiday Coffee Crawl",
      shopTotal: 3,
      guests: [
        {
          userId: "puy-priya",
          name: "Priya Shah",
          email: "priya.shah@example.com",
          joinedAt: "2026-10-28T16:00:00.000Z",
          stamps: [
            { id: "p1", businessId: "anthem", claimedAt: "2026-11-01T17:00:00.000Z", source: "digital" },
            { id: "p2", businessId: "pioneer", claimedAt: "2026-11-01T19:00:00.000Z", source: "digital" },
            { id: "p3", businessId: "meridian", claimedAt: "2026-11-02T18:30:00.000Z", source: "manual" },
            { id: "p4", businessId: "anthem", claimedAt: "2026-11-06T18:00:00.000Z", source: "manual" }
          ]
        },
        {
          userId: "puy-jordan",
          name: "Jordan Lee",
          email: "jordan.lee@example.com",
          joinedAt: "2026-10-29T16:00:00.000Z",
          stamps: [
            { id: "j1", businessId: "anthem", claimedAt: "2026-11-02T20:00:00.000Z", source: "digital" },
            { id: "j2", businessId: "pioneer", claimedAt: "2026-11-03T18:00:00.000Z", source: "digital" },
            { id: "j3", businessId: "meridian", claimedAt: "2026-11-04T16:10:00.000Z", source: "manual" }
          ]
        },
        {
          userId: "puy-avery",
          name: "Avery Brooks",
          email: "avery.brooks@example.com",
          joinedAt: "2026-10-30T16:00:00.000Z",
          stamps: [
            { id: "a1", businessId: "anthem", claimedAt: "2026-11-03T15:00:00.000Z", source: "digital" },
            { id: "a2", businessId: "pioneer", claimedAt: "2026-11-03T22:00:00.000Z", source: "digital" }
          ]
        },
        {
          userId: "puy-sam",
          name: "Sam Ortiz",
          email: "sam.ortiz@example.com",
          joinedAt: "2026-10-30T18:00:00.000Z",
          stamps: [
            { id: "s1", businessId: "meridian", claimedAt: "2026-11-04T18:00:00.000Z", source: "digital" },
            { id: "s2", businessId: "anthem", claimedAt: "2026-11-05T20:00:00.000Z", source: "manual" }
          ]
        },
        {
          userId: "puy-chris",
          name: "Chris Nguyen",
          email: "chris.nguyen@example.com",
          joinedAt: "2026-11-01T16:00:00.000Z",
          stamps: [
            { id: "c1", businessId: "anthem", claimedAt: "2026-11-05T21:00:00.000Z", source: "digital" }
          ]
        },
        {
          userId: "puy-morgan",
          name: "Morgan Blake",
          email: "morgan.blake@example.com",
          joinedAt: "2026-11-01T16:00:00.000Z",
          stamps: []
        },
        {
          userId: "puy-noah",
          name: "Noah Patel",
          email: "noah.patel@example.com",
          joinedAt: "2026-11-02T16:00:00.000Z",
          stamps: []
        }
      ]
    },
    "puy-summer-demo": {
      crawlId: "puy-summer-demo",
      title: "Puyallup Summer Sip",
      shopTotal: 1,
      guests: [
        {
          userId: "summer-riley",
          name: "Riley Kim",
          email: "riley.kim@example.com",
          joinedAt: "2026-11-06T16:00:00.000Z",
          stamps: [
            { id: "r1", businessId: "anthem", claimedAt: "2026-11-08T17:00:00.000Z", source: "digital" }
          ]
        },
        {
          userId: "summer-quinn",
          name: "Quinn Alvarez",
          email: "quinn.alvarez@example.com",
          joinedAt: "2026-11-06T18:00:00.000Z",
          stamps: []
        },
        {
          userId: "summer-harper",
          name: "Harper Diaz",
          email: "harper.diaz@example.com",
          joinedAt: "2026-11-07T16:00:00.000Z",
          stamps: []
        }
      ]
    }
  };

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

  function shortName(name) {
    var clean = String(name || "").trim().replace(/\s+/g, " ");
    if (!clean || clean.indexOf("@") !== -1) return "Guest";
    var parts = clean.split(" ");
    if (parts.length === 1) return parts[0];
    return parts[0] + " " + parts[parts.length - 1].charAt(0).toUpperCase() + ".";
  }

  function rankGuests(guests, shopTotal) {
    var total = Math.max(0, Number(shopTotal) || 0);
    var ranked = (guests || []).map(function (guest) {
      var first = {};
      (guest.stamps || []).forEach(function (stamp) {
        var businessId = String((stamp && (stamp.businessId || stamp.business_id)) || "").trim();
        if (!businessId) return;
        var at = Date.parse(stamp.claimedAt || stamp.claimed_at);
        if (isNaN(at)) return;
        var stampId = String((stamp && stamp.id) || "");
        var prev = first[businessId];
        if (!prev || at < prev.at || (at === prev.at && stampId < prev.stampId)) {
          first[businessId] = { at: at, stampId: stampId };
        }
      });
      var hits = Object.keys(first).map(function (id) {
        return { businessId: id, at: first[id].at, stampId: first[id].stampId };
      });
      hits.sort(function (a, b) {
        if (a.at !== b.at) return a.at - b.at;
        if (a.stampId < b.stampId) return -1;
        if (a.stampId > b.stampId) return 1;
        return 0;
      });
      var stamps = hits.length;
      var reachedAt = stamps ? new Date(hits[hits.length - 1].at).toISOString() : "";
      var completedAt = total > 0 && stamps >= total ? new Date(hits[total - 1].at).toISOString() : "";
      return {
        userId: String(guest.userId || guest.user_id || ""),
        name: String(guest.name || "Guest"),
        email: String(guest.email || ""),
        stamps: stamps,
        reachedAt: reachedAt,
        completedAt: completedAt,
        joinedAt: String(guest.joinedAt || guest.joined_at || "")
      };
    });
    ranked.sort(function (a, b) {
      if (b.stamps !== a.stamps) return b.stamps - a.stamps;
      if (a.stamps > 0 || b.stamps > 0) {
        if (!a.reachedAt) return 1;
        if (!b.reachedAt) return -1;
        if (a.reachedAt !== b.reachedAt) return a.reachedAt < b.reachedAt ? -1 : 1;
      }
      if (a.joinedAt !== b.joinedAt) {
        if (!a.joinedAt) return 1;
        if (!b.joinedAt) return -1;
        return a.joinedAt < b.joinedAt ? -1 : 1;
      }
      if (a.userId < b.userId) return -1;
      if (a.userId > b.userId) return 1;
      return 0;
    });
    return ranked.map(function (row, index) {
      return {
        rank: index + 1,
        userId: row.userId,
        name: row.name,
        email: row.email,
        stamps: row.stamps,
        completedAt: row.completedAt,
        reachedAt: row.reachedAt
      };
    });
  }

  function storeRows(rows) {
    return (rows || []).map(function (row) {
      return {
        rank: row.rank,
        name: shortName(row.name),
        stamps: row.stamps,
        completedAt: row.completedAt || ""
      };
    });
  }

  function pageOf(rows, page) {
    var list = rows || [];
    var pages = Math.max(1, Math.ceil(list.length / TOP));
    var current = Math.min(Math.max(Number(page) || 1, 1), pages);
    var start = (current - 1) * TOP;
    return {
      page: current,
      pageCount: pages,
      rows: list.slice(start, start + TOP)
    };
  }

  function formatPacific(iso) {
    if (!iso) return "";
    var date = new Date(iso);
    if (isNaN(date.getTime())) return "";
    try {
      return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: ZONE,
        timeZoneName: "short"
      }).format(date);
    } catch (e) {
      return date.toLocaleString("en-US");
    }
  }

  function leadSentence(board) {
    var guests = Number(board && board.guestCount) || 0;
    var shops = Number(board && board.shopTotal) || 0;
    var rows = (board && board.rows) || [];
    var top = null;
    for (var i = 0; i < rows.length; i++) {
      if (Number(rows[i].rank) === 1) { top = rows[i]; break; }
    }
    if (!guests) {
      return "No guests have joined this crawl yet. When they do, their stamps will line up here.";
    }
    var people = guests === 1
      ? "1 guest has joined this crawl."
      : guests + " guests have joined this crawl.";
    if (!shops) {
      return people + " Shops are not on the passport yet, so nobody can finish a card.";
    }
    var card = shops === 1
      ? "The passport has 1 shop, so one stamp fills the card."
      : "The passport has " + shops + " shops, so a full card is " + shops + " of " + shops + ".";
    if (top && top.completedAt) {
      return people + " " + card + " " + top.name + " finished first.";
    }
    if (top) {
      return people + " " + card + " " + top.name + " is out in front with " + top.stamps + " of " + shops + ".";
    }
    return people + " " + card;
  }

  function csvCell(value) {
    return '"' + String(value == null ? "" : value).replace(/"/g, '""') + '"';
  }

  function leaderboardCsv(crawlId, rows, shopTotal) {
    var lines = ["crawl_id,rank,name,email,stamps,shops,completed_at"];
    (rows || []).forEach(function (row) {
      lines.push([
        crawlId,
        row.rank,
        row.name,
        row.email,
        row.stamps,
        shopTotal,
        row.completedAt ? formatPacific(row.completedAt) : ""
      ].map(csvCell).join(","));
    });
    return lines.join("\n");
  }

  function demoBoard(crawlId) {
    var crawl = DEMO_CRAWLS[crawlId];
    if (!crawl) {
      return {
        crawlId: crawlId || "",
        title: "",
        shopTotal: 0,
        guestCount: 0,
        rows: []
      };
    }
    var rows = rankGuests(crawl.guests, crawl.shopTotal);
    return {
      crawlId: crawl.crawlId,
      title: crawl.title,
      shopTotal: crawl.shopTotal,
      guestCount: rows.length,
      rows: rows
    };
  }

  function starIcon() {
    return '<svg class="lb-star" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 2.6 14.7 8l6 .9-4.4 4.2 1 6L12 16.8 6.7 19.1l1-6L3.3 8.9 9.3 8z"/></svg>';
  }

  function completedHtml(iso) {
    if (!iso) return '<span class="muted">In progress</span>';
    return '<span class="lb-complete">' + starIcon() +
      '<span>Completed <time datetime="' + esc(iso) + '">' + esc(formatPacific(iso)) + "</time></span></span>";
  }

  function countText(stamps, shopTotal) {
    return String(stamps) + " of " + String(shopTotal);
  }

  function tableRow(row, mode, shopTotal) {
    var email = mode === "organizer"
      ? "<td class=\"lb-email\">" + esc(row.email) + "</td>"
      : "";
    return "<tr><td class=\"lb-rank\">" + esc(row.rank) + "</td><td><b>" + esc(row.name) +
      "</b></td>" + email + "<td class=\"lb-count\">" + esc(countText(row.stamps, shopTotal)) +
      "</td><td>" + completedHtml(row.completedAt) + "</td></tr>";
  }

  function cardRow(row, mode, shopTotal) {
    var email = mode === "organizer" && row.email
      ? '<p class="record-email">' + esc(row.email) + "</p>"
      : "";
    return '<article class="record-card"><b class="record-name"><span class="lb-rank">' + esc(row.rank) +
      "</span> " + esc(row.name) + "</b>" + email +
      '<div class="record-chips"><span class="chip">' + esc(countText(row.stamps, shopTotal)) +
      "</span></div><p class=\"small mt-1\">" + completedHtml(row.completedAt) + "</p></article>";
  }

  function boardMarkup(rows, mode, shopTotal) {
    var headEmail = mode === "organizer" ? "<th>Email</th>" : "";
    var body = (rows || []).map(function (row) {
      return tableRow(row, mode, shopTotal);
    }).join("");
    var cards = (rows || []).map(function (row) {
      return cardRow(row, mode, shopTotal);
    }).join("");
    var empty = rows && rows.length
      ? ""
      : '<p class="muted small mt-2">No guests have joined this crawl yet.</p>';
    var table = '<div class="table-wrap guest-table-wrap mt-2"><table class="data"><thead><tr><th>Rank</th><th>Name</th>' +
      headEmail + "<th>Stamps</th><th>Card</th></tr></thead><tbody>" + body + "</tbody></table></div>" +
      '<div class="record-cards mt-2">' + cards + "</div>" + empty;
    return table;
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text || "";
  }

  function setMessage(id, text) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("show", !!text);
  }

  function paintDemoNote(id, text) {
    var el = document.getElementById(id);
    if (!el) return;
    if (!text) {
      el.textContent = "";
      el.classList.add("hidden");
      return;
    }
    el.textContent = text;
    el.classList.remove("hidden");
  }

  var orgPage = 1;
  var orgCrawl = "";
  var orgToken = 0;
  var storePage = 1;
  var storeToken = 0;

  function shownRows(board, mode) {
    if (mode === "store") return storeRows(board.rows);
    return board.rows || [];
  }

  function paintPager(prefix, page, pages) {
    var prev = document.getElementById(prefix + "-board-prev");
    var next = document.getElementById(prefix + "-board-next");
    var label = document.getElementById(prefix + "-board-page");
    var current = Math.max(1, Number(page) || 1);
    var total = Math.max(current, Number(pages) || 1);
    if (prev) prev.disabled = current <= 1;
    if (next) next.disabled = current >= total;
    if (label) label.textContent = "Page " + current + " of " + total;
  }

  function paintBoard(prefix, board, mode) {
    var shown = shownRows(board, mode);
    var lead = document.getElementById(prefix + "-lead");
    if (lead) {
      lead.textContent = leadSentence({
        guestCount: board.guestCount,
        shopTotal: board.shopTotal,
        rows: shown
      });
    }
    var box = document.getElementById(prefix + "-board");
    if (box) box.innerHTML = boardMarkup(shown, mode, board.shopTotal);
    paintPager(prefix, board.page || 1, board.pageCount || 1);
  }

  function pagedBoard(full, page) {
    var windowed = pageOf(full.rows, page);
    return {
      crawlId: full.crawlId,
      title: full.title,
      shopTotal: full.shopTotal,
      guestCount: full.guestCount,
      page: windowed.page,
      pageCount: windowed.pageCount,
      rows: windowed.rows
    };
  }

  function paintStoreDemo() {
    var board = pagedBoard(demoBoard("puy-coffee"), storePage);
    storePage = board.page;
    paintDemoNote("store-board-demo", "DEMO DATA. Sample guests for " + (board.title || "this crawl") + ". This is not the live board.");
    paintBoard("store", board, "store");
    setMessage("store-board-err", "");
  }

  function paintOrganizerDemo(crawlId) {
    var full = demoBoard(crawlId);
    var board = pagedBoard(full, orgPage);
    orgPage = board.page;
    var title = full.title || "this crawl";
    paintDemoNote("org-board-demo", full.title
      ? "DEMO DATA. Sample guests for " + title + ". This is not the live board."
      : "DEMO DATA. This sample does not include that crawl.");
    paintBoard("org", board, "organizer");
    setMessage("org-board-err", "");
  }

  function plainError(error) {
    var raw = String((error && error.message) || error || "");
    if (/shop_guest_leaderboard|organizer_guest_leaderboard|schema cache|does not exist|could not find the function/i.test(raw)) {
      return "The leaderboard appears after the database update is applied.";
    }
    return raw.replace(/^ERROR:\s*/i, "").trim() || "The leaderboard could not be loaded.";
  }

  function normalizeLive(data) {
    var rows = ((data && data.rows) || []).map(function (row) {
      return {
        rank: Number(row.rank) || 0,
        name: String(row.name || "Guest"),
        email: String(row.email || ""),
        stamps: Number(row.stamps) || 0,
        completedAt: row.completed_at || row.completedAt || ""
      };
    });
    return {
      crawlId: String((data && data.crawl_id) || ""),
      title: String((data && data.crawl_name) || ""),
      shopTotal: Number(data && data.shop_total) || 0,
      guestCount: Number(data && data.guest_count) || rows.length,
      page: Number(data && data.page) || 1,
      pageCount: Number(data && data.page_count) || 1,
      rows: rows
    };
  }

  function client() {
    return window.HCCrawl && HCCrawl.client && HCCrawl.client();
  }

  async function signedIn() {
    if (!window.HCCrawl || !HCCrawl.getSession) return null;
    var session = await HCCrawl.getSession();
    if (!session || !session.user || session.user.is_anonymous || !session.user.email) return null;
    return session;
  }

  async function loadStoreLive() {
    var token = ++storeToken;
    if (!(await signedIn())) {
      setText("store-lead", "Sign in as the shop owner to see guests on your crawl.");
      return;
    }
    var db = client();
    if (!db) return;
    var listings = await db.rpc("shop_my_listings");
    if (token !== storeToken) return;
    if (listings.error || !listings.data || !listings.data.length) return;
    var listing = listings.data[0];
    var res = await db.rpc("shop_guest_leaderboard", {
      p_listing: listing.listing_id,
      p_page: storePage
    });
    if (token !== storeToken) return;
    if (res.error) {
      setText("store-lead", "");
      setMessage("store-board-err", plainError(res.error));
      return;
    }
    var board = normalizeLive(res.data || {});
    if (board.crawlId && listing.crawl_id && board.crawlId !== listing.crawl_id) {
      setMessage("store-board-err", "That board was for a different crawl, so it was not shown here.");
      return;
    }
    setMessage("store-board-err", "");
    paintDemoNote("store-board-demo", "");
    storePage = board.page || storePage;
    paintBoard("store", board, "store");
  }

  async function loadOrganizerLive(crawlId) {
    var token = ++orgToken;
    var requested = crawlId;
    if (!requested) return;
    if (!(await signedIn())) return;
    var db = client();
    if (!db) return;
    setText("org-lead", "Loading guests for this crawl.");
    var res = await db.rpc("organizer_guest_leaderboard", {
      p_crawl: requested,
      p_page: orgPage
    });
    if (token !== orgToken) return;
    var picker = document.getElementById("org-crawl");
    if (picker && picker.value && picker.value !== requested) return;
    if (res.error) {
      setText("org-lead", "");
      var box = document.getElementById("org-board");
      if (box) box.innerHTML = "";
      setMessage("org-board-err", plainError(res.error));
      paintPager("org", 1, 1);
      return;
    }
    var board = normalizeLive(res.data || {});
    if (board.crawlId && board.crawlId !== requested) {
      setMessage("org-board-err", "That board was for a different crawl, so it was not shown here.");
      return;
    }
    setMessage("org-board-err", "");
    paintDemoNote("org-board-demo", "");
    orgPage = board.page || orgPage;
    paintBoard("org", board, "organizer");
    orgCrawl = requested;
  }

  function currentOrganizerCrawl() {
    var picker = document.getElementById("org-crawl");
    return picker && picker.value ? picker.value : "";
  }

  function refreshOrganizer() {
    var id = currentOrganizerCrawl();
    if (!id) return;
    if (id !== orgCrawl) orgPage = 1;
    orgCrawl = id;
    if (demoOn()) {
      paintOrganizerDemo(id);
      return;
    }
    loadOrganizerLive(id);
  }

  function downloadText(filename, text) {
    var blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function csvName(crawlId) {
    var safe = String(crawlId || "crawl").replace(/[^a-z0-9-]+/gi, "");
    return "hometown-crawls-leaderboard-" + (safe || "crawl") + ".csv";
  }

  async function downloadOrganizerCsv() {
    var id = currentOrganizerCrawl();
    if (demoOn()) {
      var board = demoBoard(id);
      downloadText(csvName(board.crawlId), leaderboardCsv(board.crawlId, board.rows, board.shopTotal));
      if (window.HC) HC.toast("Leaderboard CSV downloaded");
      return;
    }
    var db = client();
    if (!db || !(await signedIn())) return;
    var page = 1;
    var rows = [];
    var shopTotal = 0;
    var crawlId = id;
    var guard = 0;
    while (guard < 200) {
      guard += 1;
      var res = await db.rpc("organizer_guest_leaderboard", { p_crawl: id, p_page: page });
      if (res.error) {
        setMessage("org-board-err", plainError(res.error));
        return;
      }
      var board = normalizeLive(res.data || {});
      if (board.crawlId && board.crawlId !== id) {
        setMessage("org-board-err", "That board was for a different crawl, so it was not downloaded.");
        return;
      }
      crawlId = board.crawlId || id;
      shopTotal = board.shopTotal;
      rows = rows.concat(board.rows);
      if (!board.rows.length || rows.length >= board.guestCount || page >= board.pageCount) break;
      page += 1;
    }
    downloadText(csvName(crawlId), leaderboardCsv(crawlId, rows, shopTotal));
    if (window.HC) HC.toast("Leaderboard CSV downloaded");
  }

  function bindPager(prefix, readPage, writePage, reload) {
    var prev = document.getElementById(prefix + "-board-prev");
    var next = document.getElementById(prefix + "-board-next");
    if (prev) {
      prev.addEventListener("click", function () {
        if (readPage() <= 1) return;
        writePage(readPage() - 1);
        reload();
      });
    }
    if (next) {
      next.addEventListener("click", function () {
        writePage(readPage() + 1);
        reload();
      });
    }
  }

  function bind() {
    bindPager("store", function () { return storePage; }, function (page) { storePage = page; }, function () {
      if (demoOn()) paintStoreDemo();
      else loadStoreLive();
    });
    bindPager("org", function () { return orgPage; }, function (page) { orgPage = page; }, function () {
      if (demoOn()) paintOrganizerDemo(currentOrganizerCrawl());
      else loadOrganizerLive(currentOrganizerCrawl());
    });
    var csv = document.getElementById("org-board-csv");
    if (csv) csv.addEventListener("click", function () { downloadOrganizerCsv(); });
    var picker = document.getElementById("org-crawl");
    if (picker) {
      picker.addEventListener("change", function () {
        orgPage = 1;
        orgCrawl = "";
        refreshOrganizer();
      });
    }
  }

  function watchOrganizer() {
    refreshOrganizer();
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;
      var id = currentOrganizerCrawl();
      if (id && id !== orgCrawl) refreshOrganizer();
      if ((id && orgCrawl === id) || tries > 40) clearInterval(timer);
    }, 250);
  }

  if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", function () {
      if (!document.getElementById("store-board") && !document.getElementById("org-board")) return;
      bind();
      if (demoOn()) {
        paintStoreDemo();
        watchOrganizer();
        return;
      }
      loadStoreLive();
      watchOrganizer();
    });
  }

  window.HCLeaderboard = {
    TOP: TOP,
    shortName: shortName,
    rankGuests: rankGuests,
    storeRows: storeRows,
    pageOf: pageOf,
    formatPacific: formatPacific,
    leadSentence: leadSentence,
    leaderboardCsv: leaderboardCsv,
    demoBoard: demoBoard,
    demoCrawls: DEMO_CRAWLS,
    boardMarkup: boardMarkup,
    plainError: plainError
  };
})();
