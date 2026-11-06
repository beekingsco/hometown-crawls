const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const migration = read("migrations/20261105200000_guest_leaderboard.sql");
const account = read("account.html");
const boardJs = read("assets/guest-leaderboard.js");
const storeHelp = read("account/store/help/index.html");
const orgHelp = read("account/organizer/help/index.html");

function sliceFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.ok(start > -1, `missing function ${name}`);
  const next = source.indexOf("\ncreate or replace function ", start + 1);
  const end = next === -1 ? source.length : next;
  return source.slice(start, end);
}

function loadBoard() {
  const sandbox = { URLSearchParams, URL, console, Intl, Date, location: { search: "" } };
  sandbox.window = sandbox;
  vm.runInNewContext(boardJs, sandbox);
  return sandbox.HCLeaderboard;
}

test("leaderboard migration is crawl-scoped and not granted to anon", () => {
  assert.match(migration, /create or replace function public\.shop_guest_leaderboard\(\s*p_listing uuid default null,\s*p_page integer default 1\s*\)/);
  assert.match(migration, /create or replace function public\.organizer_guest_leaderboard\(\s*p_crawl text,\s*p_page integer default 1\s*\)/);
  assert.match(migration, /private\.leaderboard_window\(v_count, p_page\)/);
  assert.doesNotMatch(migration, /p_all/);
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path to ''/);
  assert.match(migration, /l\.owner_user_id = v_uid/);
  assert.match(migration, /Only the shop owner can see this leaderboard/);
  assert.match(migration, /co\.crawl_id = v_crawl/);
  assert.match(migration, /o\.user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /co\.role in \('owner', 'organizer', 'co-organizer'\)/);
  assert.match(migration, /private\.assert_leaderboard_reader\(v_crawl\)/);
  assert.match(migration, /s\.crawl_id = v_crawl/);
  assert.match(migration, /j\.crawl_id = v_crawl/);
  assert.match(migration, /l\.is_paid/);
  assert.match(migration, /l\.is_approved/);
  assert.match(migration, /l\.is_visible/);
  assert.match(migration, /v_crawl in \('puy-coffee', 'arl-coffee'\) or v_listing_shops > 0/);
  assert.match(migration, /m\.status = 'active'/);
  assert.match(migration, /count\(distinct l\.business_id\)/);
  assert.match(migration, /distinct on \(s\.user_id, s\.business_id\)/);
  assert.doesNotMatch(migration, /s\.source/);
  assert.match(migration, /order by s\.user_id, s\.business_id, s\.claimed_at asc, s\.id asc/);
  assert.match(migration, /scored\.stamp_count desc/);
  assert.match(migration, /scored\.reached_at asc nulls last/);
  assert.match(migration, /numbered\.n = v_shop_total/);
  assert.match(migration, /\(entry->>'place'\)::integer > v_from/);
  assert.match(migration, /\(entry->>'place'\)::integer <= v_to/);
  assert.match(migration, /least\(bounded\.asked, bounded\.pages\) \* 50/);

  const shop = sliceFunction(migration, "public.shop_guest_leaderboard");
  assert.match(shop, /private\.guest_short_name/);
  assert.doesNotMatch(shop, /'email'/);
  assert.match(shop, /position\('@' in coalesce\(entry->>'profile_name', ''\)\)/);

  const organizer = sliceFunction(migration, "public.organizer_guest_leaderboard");
  assert.match(organizer, /'email', coalesce\(entry->>'email', ''\)/);
  assert.match(organizer, /private\.assert_leaderboard_reader\(v_crawl\)/);
  assert.doesNotMatch(organizer, /guest_short_name/);

  assert.match(migration, /grant execute on function public\.shop_guest_leaderboard\(uuid, integer\) to authenticated/);
  assert.match(migration, /grant execute on function public\.organizer_guest_leaderboard\(text, integer\) to authenticated/);
  assert.match(migration, /revoke all on function private\.leaderboard_window\(integer, integer\) from authenticated/);
  assert.match(migration, /revoke all on function private\.guest_leaderboard_payload\(text\) from authenticated/);
  assert.match(migration, /revoke all on function private\.guest_leaderboard_payload\(text\) from anon/);
  assert.match(migration, /revoke all on function private\.assert_leaderboard_reader\(text\) from authenticated/);
  assert.doesNotMatch(migration, /grant [^;]* to anon/);
  assert.doesNotMatch(migration, /service_role/);
  assert.doesNotMatch(migration, /create policy/i);
  assert.doesNotMatch(migration, /enable row level security/i);
  assert.doesNotMatch(migration, /user_metadata/);
});

