const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const migration = read("migrations/20261105180000_organizer_weekly_drawing.sql");
const weighted = read("migrations/20261105193000_organizer_drawing_weighted_entries.sql");
const account = read("account.html");
const organizer = read("assets/organizer-panel.js");
const help = read("account/organizer/help/index.html");

function sliceFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.ok(start > -1, `missing function ${name}`);
  const next = source.indexOf("\ncreate or replace function ", start + 1);
  const end = next === -1 ? source.length : next;
  return source.slice(start, end);
}

test("weekly drawing migration stays on one crawl and is not granted to anon", () => {
  assert.match(migration, /create table if not exists public\.crawl_drawing_winners/);
  assert.match(migration, /primary key \(crawl_id, user_id\)/);
  assert.match(migration, /email text not null/);
  assert.match(migration, /display_name text not null/);
  assert.match(migration, /label text/);
  assert.match(migration, /drawn_at timestamptz not null/);
  assert.match(migration, /drawn_by uuid not null/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.crawl_drawing_winners from anon/);
  assert.match(migration, /revoke all on table public\.crawl_drawing_winners from authenticated/);
  assert.doesNotMatch(migration, /service_role/);
  assert.doesNotMatch(migration, /grant [^;]* to anon/);
  assert.doesNotMatch(migration, /create policy/i);

  for (const name of ["organizer_drawing_status", "organizer_draw_winners"]) {
    const body = sliceFunction(migration, `public.${name}`);
    assert.match(body, /security definer/);
    assert.match(body, /set search_path to ''/);
    assert.match(body, /private\.assert_crawl_drawer\(v_crawl\)/);
    assert.match(body, /j\.crawl_id = v_crawl/);
    assert.match(body, /w\.crawl_id = v_crawl/);
    assert.match(body, /w\.user_id = j\.user_id/);
  }

  const draw = sliceFunction(migration, "public.organizer_draw_winners");
  assert.match(draw, /order by random\(\)/);
  assert.match(draw, /pg_advisory_xact_lock\(hashtext\('hc-drawing'\), hashtext\(v_crawl\)\)/);
  assert.match(draw, /from public\.crawl_joins j/);
  assert.doesNotMatch(draw, /from public\.stamps/);
  assert.match(migration, /co\.role in \('owner', 'organizer', 'co-organizer'\)/);
  assert.match(migration, /co\.crawl_id = v_crawl/);
  assert.match(migration, /o\.user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /grant execute on function public\.organizer_drawing_status\(text\) to authenticated/);
  assert.match(migration, /grant execute on function public\.organizer_draw_winners\(text, integer, text\) to authenticated/);
  assert.match(migration, /revoke all on function private\.assert_crawl_drawer\(text\) from authenticated/);
  assert.match(migration, /revoke all on function private\.drawing_winners_json\(text\) from authenticated/);
  assert.match(migration, /No one is left in this drawing/);
  assert.doesNotMatch(migration, /delete from public\.crawl_drawing_winners/i);
});

