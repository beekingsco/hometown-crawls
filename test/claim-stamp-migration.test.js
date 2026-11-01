const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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

test("live claim_stamp geofence is 100 m, with the same claim rules", () => {
  assert.match(radiusSql, /Radius is 100 m/);
  assert.match(radiusSql, /c_radius_m constant double precision := 100/);
  assert.doesNotMatch(radiusSql, /c_radius_m constant double precision := 50/);
  assert.match(radiusSql, /crawl_shop_codes/);
  assert.match(radiusSql, /is_visible is true/);
  assert.match(radiusSql, /revoke all on function public\.claim_stamp\(text, text, text, double precision, double precision\) from public/);
  assert.match(radiusSql, /grant execute on function public\.claim_stamp\(text, text, text, double precision, double precision\) to authenticated/);
  assert.doesNotMatch(radiusSql, /demo_bypass/);
});
