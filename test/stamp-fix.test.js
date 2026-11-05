const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const sql = read("migrations/20261105213000_stamp_failures_and_fix_requests.sql");

test("stamp failure log is private and organizers read one crawl", () => {
  assert.match(sql, /create table if not exists public\.stamp_attempt_failures/);
  assert.match(sql, /user_id uuid/);
  assert.match(sql, /crawl_id text not null/);
  assert.match(sql, /business_id text/);
  assert.match(sql, /code_entered text not null/);
  assert.match(sql, /user_agent text not null/);
  assert.match(sql, /created_at timestamptz not null default now\(\)/);
  for (const reason of ["not_signed_in", "not_joined", "bad_code", "already_stamped", "error"]) {
    assert.match(sql, new RegExp("'" + reason + "'::text"));
  }
  assert.match(sql, /alter table public\.stamp_attempt_failures enable row level security/);
  assert.match(sql, /alter table public\.stamp_attempt_failures force row level security/);
  assert.match(sql, /revoke all on table public\.stamp_attempt_failures from public, anon, authenticated/);
  assert.doesNotMatch(sql, /grant select on (table )?public\.stamp_attempt_failures/i);
  assert.doesNotMatch(sql, /grant select on (table )?public\.stamp_fix_requests/i);
  assert.match(sql, /if auth\.uid\(\) is null then\s+v_reason := 'not_signed_in'/);
  assert.match(sql, /function public\.organizer_stamp_failures\(p_crawl text\)/);
  assert.match(sql, /where f\.crawl_id = p_crawl/);
  assert.match(sql, /private\.is_crawl_staff\(p_crawl\)/);
  assert.match(sql, /grant execute on function public\.log_stamp_attempt_failure\(text, text, text, text, text\) to anon, authenticated/);
  assert.match(sql, /grant execute on function public\.organizer_stamp_failures\(text\) to authenticated/);
  assert.doesNotMatch(sql, /grant execute on function public\.organizer_stamp_failures\(text\) to anon/);
  assert.match(sql, /raise exception 'Not joined'/);
});

test("stamp fix requests stay on the crawl that was submitted", () => {
  assert.match(sql, /create table if not exists public\.stamp_fix_requests/);
  assert.match(sql, /alter table public\.stamp_fix_requests enable row level security/);
  assert.match(sql, /revoke all on table public\.stamp_fix_requests from public, anon, authenticated/);
  assert.match(sql, /function public\.request_stamp_fix/);
  assert.match(sql, /j\.crawl_id = p_crawl/);
  assert.match(sql, /private\.shop_on_crawl\(p_crawl, shop\.id\)/);
  assert.match(sql, /where l\.crawl_id = p_crawl/);
  assert.match(sql, /function public\.organizer_list_stamp_fix_requests\(p_crawl text\)/);
  assert.match(sql, /where r\.crawl_id = p_crawl/);
  assert.match(sql, /and r\.status = 'pending'/);
  assert.match(sql, /function public\.organizer_approve_stamp_fix/);
  assert.match(sql, /and r\.crawl_id = p_crawl/);
  assert.match(sql, /insert into public\.stamps \(user_id, crawl_id, business_id, source\)/);
  assert.match(sql, /values \(v_user, p_crawl, v_shop, 'manual'\)/);
  assert.match(sql, /where id = p_request\s+and crawl_id = p_crawl\s+and status = 'pending'/);
  assert.match(sql, /grant execute on function public\.request_stamp_fix\(text, text\[\], text\) to authenticated/);
  assert.doesNotMatch(sql, /grant execute on function public\.request_stamp_fix\(text, text\[\], text\) to anon/);
  assert.match(sql, /Apply by hand/);
});

function loadCrawl(options) {
  const opts = options || {};
  const calls = [];
  const state = { session: opts.session === undefined ? null : opts.session };
  const sandbox = {
    URLSearchParams,
    location: { hash: "", search: opts.search || "", pathname: "/account", origin: "https://www.hometowncrawls.com" },
    navigator: { userAgent: "TestAgent" },
    localStorage: { getItem() { return null; }, setItem() {} },
    document: {},
    console: { warn() {} },
    history: { replaceState() {} }
  };
  sandbox.window = sandbox;
  sandbox.__HC_ENV__ = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_ANON_KEY: "anon",
    CRAWL_ID: "puy-coffee"
  };
  sandbox.supabase = {
    createClient() {
      return {
        auth: {
          getSession() { return Promise.resolve({ data: { session: state.session } }); },
          onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }
        },
        rpc(name, args) {
          calls.push({ name, args });
          if (name === "claim_stamp") {
            return Promise.resolve({ data: null, error: opts.claimError || null });
          }
          return Promise.resolve({ data: null, error: null });
        }
      };
    }
  };
  vm.runInNewContext(read("assets/crawl.js"), sandbox, { filename: "assets/crawl.js" });
  return { sandbox, calls };
}