test("account page keeps the leaderboard beside the weekly drawing", () => {
  assert.match(account, /id="store-leaderboard"/);
  assert.match(account, /id="store-board"/);
  assert.match(account, /id="guest-leaderboard"/);
  assert.match(account, /id="store-board-prev"/);
  assert.match(account, /id="store-board-next"/);
  assert.match(account, /id="store-board-page"/);
  assert.match(account, /id="org-board-prev"/);
  assert.match(account, /id="org-board-next"/);
  assert.match(account, /id="org-board-page"/);
  assert.match(account, /id="org-board-csv"/);
  assert.doesNotMatch(account, /store-board-all|org-board-all|Show all/);
  assert.match(account, /id="weekly-drawing"/);
  assert.match(account, /assets\/guest-leaderboard\.js\?v=guest-leaderboard-2/);
  assert.match(account, /assets\/guest-leaderboard\.css\?v=guest-leaderboard-2/);
  assert.match(account, /assets\/organizer-panel\.js\?v=daily-limit-1/);
  assert.doesNotMatch(account, /src="assets\/guest-leaderboard\.js"/);
  assert.doesNotMatch(boardJs, /service_role/);
  assert.match(storeHelp, /first name and a last initial/);
  assert.match(orgHelp, /Page 2 continues the rank/);
  assert.match(storeHelp, /50 guests per page/);
  assert.doesNotMatch(orgHelp, /Show all/);
  assert.doesNotMatch(storeHelp, /Show all/);
  assert.match(orgHelp, /A contributor cannot/);
  assert.doesNotMatch(sliceBetween(boardJs, "var DEMO_CRAWLS", "function demoOn"), /\u2014|\u2013/);
  assert.doesNotMatch(sliceBetween(storeHelp, 'id="leaderboard"', "If you get stuck"), /\u2014|\u2013/);
  assert.doesNotMatch(sliceBetween(orgHelp, 'id="guest-leaderboard"', 'id="links"'), /\u2014|\u2013/);
});

function sliceBetween(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + 1);
  assert.ok(from > -1 && to > from, `${start} .. ${end}`);
  return source.slice(from, to);
}

test("ranks one crawl by distinct shops and keeps the other crawl out", () => {
  const board = loadBoard();
  const coffee = board.demoBoard("puy-coffee");
  const summer = board.demoBoard("puy-summer-demo");

  assert.equal(coffee.shopTotal, 3);
  assert.equal(summer.shopTotal, 1);
  assert.equal(coffee.rows.map((row) => row.name).join("|"), [
    "Priya Shah",
    "Jordan Lee",
    "Avery Brooks",
    "Sam Ortiz",
    "Chris Nguyen",
    "Morgan Blake",
    "Noah Patel"
  ].join("|"));
  assert.equal(coffee.rows.map((row) => row.stamps).join(","), "3,3,2,2,1,0,0");
  assert.equal(coffee.rows[0].completedAt, "2026-11-02T18:30:00.000Z");
  assert.equal(coffee.rows[1].completedAt, "2026-11-04T16:10:00.000Z");
  assert.equal(coffee.rows[2].completedAt, "");
  assert.ok(coffee.rows[0].reachedAt < coffee.rows[1].reachedAt);

  assert.equal(summer.rows.map((row) => row.email).join("|"), [
    "riley.kim@example.com",
    "quinn.alvarez@example.com",
    "harper.diaz@example.com"
  ].join("|"));
  assert.equal(summer.rows[0].completedAt, "2026-11-08T17:00:00.000Z");
  assert.ok(summer.rows.every((row) => !coffee.rows.some((guest) => guest.email === row.email)));
  assert.ok(coffee.rows.every((row) => !summer.rows.some((guest) => guest.email === row.email)));

  const manualOnly = board.rankGuests([
    {
      userId: "paper",
      name: "Paper Guest",
      email: "paper@example.com",
      joinedAt: "2026-11-01T00:00:00.000Z",
      stamps: [{ id: "m1", businessId: "anthem", claimedAt: "2026-11-03T00:00:00.000Z", source: "manual" }]
    }
  ], 1);
  assert.equal(manualOnly[0].stamps, 1);
  assert.equal(manualOnly[0].completedAt, "2026-11-03T00:00:00.000Z");

  const extraShop = board.rankGuests([
    {
      userId: "extra",
      name: "Extra Shop",
      stamps: [
        { id: "e1", businessId: "a", claimedAt: "2026-11-01T00:00:00.000Z" },
        { id: "e2", businessId: "b", claimedAt: "2026-11-02T00:00:00.000Z" },
        { id: "e3", businessId: "c", claimedAt: "2026-11-04T00:00:00.000Z" }
      ]
    }
  ], 2);
  assert.equal(extraShop[0].stamps, 3);
  assert.equal(extraShop[0].completedAt, "2026-11-02T00:00:00.000Z");
  assert.equal(extraShop[0].reachedAt, "2026-11-04T00:00:00.000Z");
});

