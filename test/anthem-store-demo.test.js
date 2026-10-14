const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const account = fs.readFileSync(path.join(root, "account.html"), "utf8");
const shop = fs.readFileSync(path.join(root, "puyallup/coffee-crawl/shop/index.html"), "utf8");
const demoJs = fs.readFileSync(path.join(root, "assets/store-demo.js"), "utf8");
const configJs = fs.readFileSync(path.join(root, "assets/config.js"), "utf8");

test("Anthem demo is one config and opens without a migration", () => {
  assert.match(configJs, /storeCode: "ANTHEMCO"/);
  assert.match(configJs, /name: "Anthem Coffee & Tea"/);
  assert.match(configJs, /reward: "\$1 off next drink"/);
  assert.match(configJs, /expiryDays: 30/);
  assert.match(configJs, /privacy@hometowncrawls\.com/);
  assert.match(account, /id="demo-banner"[^>]*><\/div>/);
  assert.doesNotMatch(account, /id="demo-banner"[\s\S]{0,200}ANTHEMCO/);
  assert.match(demoJs, /banner\.innerHTML/);
  assert.match(demoJs, /if \(demoRequested\(\)\)/);
  assert.match(account, /Total players/);
  assert.match(account, /Total scans/);
  assert.match(account, /Scans at this shop/);
  assert.match(account, /Share of scans/);
  assert.match(account, /First-time visitors/);
  assert.match(account, /id="coupon-reward"/);
  assert.match(account, /id="coupon-days"/);
  assert.match(account, /id="coupon-issued"/);
  assert.match(account, /id="coupon-redeemed"/);
  assert.match(account, /id="btn-guest-csv"/);
  assert.match(account, /id="guest-reward"/);
  assert.match(account, /id="guest-cards"/);
  assert.match(account, /guest-table-wrap/);
  assert.match(account, /assets\/store-demo\.js/);
  assert.match(demoJs, /id="guest-cards"|getElementById\("guest-cards"\)/);
  assert.match(demoJs, /record-name/);
  assert.match(demoJs, /record-email/);
  assert.match(fs.readFileSync(path.join(root, "assets/site.css"), "utf8"), /max-width: 639px/);
  assert.match(fs.readFileSync(path.join(root, "puyallup/coffee-crawl/organizer/index.html"), "utf8"), /id="shop-cards"/);
  assert.match(demoJs, /get\("demo"\) === "1"/);
  assert.match(demoJs, /consentedAt && row\.email && row\.name/);
  assert.match(demoJs, /DEMO DATA/);
  assert.match(shop, /\/account\?demo=1&tab=store/);
  assert.doesNotMatch(demoJs, /service_role|profiles\.role/);
});

test("share of scans and consented export stay consistent", () => {
  const sandbox = { window: {}, document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } }, location: { search: "", href: "https://example.com/account" }, history: { replaceState() {} }, localStorage: { getItem() { return null; }, setItem() {} }, URL, URLSearchParams, Intl };
  vm.runInNewContext(demoJs, sandbox);
  assert.equal(sandbox.window.HCStoreDemo.percent(64, 412), "15.5%");
  const kept = sandbox.window.HCStoreDemo.consentedGuests([
    { name: "A", email: "a@example.com", consentedAt: "2026-10-01T00:00:00Z" },
    { name: "B", email: "b@example.com" },
    { name: "", email: "c@example.com", consentedAt: "2026-10-01T00:00:00Z" }
  ]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].name, "A");
});