const signedIn = { user: { id: "user-1", email: "ada@example.com", is_anonymous: false } };

test("a failed stamp logs that crawl only, and a success does not log", async () => {
  const failed = loadCrawl({
    session: signedIn,
    claimError: { message: "Invalid code" }
  });
  await assert.rejects(
    failed.sandbox.HCCrawl.claimStamp({ crawl: "arl-coffee", business: "shop-a", code: "NOPE" }),
    /Invalid code/
  );
  assert.deepEqual(failed.calls.map((row) => row.name), ["claim_stamp", "log_stamp_attempt_failure"]);
  assert.equal(failed.calls[1].args.p_crawl, "arl-coffee");
  assert.equal(failed.calls[1].args.p_business, "shop-a");
  assert.equal(failed.calls[1].args.p_code, "NOPE");
  assert.equal(failed.calls[1].args.p_message, "Invalid code");
  assert.equal(failed.calls[1].args.p_user_agent, "TestAgent");
  assert.equal(JSON.stringify(failed.calls).includes("puy-coffee"), false);

  const ok = loadCrawl({ session: signedIn });
  await ok.sandbox.HCCrawl.claimStamp({ crawl: "puy-coffee", business: "shop-a", code: "GOOD" });
  assert.deepEqual(ok.calls.map((row) => row.name), ["claim_stamp"]);
});

test("signed-out and demo stamp attempts do not invent a crawl log", async () => {
  const signedOut = loadCrawl({ session: null });
  await assert.rejects(
    signedOut.sandbox.HCCrawl.claimStamp({ crawl: "arl-coffee", business: "shop-a", code: "NOPE" }),
    /sign in with email/i
  );
  assert.deepEqual(signedOut.calls.map((row) => row.name), ["log_stamp_attempt_failure"]);
  assert.equal(signedOut.calls[0].args.p_crawl, "arl-coffee");
  assert.match(signedOut.calls[0].args.p_message, /sign in with email/i);

  const demo = loadCrawl({ search: "?demo=1", session: signedIn });
  await assert.rejects(demo.sandbox.HCCrawl.claimStamp({ crawl: "arl-coffee", business: "shop-a", code: "NOPE" }));
  assert.deepEqual(demo.calls, []);
});

function loadFix(search, joins) {
  const calls = [];
  const sandbox = {
    URLSearchParams,
    location: { search: search, pathname: "/stamp-fix", origin: "https://www.hometowncrawls.com" },
    document: {
      addEventListener() {},
      getElementById() { return null; },
      querySelectorAll() { return []; }
    }
  };
  sandbox.window = sandbox;
  sandbox.HCCrawl = {
    loadShops(id) {
      calls.push({ name: "loadShops", id: id });
      return Promise.resolve({ shops: [{ id: "shop-a", name: "Shop A" }] });
    },
    getSession: async () => ({ user: { id: "user-1", email: "ada@example.com", is_anonymous: false } }),
    myJoins: async () => joins || [],
    client() {
      return {
        rpc(name, args) {
          calls.push({ name: name, args: args });
          return Promise.resolve({ data: "req-1", error: null });
        }
      };
    },
    magicLink: async () => {}
  };
  vm.runInNewContext(read("assets/stamp-fix.js"), sandbox, { filename: "assets/stamp-fix.js" });
  return { sandbox, calls };
}

test("stamp fix uses only the crawl in the link", async () => {
  const missing = loadFix("", [{ crawl_id: "puy-coffee" }]);
  assert.equal(missing.sandbox.HCStampFix.crawlFromLocation(), "");
  await assert.rejects(missing.sandbox.HCStampFix.submit("", ["shop-a"], ""), /will not pick one|from your crawl/i);
  assert.equal(missing.calls.length, 0);

  const arlington = loadFix("?crawl=arl-coffee", [{ crawl_id: "puy-coffee" }]);
  assert.equal(arlington.sandbox.HCStampFix.crawlFromLocation(), "arl-coffee");
  assert.equal(arlington.sandbox.HCStampFix.crawlHref("arl-coffee"), "/arlington/holiday-coffee-crawl");
  assert.equal(arlington.sandbox.HCStampFix.crawlHref("puy-coffee"), "/puyallup/holiday-coffee-crawl");
  await assert.rejects(
    arlington.sandbox.HCStampFix.submit("arl-coffee", ["shop-a"], "missed"),
    /Join this crawl/
  );
  assert.equal(arlington.calls.some((row) => row.name === "request_stamp_fix"), false);

  const joined = loadFix("?crawl=arl-coffee", [{ crawl_id: "arl-coffee" }]);
  const id = await joined.sandbox.HCStampFix.submit("arl-coffee", ["shop-a", "puy-shop"], "missed");
  assert.equal(id, "req-1");
  assert.equal(joined.calls[0].name, "request_stamp_fix");
  assert.equal(joined.calls[0].args.p_crawl, "arl-coffee");
  assert.deepEqual(joined.calls[0].args.p_businesses, ["shop-a", "puy-shop"]);
  const shops = await joined.sandbox.HCStampFix.loadShops("arl-coffee");
  assert.equal(shops[0].id, "shop-a");
  assert.equal(joined.calls.some((row) => row.name === "loadShops" && row.id === "puy-coffee"), false);
});

