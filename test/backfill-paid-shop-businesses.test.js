const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(
  path.join(__dirname, "..", "migrations", "20261006150000_backfill_paid_shop_businesses.sql"),
  "utf8"
);

const listings = [
  "9bf4ca90-be90-421d-8325-752c595c36f7",
  "c4a170dc-a876-43f8-aa3a-ca8f91b428a1",
  "b8570c6e-dfbc-4fd7-af7b-c0bb3e051d3f",
  "f20c428d-257a-4453-af28-094570b14624",
  "f2565031-9a4e-4436-a474-36d55cfb04c5",
  "e6c1af03-dd34-4104-ac33-c67651d99333",
  "a11e6bea-7c60-4e34-bad2-ddb5b4e622db"
];

test("paid shop backfill is one transaction for the seven listings", () => {
  assert.match(sql, /^-- Backfill businesses/);
  assert.match(sql, /\nbegin;\n/);
  assert.match(sql, /\ncommit;\s*$/);
  for (const id of listings) {
    assert.equal(sql.split(id).length - 1, 1, id);
  }
  assert.match(sql, /'anthem'/);
  assert.match(sql, /'holiday'/);
  assert.match(sql, /'woods-puyallup'/);
  assert.match(sql, /'southern-charm'/);
  assert.match(sql, /'im-juiced'/);
  assert.match(sql, /'happy-donuts'/);
  assert.match(sql, /'lick-homemade'/);
  assert.match(sql, /'WOODSPUY'/);
  assert.match(sql, /'SCHARMES'/);
  assert.match(sql, /'IMJUICED'/);
  assert.match(sql, /'HAPPYDON'/);
  assert.match(sql, /'LICKHOME'/);
});

test("paid shop backfill does not call sync or touch payment state", () => {
  assert.match(sql, /LOAD-BEARING ORDER/);
  assert.match(sql, /gen_random_uuid\(\)/);
  assert.doesNotMatch(sql, /perform\s+private\.sync_listing_business/i);
  assert.doesNotMatch(sql, /select\s+private\.sync_listing_business/i);
  assert.doesNotMatch(sql, /is_paid\s*=/);
  assert.doesNotMatch(sql, /is_approved\s*=/);
  assert.doesNotMatch(sql, /update\s+public\.crawl_signups/i);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.crawl_signups/i);
  assert.doesNotMatch(sql, /stripe_session_id\s*=/);
  assert.doesNotMatch(sql, /stripe-webhook/);
  assert.doesNotMatch(sql, /d0098015-c28b-4e33-8217-7d5b47570ad3/);
  assert.match(sql, /as has_qr/);
  assert.doesNotMatch(sql, /select\s+qr_secret\b/i);
});
