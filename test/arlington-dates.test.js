const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const pages = [
  "arlington/holiday-coffee-crawl/index.html",
  "arlington/coffee-crawl/index.html",
  "arlington/coffee-crawl/thanks/index.html",
];

test("Arlington guest, shop and confirmation pages use December 2026 through January 2027", () => {
  for (const rel of pages) {
    const html = read(rel);
    assert.match(html, /Dec 1, 2026 – Jan 31, 2027/, rel);
    assert.match(html, /December 1, 2026/, rel);
    assert.match(html, /January 31, 2027/, rel);
    assert.doesNotMatch(html, /November|Nov 1|December 31|Dec 31|2026-11-01|2026-12-31/, rel);
  }
});

test("Arlington structured event dates match the visible dates", () => {
  const html = read(pages[0]);
  const json = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
  const event = JSON.parse(json)["@graph"].find((item) => item["@type"] === "Event");
  assert.equal(event.startDate, "2026-12-01");
  assert.equal(event.endDate, "2027-01-31");
});

test("Arlington retains the existing one-time price and signup identity", () => {
  const html = read(pages[1]);
  assert.match(html, /\$49\.99 for the 2026–27 holiday season, one-time/);
  assert.match(html, /No subscription and no per-guest fees/);
  assert.match(html, /id: "arl-coffee-nov-2026"/);
  assert.match(html, /paymentLink: "https:\/\/buy\.stripe\.com\/8x214n6gm4Op89Ja9ngQE0e"/);
});