test("weighted entries replace the draw functions and keep the winners table", () => {
  assert.match(weighted, /add column if not exists entry_count integer/);
  assert.match(weighted, /create or replace function private\.drawing_entry_count\(p_crawl text, p_user uuid\)/);
  assert.match(weighted, /create or replace function public\.organizer_drawing_status\(p_crawl text\)/);
  assert.match(weighted, /create or replace function public\.organizer_draw_winners/);
  assert.doesNotMatch(weighted, /drop table/i);
  assert.doesNotMatch(weighted, /service_role/);
  assert.doesNotMatch(weighted, /grant [^;]* to anon/);

  const weight = sliceFunction(weighted, "private.drawing_entry_count");
  const weightBody = weight.slice(weight.indexOf("as $function$"), weight.indexOf("$function$;"));
  assert.match(weightBody, /1 \+/);
  assert.match(weightBody, /count\(distinct s\.business_id\)/);
  assert.match(weightBody, /s\.crawl_id = p_crawl/);
  assert.match(weightBody, /s\.user_id = p_user/);
  assert.match(weightBody, /from public\.stamps s/);
  assert.doesNotMatch(weightBody, /\bsource\b/);

  const draw = sliceFunction(weighted, "public.organizer_draw_winners");
  assert.match(draw, /-ln\(greatest\(random\(\), 1e-12::double precision\)\)/);
  assert.match(draw, /\/ base\.entry_count::double precision/);
  assert.match(draw, /order by weighted\.draw_key, weighted\.user_id/);
  assert.match(draw, /j\.crawl_id = v_crawl/);
  assert.match(draw, /w\.crawl_id = v_crawl/);
  assert.match(draw, /w\.user_id = j\.user_id/);
  assert.match(draw, /entry_count/);
  assert.match(draw, /private\.assert_crawl_drawer\(v_crawl\)/);
  assert.doesNotMatch(draw, /order by random\(\)/);

  const status = sliceFunction(weighted, "public.organizer_drawing_status");
  assert.match(status, /'entry_count', v_entries/);
  assert.match(status, /private\.drawing_entry_count\(v_crawl, j\.user_id\)/);
  assert.match(status, /j\.crawl_id = v_crawl/);
  assert.match(weighted, /'entry_count', dw\.entry_count/);
  assert.match(weighted, /grant execute on function public\.organizer_draw_winners\(text, integer, text\) to authenticated/);
  assert.match(weighted, /grant execute on function public\.organizer_drawing_status\(text\) to authenticated/);
});