test("store names drop the email and the last name, organizer csv keeps both", () => {
  const board = loadBoard();
  assert.equal(board.shortName("Priya Shah"), "Priya S.");
  assert.equal(board.shortName("Cher"), "Cher");
  assert.equal(board.shortName("Mary Ann Smith"), "Mary S.");
  assert.equal(board.shortName("  "), "Guest");
  assert.equal(board.shortName("priya.shah@example.com"), "Guest");

  const coffee = board.demoBoard("puy-coffee");
  const store = board.storeRows(board.pageOf(coffee.rows, 1).rows);
  assert.equal(store[0].name, "Priya S.");
  assert.equal(store[1].name, "Jordan L.");
  assert.ok(store.every((row) => !("email" in row)));
  const storeHtml = board.boardMarkup(store, "store", coffee.shopTotal);
  assert.match(storeHtml, /Priya S\./);
  assert.match(storeHtml, /Completed/);
  assert.match(storeHtml, /lb-star/);
  assert.match(storeHtml, /3 of 3/);
  assert.doesNotMatch(storeHtml, /@/);
  assert.doesNotMatch(storeHtml, /Shah/);
  assert.doesNotMatch(storeHtml, /<th>Email<\/th>/);

  const when = board.formatPacific("2026-11-02T18:30:00.000Z");
  assert.match(when, /Nov 2, 2026/);
  assert.match(when, /10:30/);
  assert.match(when, /AM/);
  assert.match(storeHtml, /2026-11-02T18:30:00.000Z/);
  assert.match(storeHtml, /10:30/);

  const csv = board.leaderboardCsv(coffee.crawlId, coffee.rows, coffee.shopTotal);
  assert.match(csv, /^crawl_id,rank,name,email,stamps,shops,completed_at/);
  assert.match(csv, /puy-coffee/);
  assert.match(csv, /Priya Shah/);
  assert.match(csv, /priya\.shah@example\.com/);
  assert.match(csv, /10:30/);
  assert.doesNotMatch(csv, /riley\.kim@example\.com/);
  assert.doesNotMatch(board.leadSentence(coffee), /\u2014|\u2013/);
  assert.match(board.leadSentence(coffee), /Priya Shah finished first/);

  const many = Array.from({ length: 55 }, (_, index) => ({
    rank: index + 1,
    name: "Guest " + index,
    email: "guest" + index + "@example.com",
    stamps: 1,
    completedAt: ""
  }));
  const first = board.pageOf(many, 1);
  const second = board.pageOf(many, 2);
  const tooFar = board.pageOf(many, 9);
  assert.equal(first.pageCount, 2);
  assert.equal(first.rows.length, 50);
  assert.equal(first.rows[0].rank, 1);
  assert.equal(first.rows[49].rank, 50);
  assert.equal(second.page, 2);
  assert.equal(second.rows.length, 5);
  assert.equal(second.rows[0].rank, 51);
  assert.equal(second.rows[4].rank, 55);
  assert.equal(tooFar.page, 2);
  assert.equal(board.storeRows(second.rows).every((row) => !("email" in row)), true);
  assert.equal(board.storeRows(second.rows)[0].rank, 51);
  const later = board.leadSentence({ guestCount: 55, shopTotal: 3, rows: second.rows });
  assert.match(later, /55 guests have joined this crawl/);
  assert.doesNotMatch(later, /finished first/);
  assert.equal(board.TOP, 50);

  const empty = board.leadSentence({ guestCount: 0, shopTotal: 3, rows: [] });
  assert.match(empty, /No guests have joined this crawl yet/);
  assert.equal(
    board.plainError({ message: "Could not find the function public.shop_guest_leaderboard" }),
    "The leaderboard appears after the database update is applied."
  );
});

