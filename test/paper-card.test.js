const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const account = read("account.html");
const paper = read("assets/paper-card.js");
const cardJs = read("assets/card-print.js");
const cardHtml = read("card.html");
const sql = read("migrations/20261014260000_paper_cards.sql");
const claim = read("migrations/20261014210000_per_crawl_codes_no_bypass.sql");

const sandbox = {
  document: {
    addEventListener() {},
    getElementById() { return null; }
  },
  URLSearchParams,
  sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  history: { replaceState() {} },
  location: { search: "", pathname: "/account" }
};
sandbox.window = sandbox;
vm.runInNewContext(paper, sandbox, { filename: "assets/paper-card.js" });

test("paper signup copy, terms, and consent stay on the guest form", () => {
  assert.match(account, /Play with a paper card/);
  assert.match(account, /id="paper-terms"/);
  assert.match(account, /id="contact-consent"/);
  assert.match(account, /You're in the game! Take this to the counter to request your paper card\./);
  assert.match(account, /Download &amp; print your card/);
  assert.match(account, /Ask at the counter/);
  assert.match(account, /assets\/home\/mascot\.png/);
  assert.match(account, /id="btn-print-card"/);
  assert.match(account, /id="player-search"/);
  assert.doesNotMatch(account, /signInAnonymously/);
});

test("printable card is 2-up ink circles with the turn-in line", () => {
  assert.match(cardHtml, /id="card-sheets"/);
  assert.match(cardJs, /Bring your finished card to a co-organizer shop \(e\.g\. Holiday Cafe, Anthem\)\./);
  assert.match(cardJs, /NO PURCHASE NECESSARY/);
  assert.match(cardJs, /wordmark-phone\.png/);
  assert.match(cardJs, /mascot\.png/);
  assert.doesNotMatch(cardJs.slice(cardJs.indexOf("var RULES")), /initials/i);
  assert.match(read("assets/card-print.css"), /size: letter/);
  assert.match(read("assets/card-print.css"), /nth-child\(2\)/);
});

test("manual stamps are staff-only and claim_stamp still uses 50 meters", () => {
  assert.match(sql, /play_mode = 'paper'/);
  assert.match(sql, /signup_listing_id/);
  assert.match(sql, /private\.is_crawl_staff/);
  assert.match(sql, /'owner', 'organizer', 'co-organizer', 'contributor'/);
  assert.doesNotMatch(sql, /grant execute on function public\.organizer_set_manual_stamp[\s\S]*to anon/);
  assert.doesNotMatch(sql, /grant execute on function public\.record_paper_play[\s\S]*to anon/);
  assert.doesNotMatch(sql, /service_role/);
  assert.match(sql, /p_business, 'manual'/);
  const manual = sql.slice(sql.indexOf("function public.organizer_set_manual_stamp"));
  assert.doesNotMatch(manual, /claim_stamp|c_radius/);
  assert.match(claim, /c_radius_m constant double precision := 50/);
  assert.doesNotMatch(paper, /service_role/);
  assert.doesNotMatch(cardJs, /service_role/);
});

test("shop query matches a listing id or a business id", () => {
  const rows = [
    { listing_id: "9bf4ca90-be90-421d-8325-752c595c36f7", business_id: "anthem", display_name: "ANTHEM Coffee" }
  ];
  assert.equal(sandbox.HCPaper.matchShop(rows, "anthem").display_name, "ANTHEM Coffee");
  assert.equal(sandbox.HCPaper.matchShop(rows, "9bf4ca90-be90-421d-8325-752c595c36f7").business_id, "anthem");
  assert.equal(sandbox.HCPaper.matchShop(rows, ""), null);
  assert.match(sandbox.HCPaper.TURN_IN, /Holiday Cafe, Anthem/);
});