test("organizer tab draws for the selected crawl and cache-busts the script", () => {
  assert.match(account, /id="weekly-drawing"/);
  assert.match(account, /id="drawing-pool"/);
  assert.match(account, /id="drawing-count"/);
  assert.match(account, /id="drawing-label"/);
  assert.match(account, /placeholder="Week 1"/);
  assert.match(account, /id="drawing-submit"/);
  assert.match(account, /id="drawing-copy"/);
  assert.match(account, /id="drawing-csv"/);
  assert.match(account, /id="drawing-history"/);
  assert.match(account, /Everyone who joined gets 1 entry, plus 1 more for each shop stamped\./);
  assert.match(account, /assets\/organizer-panel\.js\?v=stamp-fix-1/);
  assert.doesNotMatch(account, /src="assets\/organizer-panel\.js"/);
  assert.match(organizer, /organizer_drawing_status"/);
  assert.match(organizer, /organizer_draw_winners"/);
  assert.match(organizer, /p_crawl: crawl\.crawl_id/);
  assert.match(organizer, /p_crawl: crawlId/);
  assert.match(organizer, /p_count: count/);
  assert.match(organizer, /p_label: label \|\| null/);
  assert.match(organizer, /await loadDrawing\(\)/);
  assert.match(organizer, /data\.crawl_id !== crawlId/);
  assert.doesNotMatch(organizer, /service_role/);
  assert.doesNotMatch(sliceBetween(organizer, "var DEMO_POOLS", "function fixture"), /\u2014/);

  assert.match(help, /Pick winners for the week/);
  assert.match(help, /Everyone who joined gets 1 entry, plus 1 more for each shop stamped\./);
  assert.match(help, /The names are picked in the database/);
  assert.match(help, /A contributor cannot/);
  assert.doesNotMatch(help, /\u2014/);
});

function sliceBetween(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + 1);
  assert.ok(from > -1 && to > from);
  return source.slice(from, to);
}

test("a draw cannot reuse a winner or cross into another crawl", () => {
  const drawing = loadDrawingApi();
  assert.equal(drawing.canDraw("owner"), true);
  assert.equal(drawing.canDraw("organizer"), true);
  assert.equal(drawing.canDraw("co-organizer"), true);
  assert.equal(drawing.canDraw("contributor"), false);
  assert.equal(drawing.canDraw("viewer"), false);
  assert.equal(drawing.canDraw(""), false);

  const coffee = drawing.demoPools["puy-coffee"];
  const summer = drawing.demoPools["puy-summer-demo"];
  const already = drawing.demoSeed["puy-coffee"];
  const picked = drawing.pickFromPool(coffee, already, 5, () => 0);
  assert.equal(picked.length, 5);
  assert.equal(new Set(picked.map((row) => row.userId)).size, 5);
  assert.ok(picked.every((row) => row.userId !== "puy-maya"));
  assert.ok(picked.every((row) => !summer.some((person) => person.userId === row.userId)));
  const weightedPick = drawing.pickFromPool(coffee, already, 2, () => 0.2);
  assert.equal(weightedPick.map((row) => row.userId).join(","), "puy-noah,puy-priya");
  assert.equal(weightedPick[0].entryCount, 5);
  assert.equal(weightedPick[1].entryCount, 3);
  assert.equal(drawing.eligibleEntries(coffee, already), 12);
  assert.equal(drawing.pickFromPool(summer, already, 2, () => 0).length, 2);
  assert.equal(
    drawing.pickFromPool(summer, [{ userId: "summer-riley" }], 3, () => 0).map((row) => row.userId).sort().join(","),
    "summer-harper,summer-quinn"
  );

  const csv = drawing.winnersCsv("puy-coffee", already.map((row) => ({
    label: row.label,
    displayName: row.displayName,
    email: row.email,
    entryCount: row.entryCount,
    drawnAt: row.drawnAt
  })));
  assert.match(csv, /^crawl_id,label,name,email,entries,drawn_at/);
  assert.match(csv, /puy-coffee/);
  assert.match(csv, /maya\.chen@example\.com/);
  assert.match(csv, /,"4",/);
  assert.doesNotMatch(csv, /riley\.kim@example\.com/);
  assert.match(drawing.poolSentence(399, 397, 820), /399 people have joined this crawl/);
  assert.match(drawing.poolSentence(399, 397, 820), /397 people are still in the drawing, with 820 entries/);
  assert.doesNotMatch(drawing.poolSentence(6, 5, 12), /\u2014/);

  const groups = drawing.groupWinners([
    { label: "Week 1", displayName: "Maya Chen", drawnAt: "2026-11-02T18:00:00.000Z" },
    { label: "Week 2", displayName: "Riley Kim", drawnAt: "2026-11-09T18:00:00.000Z" }
  ]);
  assert.equal(Array.from(groups.map((group) => group.label)).join("|"), "Week 2|Week 1");
  assert.equal(groups[0].rows.map((row) => row.displayName).join("|"), "Riley Kim");
});

test("demo drawing keeps each crawl's winners on that crawl", () => {
  const seen = {};
  function make(id) {
    const node = {
      id,
      value: id === "drawing-count" ? "1" : "",
      textContent: "",
      innerHTML: "",
      hidden: false,
      disabled: false,
      style: {},
      children: [],
      classes: {},
      listeners: {},
      classList: {
        toggle(name, on) { node.classes[name] = on; },
        add(name) { node.classes[name] = true; },
        remove(name) { node.classes[name] = false; },
        contains(name) { return !!node.classes[name]; }
      },
      append() {
        for (const child of arguments) node.children.push(child);
      },
      replaceChildren() {
        node.children = [];
      },
      addEventListener(type, fn) {
        node.listeners[type] = node.listeners[type] || [];
        node.listeners[type].push(fn);
      }
    };
    seen[id] = node;
    return node;
  }
  const listeners = [];
  const sandbox = {
    URLSearchParams,
    URL,
    console,
    Math,
    Date,
    localStorage: {
      getItem() { return null; },
      setItem() {}
    },
    location: { search: "?demo=1&tab=organizer" },
    document: {
      activeElement: null,
      addEventListener(type, fn) {
        if (type === "DOMContentLoaded") listeners.push(fn);
      },
      getElementById(id) { return seen[id] || null; },
      createElement() { return make("created-" + Math.random()); }
    }
  };
  sandbox.window = sandbox;
  sandbox.window.__HC_ENV__ = {
    DEMO_ORGANIZER: {
      person: { name: "Bryan Reynolds", email: "bryan@myanthemcoffee.com", role: "organizer" },
      crawls: [
        { id: "puy-coffee", title: "Puyallup Holiday Coffee Crawl", starts: "2026-11-01", ends: "2026-12-31", stores: [] },
        { id: "puy-summer-demo", title: "Puyallup Summer Sip", starts: "2027-06-01", ends: "2027-08-31", stores: [] }
      ]
    }
  };
  [
    "panel-organizer", "org-crawl", "org-title", "org-start", "org-end", "org-video", "org-who",
    "org-total-stores", "org-total-paid", "org-total-unpaid", "org-total-scans", "org-stores", "co-list",
    "drawing-pool", "drawing-history", "drawing-form", "drawing-locked", "drawing-demo", "drawing-history-note",
    "drawing-copy", "drawing-csv", "drawing-count", "drawing-label", "drawing-ok", "drawing-err"
  ].forEach(make);
  vm.runInNewContext(organizer, sandbox, { filename: "assets/organizer-panel.js" });
  listeners.forEach((fn) => fn());

  const history = collectText(seen["drawing-history"]);
  assert.match(history, /Maya Chen/);
  assert.match(history, /maya\.chen@example\.com/);
  assert.match(history, /Week 1/);
  assert.match(history, /4 entries/);
  assert.doesNotMatch(history, /Riley Kim/);
  assert.match(seen["drawing-pool"].textContent, /6 people have joined this crawl/);
  assert.match(seen["drawing-pool"].textContent, /5 people are still in the drawing, with 12 entries/);
  assert.equal(seen["drawing-demo"].classes.hidden, false);

  seen["org-crawl"].value = "puy-summer-demo";
  seen["org-crawl"].onchange();
  const summer = collectText(seen["drawing-history"]);
  assert.match(summer, /No winners yet for this crawl/);
  assert.doesNotMatch(summer, /Maya Chen/);
  assert.match(seen["drawing-pool"].textContent, /3 people have joined this crawl/);
  assert.match(seen["drawing-pool"].textContent, /3 people are still in the drawing, with 6 entries/);

  seen["drawing-label"].value = "Week 2";
  seen["drawing-form"].listeners.submit.forEach((fn) => fn({ preventDefault() {} }));
  const after = collectText(seen["drawing-history"]);
  assert.match(after, /Week 2/);
  assert.doesNotMatch(after, /Maya Chen/);
  assert.doesNotMatch(after, /maya\.chen@example\.com/);
  assert.match(seen["drawing-pool"].textContent, /2 people are still in the drawing/);

  seen["org-crawl"].value = "puy-coffee";
  seen["org-crawl"].onchange();
  const coffeeAgain = collectText(seen["drawing-history"]);
  assert.match(coffeeAgain, /Maya Chen/);
  assert.match(coffeeAgain, /maya\.chen@example\.com/);
  assert.doesNotMatch(coffeeAgain, /Week 2/);
  assert.match(seen["drawing-pool"].textContent, /5 people are still in the drawing/);
});

function collectText(node) {
  if (!node) return "";
  return [node.textContent || ""].concat((node.children || []).map(collectText)).join(" ");
}

function loadDrawingApi() {
  const sandbox = {
    URLSearchParams,
    console,
    document: { addEventListener() {}, getElementById() { return null; } },
    location: { search: "" },
    localStorage: { getItem() { return null; }, setItem() {} }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(organizer, sandbox, { filename: "assets/organizer-panel.js" });
  return sandbox.HCDrawing;
}