test("demo pages keep store names short and switch the organizer crawl", () => {
  const nodes = {};
  function make(id) {
    const node = {
      id,
      textContent: "",
      innerHTML: "",
      disabled: false,
      value: "",
      hidden: false,
      listeners: {},
      classList: {
        toggle() {},
        add() {},
        remove() {}
      },
      addEventListener(type, fn) {
        node.listeners[type] = fn;
      }
    };
    nodes[id] = node;
    return node;
  }
  [
    "store-board", "store-lead", "store-board-err", "store-board-demo",
    "store-board-prev", "store-board-next", "store-board-page",
    "org-board", "org-lead", "org-board-err", "org-board-demo",
    "org-board-prev", "org-board-next", "org-board-page", "org-board-csv",
    "org-crawl"
  ].forEach(make);
  nodes["org-crawl"].value = "puy-coffee";
  const listeners = [];
  const sandbox = {
    URLSearchParams,
    URL,
    console,
    Intl,
    Date,
    setInterval() { return 0; },
    clearInterval() {},
    location: { search: "?demo=1&tab=organizer" },
    document: {
      addEventListener(type, fn) {
        if (type === "DOMContentLoaded") listeners.push(fn);
      },
      getElementById(id) { return nodes[id] || null; },
      createElement() { return make("created"); },
      body: { appendChild() {}, removeChild() {} }
    }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(boardJs, sandbox);
  assert.equal(listeners.length, 1);
  listeners[0]();

  assert.match(nodes["store-board"].innerHTML, /Priya S\./);
  assert.match(nodes["store-board"].innerHTML, /3 of 3/);
  assert.doesNotMatch(nodes["store-board"].innerHTML, /@/);
  assert.equal(nodes["store-board-page"].textContent, "Page 1 of 1");
  assert.equal(nodes["store-board-prev"].disabled, true);
  assert.equal(nodes["store-board-next"].disabled, true);

  assert.match(nodes["org-board"].innerHTML, /Priya Shah/);
  assert.match(nodes["org-board"].innerHTML, /priya\.shah@example\.com/);
  assert.equal(nodes["org-board-page"].textContent, "Page 1 of 1");
  assert.doesNotMatch(nodes["org-board"].innerHTML, /Riley Kim/);

  nodes["org-crawl"].value = "puy-summer-demo";
  nodes["org-crawl"].listeners.change();
  assert.match(nodes["org-board"].innerHTML, /Riley Kim/);
  assert.match(nodes["org-board"].innerHTML, /riley\.kim@example\.com/);
  assert.doesNotMatch(nodes["org-board"].innerHTML, /Priya Shah/);
  assert.doesNotMatch(nodes["org-board"].innerHTML, /priya\.shah@example\.com/);
  assert.equal(nodes["org-board-page"].textContent, "Page 1 of 1");
});

test("demo shop totals follow the paid visible sample stores", () => {
  const sandbox = { window: {} };
  sandbox.window = sandbox;
  vm.runInNewContext(read("assets/config.js"), sandbox);
  const organizer = sandbox.__HC_ENV__.DEMO_ORGANIZER;
  function passportShops(crawl) {
    return (crawl.stores || []).filter((row) => row.paid && row.visible !== false).length;
  }
  const coffee = organizer.crawls.find((row) => row.id === "puy-coffee");
  const summer = organizer.crawls.find((row) => row.id === "puy-summer-demo");
  const board = loadBoard();
  assert.equal(board.demoBoard("puy-coffee").shopTotal, passportShops(coffee));
  assert.equal(board.demoBoard("puy-summer-demo").shopTotal, passportShops(summer));
  assert.equal(passportShops(coffee), 3);
  assert.equal(passportShops(summer), 1);
});
