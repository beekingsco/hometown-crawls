const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("guest entry points skip shop signup and held prize pages", () => {
  const vercel = JSON.parse(read("vercel.json"));
  const redirects = new Map(vercel.redirects.map((row) => [row.source, row.destination]));
  assert.equal(redirects.get("/puyallup"), "/puyallup/holiday-coffee-crawl");
  assert.equal(redirects.get("/puyallup/"), "/puyallup/holiday-coffee-crawl");
  assert.equal(redirects.get("/faq"), "/faqs");
  assert.equal(redirects.get("/help"), "/support");
  assert.equal(redirects.get("/prizes"), "/puyallup/holiday-coffee-crawl");
  assert.equal(redirects.get("/play"), "/puyallup/holiday-coffee-crawl");
  assert.equal(redirects.get("/shops/join"), "/puyallup/coffee-crawl");

  const signup = read("puyallup/coffee-crawl/index.html");
  assert.match(signup, /Crawling\? Get your passport/);
  assert.match(signup, /href="\/puyallup\/holiday-coffee-crawl"/);
  assert.match(signup, /\$49\.99/);

  const home = read("index.html");
  const holiday = read("puyallup/holiday-coffee-crawl/index.html");
  const rules = read("rules.html");
  const prizes = read("prizes.html");
  for (const file of [home, holiday, rules, read("assets/site.js"), read("sitemap.xml")]) {
    assert.doesNotMatch(file, /prizes\.html|Prize updates|prize drawing|Prizes are TBA/i);
  }
  assert.match(holiday, /Paper stamps count the same as stamps in the web app\. You can switch to the web app anytime\./);
  assert.match(prizes, /noindex/);
  assert.match(prizes, /url=\/puyallup\/holiday-coffee-crawl/);
  assert.doesNotMatch(prizes, /prize|drawing|raffle/i);
});
