const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(
  path.join(__dirname, "..", "migrations", "20261006160000_pin_webhook_paid_shops.sql"),
  "utf8"
);

const listings = [
  ["074ac142-8ede-4a5b-9a8d-66b4f04870cb", "sl-074ac1428ede"],
  ["be56d8ee-6d77-4131-9229-ab80012ec66a", "sl-be56d8ee6d77"],
  ["65ed4ffe-31b8-410a-b3ee-6cd3a39f9907", "sl-65ed4ffe31b8"],
  ["96d797d3-3139-4bcb-b8af-b1e1ee0664a4", "sl-96d797d33139"],
  ["753d952b-ca71-4854-be55-2b68a0765810", "sl-753d952bca71"],
  ["b44c3e1d-592c-4db3-b749-46da43d62714", "sl-b44c3e1d592c"],
  ["a9041751-7da6-4e12-b014-2d6aaa16b9c2", "sl-a90417517da6"]
];

test("webhook pin migration names the seven sl- shops in one transaction", () => {
  assert.match(sql, /^-- Pin the seven/);
  assert.match(sql, /\nbegin;\n/);
  assert.match(sql, /\ncommit;\s*$/);
  for (const [listingId, businessId] of listings) {
    assert.equal(sql.split(listingId).length - 1, 1, listingId);
    assert.ok(sql.includes(businessId), businessId);
  }
});

test("webhook pin migration does not relink seeds or rewrite codes and payment", () => {
  assert.match(sql, /sync would rename a business or clear a logo/);
  assert.doesNotMatch(sql, /perform\s+private\.sync_listing_business/i);
  assert.doesNotMatch(sql, /is_paid\s*=/);
  assert.doesNotMatch(sql, /is_approved\s*=/);
  assert.doesNotMatch(sql, /update\s+public\.crawl_signups/i);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.crawl_signups/i);
  assert.doesNotMatch(sql, /update\s+public\.memberships/i);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.memberships/i);
  assert.doesNotMatch(sql, /store_code\s*=/);
  assert.doesNotMatch(sql, /qr_secret\s*=/);
  assert.doesNotMatch(sql, /stripe_session_id\s*=/);
  assert.doesNotMatch(sql, /'dulce'/);
  assert.doesNotMatch(sql, /'rescue'/);
  assert.doesNotMatch(sql, /'xo'/);
  assert.match(sql, /as has_qr/);
  assert.doesNotMatch(sql, /select\s+qr_secret\b/i);
});
