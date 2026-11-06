const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const sql = read("migrations/20261106013000_daily_stamp_limit.sql");

test("daily stamp limit is per crawl and ignores manual stamps", () => {
  assert.match(sql, /add column if not exists daily_stamp_limit integer default 2/);
  assert.match(sql, /Null means that crawl has no cap/);
  assert.match(sql, /'daily_limit'::text/);
  assert.match(sql, /v_message ~\* 'daily limit'/);
  assert.match(sql, /v_reason := 'daily_limit'/);
  assert.match(sql, /raise exception 'Daily limit' using hint = v_limit::text/);
  assert.match(sql, /if v_limit is not null then/);
  assert.match(sql, /coalesce\(s\.source, 'digital'\) = 'digital'/);
  assert.match(sql, /s\.user_id = v_uid/);
  assert.match(sql, /s\.crawl_id = p_crawl/);
  assert.match(sql, /America\/Los_Angeles/);
  assert.match(sql, /s\.claimed_at at time zone 'America\/Los_Angeles'/);
  assert.match(sql, /coalesce\(v_today, 0\) >= v_limit/);
  assert.doesNotMatch(sql, /source = 'manual'/);
  const countAt = sql.indexOf("select count(*)::integer into v_today");
  const insertAt = sql.indexOf("insert into public.stamps", countAt);
  assert.ok(countAt > 0 && insertAt > countAt);
  assert.match(sql, /Apply by hand/);
});

function loadCrawl(claimError) {
  const calls = [];
  const sandbox = {
    URLSearchParams,
    location: { hash: "", search: "", pathname: "/puyallup/holiday-coffee-crawl", origin: "https://www.hometowncrawls.com" },
    navigator: { userAgent: "TestAgent" },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    document: { addEventListener() {} },
    history: { replaceState() {} },
    console: { warn() {} }
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
          getSession() {
            return Promise.resolve({
              data: { session: { user: { id: "user-1", email: "ada@example.com", is_anonymous: false } } }
            });
          },
          onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }
        },
        rpc(name, args) {
          calls.push({ name, args });
          if (name === "claim_stamp") return Promise.resolve({ data: null, error: claimError });
          return Promise.resolve({ data: null, error: null });
        }
      };
    }
  };
  vm.runInNewContext(read("assets/crawl.js"), sandbox, { filename: "assets/crawl.js" });
  return { sandbox, calls };
}

test("a daily limit error uses the crawl's number and logs Daily limit", async () => {
  const page = loadCrawl({ message: "Daily limit", hint: "2" });
  await assert.rejects(
    page.sandbox.HCCrawl.claimStamp({ crawl: "arl-coffee", business: "shop-a", code: "CODE" }),
    (error) => {
      assert.equal(error.message, "Oops! You've reached your 2 passport stamps for today. Come back tomorrow to collect more!");
      return true;
    }
  );
  const log = page.calls.find((row) => row.name === "log_stamp_attempt_failure");
  assert.equal(log.args.p_crawl, "arl-coffee");
  assert.equal(log.args.p_message, "Daily limit");
  assert.equal(JSON.stringify(page.calls).includes("puy-coffee"), false);

  const five = loadCrawl({ message: "Daily limit", hint: "5" });
  await assert.rejects(
    five.sandbox.HCCrawl.claimStamp({ crawl: "puy-coffee", business: "shop-b", code: "CODE" }),
    /your 5 passport stamps for today/
  );
  assert.equal(
    five.sandbox.HCCrawl.dailyLimitCopy({ message: "Invalid code", hint: "2" }),
    ""
  );
});

test("organizer failed scans label a daily limit on this crawl only", () => {
  const sandbox = {
    URLSearchParams,
    location: { search: "" },
    document: { addEventListener() {}, getElementById() { return null; }, createElement() { return { click() {} }; } },
    localStorage: { getItem() { return null; }, setItem() {} },
    window: {}
  };
  sandbox.window = sandbox;
  vm.runInNewContext(read("assets/organizer-panel.js"), sandbox, { filename: "assets/organizer-panel.js" });
  const html = sandbox.HCOrganizerScans.renderFailureList("puy-coffee", [
    { crawl_id: "puy-coffee", reason: "daily_limit", business_id: "anthem", code_entered: "TODAY", created_at: "2026-11-06T18:00:00Z", user_agent: "phone" },
    { crawl_id: "arl-coffee", reason: "daily_limit", business_id: "other", code_entered: "OTHERDAY", created_at: "2026-11-06T18:00:00Z", user_agent: "phone" }
  ]);
  assert.match(html, /Daily limit/);
  assert.match(html, /TODAY/);
  assert.doesNotMatch(html, /OTHERDAY/);
  assert.doesNotMatch(html, />Error</);
});
