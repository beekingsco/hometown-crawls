const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("guest routes open the passport and shop signup stays a shop page", () => {
  const vercel = JSON.parse(read("vercel.json"));
  const redirects = new Map(vercel.redirects.map((row) => [row.source, row.destination]));
  assert.equal(redirects.get("/puyallup"), "/puyallup/holiday-coffee-crawl");
  assert.equal(redirects.get("/puyallup/"), "/puyallup/holiday-coffee-crawl");
  assert.equal(redirects.get("/faq"), "/faqs");
  assert.equal(redirects.get("/faq/"), "/faqs");
  assert.equal(redirects.get("/help"), "/support");
  assert.equal(redirects.get("/help/"), "/support");
  assert.equal(redirects.get("/play"), "/puyallup/holiday-coffee-crawl");
  assert.equal(redirects.get("/shops/join"), "/puyallup/coffee-crawl");
  assert.equal(redirects.has("/prizes"), false);
  assert.equal(redirects.has("/prizes.html"), false);

  const signup = read("puyallup/coffee-crawl/index.html");
  assert.match(signup, /Crawling\? Get your passport/);
  assert.match(signup, /href="\/puyallup\/holiday-coffee-crawl"/);
  assert.match(signup, /\$49\.99/);
  assert.match(signup, /id="pc-form"/);
});

test("Puyallup guest page keeps approved prizes and says paper stamps count", () => {
  const holiday = read("puyallup/holiday-coffee-crawl/index.html");
  const rules = read("puyallup/holiday-coffee-crawl/rules/index.html");
  const config = JSON.parse(read("puyallup/holiday-coffee-crawl/rules/config.json"));
  assert.match(holiday, /Fill your passport to enter the prize drawing\./);
  assert.match(holiday, /What are the prizes\?/);
  assert.match(holiday, /weekly giveaways/);
  assert.match(holiday, /first 50/);
  assert.match(holiday, /grand prizes/);
  assert.match(holiday, /Paper stamps count the same as stamps in the web app\. You can switch to the web app anytime\./);
  assert.match(holiday, /does not add a prize entry/);
  assert.match(rules, /prize drawing/);
  assert.doesNotMatch(rules, /does not include a drawing or awards/);
  assert.equal(config.drawing_offered, undefined);
  assert.equal(config.drawing_date, "Monday, January 4, 2027");
  assert.match(read("sitemap.xml"), /https:\/\/www\.hometowncrawls\.com\/prizes/);
  assert.match(read("assets/site.js"), /prizes\.html/);
  assert.match(read("account.html"), /id="entries-card"/);
  assert.doesNotMatch(read("account.html"), /id="entries-card" hidden/);
});

test("Arlington guest passport stays on prize hold", () => {
  const arlington = read("arlington/holiday-coffee-crawl/index.html");
  assert.match(arlington, /<h3>Fill your passport\.<\/h3>/);
  assert.doesNotMatch(arlington, /prize drawing|What are the prizes\?|weekly giveaways/i);
  assert.doesNotMatch(arlington, /Paper stamps count the same/);
});