test("organizer lists drop rows from other crawls", () => {
  const sandbox = {
    URLSearchParams,
    location: { search: "" },
    document: { addEventListener() {}, getElementById() { return null; }, createElement() { return { click() {} }; } },
    localStorage: { getItem() { return null; }, setItem() {} },
    window: {}
  };
  sandbox.window = sandbox;
  vm.runInNewContext(read("assets/organizer-panel.js"), sandbox, { filename: "assets/organizer-panel.js" });
  const scans = sandbox.HCOrganizerScans;
  const failures = scans.renderFailureList("puy-coffee", [
    { crawl_id: "puy-coffee", reason: "bad_code", business_id: "anthem", code_entered: "PUYCODE", created_at: "2026-11-05T18:00:00Z", user_agent: "phone" },
    { crawl_id: "arl-coffee", reason: "bad_code", business_id: "other", code_entered: "ARLCODE", created_at: "2026-11-05T18:00:00Z", user_agent: "phone" }
  ]);
  assert.match(failures, /PUYCODE/);
  assert.match(failures, /Bad code/);
  assert.doesNotMatch(failures, /ARLCODE/);
  assert.doesNotMatch(failures, /arl-coffee/);

  const fixes = scans.renderFixList("arl-coffee", [
    { id: "fix-arl", crawl_id: "arl-coffee", guest_email: "ada@example.com", business_ids: ["arl-shop"], note: "Arlington visit", created_at: "2026-11-05T18:00:00Z" },
    { id: "fix-puy", crawl_id: "puy-coffee", guest_email: "other@example.com", business_ids: ["puy-shop"], note: "Puyallup visit", created_at: "2026-11-05T18:00:00Z" }
  ]);
  assert.match(fixes, /Arlington visit/);
  assert.match(fixes, /data-crawl="arl-coffee"/);
  assert.match(fixes, /data-approve-fix="fix-arl"/);
  assert.doesNotMatch(fixes, /Puyallup visit/);
  assert.doesNotMatch(fixes, /puy-shop/);
  assert.doesNotMatch(fixes, /fix-puy/);
});

test("stamp fix page, rewrite, and organizer tab are wired to one crawl", () => {
  const page = read("stamp-fix/index.html");
  const account = read("account.html");
  const organizer = read("assets/organizer-panel.js");
  const vercel = read("vercel.json");
  assert.match(page, /<h1>Request a stamp fix<\/h1>/);
  assert.match(page, /canonical" href="https:\/\/www\.hometowncrawls\.com\/stamp-fix"/);
  assert.match(page, /\/assets\/stamp-fix\.js\?v=stamp-fix-1/);
  assert.doesNotMatch(page, /puy-coffee|arl-coffee/);
  assert.match(read("assets/stamp-fix.js"), /HCCrawl\.magicLink\(\(email && email\.value \|\| ""\)\.trim\(\)\)/);
  assert.doesNotMatch(read("assets/stamp-fix.js"), /magicLink\([^)]*,/);
  assert.match(vercel, /"source": "\/stamp-fix"/);
  assert.match(vercel, /"destination": "\/stamp-fix\/index\.html"/);
  assert.match(read("sitemap.xml"), /https:\/\/www\.hometowncrawls\.com\/stamp-fix/);
  assert.match(account, /id="failed-scans"/);
  assert.match(account, /<h3>Failed scans<\/h3>/);
  assert.match(account, /id="stamp-fix-requests"/);
  assert.match(account, /<h3>Stamp fix requests<\/h3>/);
  assert.match(account, /href="\/stamp-fix\?crawl=puy-coffee"/);
  assert.match(read("puyallup/holiday-coffee-crawl/index.html"), /href="\/stamp-fix\?crawl=puy-coffee"/);
  assert.match(read("arlington/holiday-coffee-crawl/index.html"), /href="\/stamp-fix\?crawl=arl-coffee"/);
  assert.doesNotMatch(read("arlington/holiday-coffee-crawl/index.html"), /stamp-fix\?crawl=puy-coffee/);
  assert.match(organizer, /organizer_stamp_failures", \{ p_crawl: active \}/);
  assert.match(organizer, /organizer_list_stamp_fix_requests", \{ p_crawl: active \}/);
  assert.match(organizer, /organizer_approve_stamp_fix"/);
  assert.match(organizer, /p_crawl: active/);
  assert.match(organizer, /DEMO DATA\. No stamp was added\./);
});
