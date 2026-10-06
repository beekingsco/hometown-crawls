const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");

const root = path.join(__dirname, "..");
const pagePath = path.join(root, "puyallup/holiday-coffee-crawl/rules/index.html");
const configPath = path.join(root, "puyallup/holiday-coffee-crawl/rules/config.json");
const page = fs.readFileSync(pagePath, "utf8");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

const FILLED = {
  crawl_name: "Puyallup Holiday Coffee Crawl",
  start_date: "November 1, 2026",
  end_date: "December 31, 2026"
};

test("official rules config fills only proven crawl facts", () => {
  assert.equal(config.crawl_name, FILLED.crawl_name);
  assert.equal(config.start_date, FILLED.start_date);
  assert.equal(config.end_date, FILLED.end_date);
  assert.equal(config.registration_notice, "");
  for (const key of Object.keys(config)) {
    if (key in FILLED || key === "registration_notice") continue;
    assert.equal(config[key], null, key);
  }
});

test("embedded config matches config.json and drives every field", () => {
  const embedded = page.match(/<script type="application\/json" id="crawl-rules-config">([\s\S]*?)<\/script>/);
  assert.ok(embedded, "missing embedded config");
  assert.deepEqual(JSON.parse(embedded[1]), config);

  const fields = [...page.matchAll(/data-field="([a-z_]+)"[^>]*>([^<]*)</g)];
  assert.ok(fields.length > 0);
  const seen = new Set();
  for (const [, key, raw] of fields) {
    seen.add(key);
    assert.ok(Object.prototype.hasOwnProperty.call(config, key), key);
    const val = config[key];
    if (val == null) assert.equal(raw, "To be announced", key);
    else assert.equal(raw, String(val), key);
  }
  for (const key of Object.keys(config)) assert.ok(seen.has(key), "missing field " + key);
});

test("official rules page is indexable and has no raw placeholders", () => {
  assert.doesNotMatch(page, /\{\{[^}]+\}\}/);
  assert.doesNotMatch(page, /noindex/i);
  assert.match(page, /content="index, follow"/);
  assert.match(page, /rel="canonical" href="https:\/\/www\.hometowncrawls\.com\/puyallup\/holiday-coffee-crawl\/rules"/);
  assert.match(page, /Privacy policy link will go here when that page exists/);
  assert.doesNotMatch(page, /href="[^"]*privacy[-.]/i);
  assert.doesNotMatch(page, /revenue share|splits each shop/i);
});

test("sitemap, rewrite, crawl-page link, and footer link point at the rules", () => {
  const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
  const vercel = fs.readFileSync(path.join(root, "vercel.json"), "utf8");
  const crawl = fs.readFileSync(path.join(root, "puyallup/holiday-coffee-crawl/index.html"), "utf8");
  const siteJs = fs.readFileSync(path.join(root, "assets/site.js"), "utf8");
  assert.match(sitemap, /https:\/\/www\.hometowncrawls\.com\/puyallup\/holiday-coffee-crawl\/rules/);
  assert.match(vercel, /"source": "\/puyallup\/holiday-coffee-crawl\/rules"/);
  assert.match(vercel, /"destination": "\/puyallup\/holiday-coffee-crawl\/rules\/index.html"/);
  assert.match(crawl, /href="\/puyallup\/holiday-coffee-crawl\/rules"/);
  assert.match(siteJs, /puyallup\/holiday-coffee-crawl\/rules/);
  assert.match(crawl, /site\.js\?v=3/);
});
