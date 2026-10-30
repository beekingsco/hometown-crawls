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

test("drawing stays off and stored owner values are not published as a drawing", () => {
  assert.equal(config.drawing_offered, false);
  for (const [key, value] of Object.entries(FILLED)) assert.equal(config[key], value, key);
  assert.equal(config.registration_notice, "");
  for (const key of STILL_TBA) assert.equal(config[key], null, key);
  for (const key of Object.keys(config)) {
    if (key in FILLED || key === "registration_notice" || key === "drawing_offered" || STILL_TBA.includes(key)) continue;
    assert.fail("unexpected config key " + key);
  }
  assert.doesNotMatch(page, /id="crawl-rules-config"/);
  assert.doesNotMatch(page, /Monday, January 4, 2027|bonus entries|prize drawing|raffle|winner|To be announced/i);
  assert.match(page, /This crawl does not include a drawing or awards\./);
});

test("official rules page is indexable, links privacy, and does not promise a drawing", () => {
  assert.doesNotMatch(page, /\{\{[^}]+\}\}/);
  assert.doesNotMatch(page, /noindex/i);
  assert.match(page, /content="index, follow"/);
  assert.match(page, /rel="canonical" href="https:\/\/www\.hometowncrawls\.com\/puyallup\/holiday-coffee-crawl\/rules"/);
  assert.match(page, /<a href="\/privacy">Hometown Crawls Privacy Policy<\/a>/);
  assert.match(page, /href="mailto:chris@beekings\.com"/);
  assert.match(page, /Miracle Studios, Inc\./);
  assert.doesNotMatch(page, /prize/i);
  assert.doesNotMatch(page, /hello@|privacy@hometowncrawls\.com/i);
  assert.doesNotMatch(page, /application\/ld\+json/);
  assert.doesNotMatch(page, /revenue share|splits each shop/i);
});

test("paper passports keep the Pacific turn-in deadline without entry math", () => {
  assert.match(page, /Completed paper cards must be turned in by end of day December 31, 2026 \(Pacific\)\./);
  assert.match(page, /Paper stamps count the same as stamps in the web app\. You can switch to the web app anytime\./);
  assert.doesNotMatch(page, /1 entry for each Stop|completion bonus|mail-in/i);
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
  assert.doesNotMatch(sitemap, /https:\/\/www\.hometowncrawls\.com\/prizes/);
  assert.match(vercel, /"source": "\/puyallup\/holiday-coffee-crawl\/rules"/);
  assert.match(vercel, /"destination": "\/puyallup\/holiday-coffee-crawl\/rules\/index.html"/);
  assert.match(crawl, /href="\/puyallup\/holiday-coffee-crawl\/rules"/);
  assert.match(siteJs, /puyallup\/holiday-coffee-crawl\/rules/);
  assert.doesNotMatch(siteJs, /prizes\.html/);
  assert.match(crawl, /site\.js\?v=5/);
  assert.match(siteJs, /link\("privacy", "Privacy"\)/);
});
