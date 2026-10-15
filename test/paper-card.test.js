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

test("printable card is one portrait page with stamps and the shop key", () => {
  assert.match(cardHtml, /id="card-sheets"/);
  assert.match(cardHtml, /id="card-print"/);
  assert.match(cardHtml, /Download &amp; print/);
  assert.match(cardHtml, /one portrait letter page/);
  assert.doesNotMatch(cardHtml, /id="card-print-single"/);
  assert.match(cardJs, /Bring your finished card to a co-organizer shop \(e\.g\. Holiday Cafe, Anthem\)\./);
  assert.match(read("assets/card-holiday.js"), /Holiday/);
  assert.match(cardJs, /PARTICIPATING SHOPS/);
  assert.match(cardJs, /USE THIS KEY TO FIND YOUR NEXT STOP/);
  assert.match(cardJs, /SIP/);
  assert.match(cardJs, /NO PURCHASE NECESSARY/);
  assert.match(cardJs, /mascot\.png/);
  assert.doesNotMatch(cardJs, /wordmark-phone\.png/);
  assert.doesNotMatch(cardJs, /card-fold/);
  assert.doesNotMatch(cardJs, /initials/i);
  const css = read("assets/card-print.css");
  assert.match(css, /size: letter portrait/);
  assert.match(css, /#ad4424/i);
  assert.match(css, /#fffaf1/i);
  assert.match(css, /width: 20%/);
  assert.match(css, /var\(--stamp/);
  assert.match(css, /height: 11in/);
});

test("stamp numbers follow the alphabetical shop key", () => {
  const cardSandbox = {
    document: { addEventListener() {}, getElementById() { return null; }, createElement() { return {}; } },
    URLSearchParams,
    Intl,
    Date
  };
  cardSandbox.window = cardSandbox;
  vm.runInNewContext(cardJs, cardSandbox, { filename: "assets/card-print.js" });
  assert.equal(cardSandbox.HCCard.subtitle("Puyallup Holiday Coffee Crawl"), "");
  assert.equal(
    cardSandbox.HCCard.subtitle("Puyallup Pub Crawl", "2026-10-01T18:00:00Z", "2026-12-01T06:59:00Z"),
    "OCTOBER 1 – NOVEMBER 30, 2026"
  );
  assert.deepEqual(cardSandbox.HCCard.orderedShops([
    { display_name: "Woods Coffee" },
    { display_name: "ANTHEM Coffee" },
    { display_name: "ANTHEM Coffee" },
    { display_name: "Holiday Cafe" }
  ]), ["ANTHEM Coffee", "Holiday Cafe", "Woods Coffee"]);
  const roomy = cardSandbox.HCCard.scaleFor(15);
  const crowded = cardSandbox.HCCard.scaleFor(70);
  assert.ok(parseFloat(roomy.stamp) > parseFloat(crowded.stamp));
  assert.ok(parseFloat(roomy.list) > parseFloat(crowded.list));
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

