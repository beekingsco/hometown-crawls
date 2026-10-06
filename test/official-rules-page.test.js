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
  end_date: "December 31, 2026",
  sponsor_name: "Miracle Studios, Inc.",
  sponsor_address: "204 Still Glen Drive, Terrell, Texas 75160",
  eligible_states: "the United States",
  min_age: 18,
  drawing_date: "Monday, January 4, 2027",
  completion_bonus: 3,
  notify_days: 7,
  claim_days: 7,
  rules_contact: "chris@beekings.com",
  governing_state: "Texas",
  venue_county: "Kaufman"
};

const STILL_TBA = ["start_time", "end_time", "time_zone", "num_winners", "prize_description", "total_arv"];

test("official rules config fills the owner values and leaves prize and clock facts unannounced", () => {
  for (const [key, value] of Object.entries(FILLED)) assert.equal(config[key], value, key);
  assert.equal(config.registration_notice, "");
  for (const key of STILL_TBA) assert.equal(config[key], null, key);
  for (const key of Object.keys(config)) {
    if (key in FILLED || key === "registration_notice" || STILL_TBA.includes(key)) continue;
    assert.fail("unexpected config key " + key);
  }
});

test("embedded config matches config.json and drives every field", () => {
  const embedded = page.match(/<script type="application\/json" id="crawl-rules-config">([\s\S]*?)<\/script>/);
  assert.ok(embedded, "missing embedded config");
  assert.deepEqual(JSON.parse(embedded[1]), config);

  const fields = [...page.matchAll(/data-field="([a-z_]+)"[^>]*>([\s\S]*?)<\/(?:span|p)>/g)];
  assert.ok(fields.length > 0);
  const seen = new Set();
  for (const [, key, raw] of fields) {
    seen.add(key);
    assert.ok(Object.prototype.hasOwnProperty.call(config, key), key);
    const val = config[key];
    if (key === "rules_contact") {
      assert.equal(raw, `<a href="mailto:${val}">${val}</a>`, key);
      continue;
    }
    if (val == null) assert.equal(raw, "To be announced", key);
    else assert.equal(raw, String(val), key);
  }
  for (const key of Object.keys(config)) assert.ok(seen.has(key), "missing field " + key);
  assert.match(page, /legal residents of <span data-field="eligible_states">the United States<\/span> who are at least <span data-field="min_age">18<\/span> years old/);
  assert.match(page, /a court in <span data-field="venue_county">Kaufman<\/span> County, <span data-field="governing_state">Texas<\/span>/);
});

test("official rules page is indexable and has no raw placeholders", () => {
  assert.doesNotMatch(page, /\{\{[^}]+\}\}/);
  assert.doesNotMatch(page, /noindex/i);
  assert.match(page, /content="index, follow"/);
  assert.match(page, /rel="canonical" href="https:\/\/www\.hometowncrawls\.com\/puyallup\/holiday-coffee-crawl\/rules"/);
  assert.match(page, /Privacy policy link will go here when that page exists/);
  assert.doesNotMatch(page, /href="[^"]*privacy[-.]/i);
  assert.match(page, /All prizes are owned, sourced and provided by the Sponsor\./);
  assert.doesNotMatch(page, /does not supply prizes/i);
  assert.doesNotMatch(page, /not responsible for prize delivery/i);
  assert.doesNotMatch(page, /revenue share|splits each shop/i);
  assert.doesNotMatch(page, /hello@|privacy@hometowncrawls\.com/i);
  assert.doesNotMatch(page, /application\/ld\+json/);
});

test("crawl page structured data does not state unannounced prize or clock facts", () => {
  const crawl = fs.readFileSync(path.join(root, "puyallup/holiday-coffee-crawl/index.html"), "utf8");
  const ld = crawl.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(ld, "missing crawl JSON-LD");
  const blob = JSON.stringify(JSON.parse(ld[1]));
  assert.doesNotMatch(blob, /To be announced|num_winners|prize_description|total_arv|startTime|endTime|timeZone|winner/i);
  assert.match(blob, /2026-11-01/);
  assert.match(blob, /2026-12-31/);
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
