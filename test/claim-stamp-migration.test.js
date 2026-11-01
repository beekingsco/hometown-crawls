const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sql = fs.readFileSync(
  path.join(__dirname, "..", "migrations", "20260928150000_claim_stamp_enforce_rules.sql"),
  "utf8"
);
const radiusSql = fs.readFileSync(
  path.join(__dirname, "..", "migrations", "20261101161000_claim_stamp_radius_100m.sql"),
  "utf8"
);

test("claim_stamp migration keeps the live signature and pins search_path", () => {
  assert.match(sql, /function public\.claim_stamp\(/);
  assert.match(sql, /p_crawl text/);
  assert.match(sql, /p_business text/);
  assert.match(sql, /p_code text/);
  assert.match(sql, /p_lat double precision/);
  assert.match(sql, /p_lng double precision/);
  assert.match(sql, /returns public\.stamps/i);
  assert.match(sql, /security definer/i);
  assert.match(sql, /set search_path to 'public'/i);
});

test("claim_stamp migration enforces one stamp, codes, and the 50 m radius", () => {
  assert.match(sql, /c_radius_m constant double precision := 50/);
  assert.match(sql, /raise exception 'Already stamped'/);
  assert.match(sql, /raise exception 'Location required'/);
  assert.match(sql, /raise exception 'You need to be at the shop'/);
  assert.match(sql, /raise exception 'Invalid code'/);
  assert.match(sql, /upper\(v_store_biz\) = upper\(v_code\)/);
  assert.match(sql, /v_qr_biz = v_code/);
  assert.match(sql, /v_qr_listing = v_code/);
  assert.match(sql, /shop_listings/);
  assert.match(sql, /is_paid is true/);
  assert.match(sql, /is_approved is true/);
  assert.match(sql, /status = 'active'/);
  assert.doesNotMatch(sql, /on conflict/i);
  assert.doesNotMatch(sql, /do update/i);
});

test("100 m migration records the interim geofence before code-only stamps", () => {
  assert.match(radiusSql, /Radius is 100 m/);
  assert.match(radiusSql, /c_radius_m constant double precision := 100/);
  assert.doesNotMatch(radiusSql, /c_radius_m constant double precision := 50/);
  assert.match(radiusSql, /crawl_shop_codes/);
  assert.match(radiusSql, /is_visible is true/);
  assert.match(radiusSql, /revoke all on function public\.claim_stamp\(text, text, text, double precision, double precision\) from public/);
  assert.match(radiusSql, /grant execute on function public\.claim_stamp\(text, text, text, double precision, double precision\) to authenticated/);
  assert.doesNotMatch(radiusSql, /demo_bypass/);
});

const codeOnly = fs.readFileSync(
  path.join(__dirname, "..", "migrations", "20261101180000_claim_stamp_code_only.sql"),
  "utf8"
);

test("latest claim_stamp accepts null coordinates and keeps code, crawl, and auth checks", () => {
  assert.match(codeOnly, /function public\.claim_stamp\(/);
  assert.match(codeOnly, /p_lat double precision default null/);
  assert.match(codeOnly, /p_lng double precision default null/);
  assert.match(codeOnly, /returns public\.stamps/i);
  assert.match(codeOnly, /security definer/i);
  assert.match(codeOnly, /set search_path to 'public'/i);
  assert.match(codeOnly, /raise exception 'Not authenticated'/);
  assert.match(codeOnly, /raise exception 'Code required'/);
  assert.match(codeOnly, /raise exception 'Invalid code'/);
  assert.match(codeOnly, /raise exception 'Already stamped'/);
  assert.match(codeOnly, /raise exception 'Business not on this crawl'/);
  assert.match(codeOnly, /raise exception 'Unknown business'/);
  assert.match(codeOnly, /crawl_shop_codes/);
  assert.match(codeOnly, /status = 'active'/);
  assert.match(codeOnly, /is_visible is true/);
  assert.match(codeOnly, /insert into public\.stamps \(user_id, crawl_id, business_id, lat, lng\)/);
  assert.match(codeOnly, /values \(v_uid, p_crawl, p_business, p_lat, p_lng\)/);
  assert.doesNotMatch(codeOnly, /c_radius_m|Location required|You need to be at the shop|asin\(|6371000/);
  assert.doesNotMatch(codeOnly.slice(codeOnly.indexOf("create or replace function")), /organizer_set_manual_stamp/);
  assert.doesNotMatch(codeOnly, /on conflict/i);
});

test("guest claimStamp sends null coordinates and never reads geolocation", async () => {
  const crawl = fs.readFileSync(path.join(__dirname, "..", "assets", "crawl.js"), "utf8");
  assert.doesNotMatch(crawl, /getCurrentPosition|navigator\.geolocation|function getPosition|Location required/);
  const calls = [];
  let geoReads = 0;
  const sandbox = {
    location: { hash: "", search: "", origin: "https://www.hometowncrawls.com", pathname: "/account" },
    localStorage: { getItem() { return null; }, setItem() {} },
    document: {},
    URLSearchParams,
    navigator: {
      get geolocation() {
        geoReads += 1;
        return { getCurrentPosition() { throw new Error("location should stay unused"); } };
      }
    }
  };
  sandbox.window = sandbox;
  sandbox.window.__HC_ENV__ = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon" };
  sandbox.window.supabase = {
    createClient() {
      return {
        auth: {
          async getSession() {
            return { data: { session: { user: { id: "u", email: "a@b.c", is_anonymous: false } } } };
          },
          onAuthStateChange() {
            return { data: { subscription: { unsubscribe() {} } } };
          }
        },
        async rpc(name, args) {
          calls.push([name, args]);
          return { data: { id: "stamp" }, error: null };
        }
      };
    }
  };
  vm.runInNewContext(crawl, sandbox, { filename: "assets/crawl.js" });
  const row = await sandbox.window.HCCrawl.claimStamp({
    crawl: "puy-coffee",
    business: "anthem",
    code: "ANTHEMCO"
  });
  assert.equal(geoReads, 0);
  assert.equal(sandbox.window.HCCrawl.getPosition, undefined);
  assert.equal(calls[0][0], "claim_stamp");
  assert.equal(calls[0][1].p_crawl, "puy-coffee");
  assert.equal(calls[0][1].p_business, "anthem");
  assert.equal(calls[0][1].p_code, "ANTHEMCO");
  assert.equal(calls[0][1].p_lat, null);
  assert.equal(calls[0][1].p_lng, null);
  assert.equal(row.id, "stamp");
  await sandbox.window.HCCrawl.claimStamp({
    crawl: "puy-coffee",
    business: "anthem",
    code: "QRSECRET",
    lat: 47.19,
    lng: -122.29
  });
  assert.equal(geoReads, 0);
  assert.equal(calls[1][1].p_lat, 47.19);
  assert.equal(calls[1][1].p_lng, -122.29);
});
