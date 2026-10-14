const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const account = read("account.html");
const crawl = read("assets/crawl.js");
const demo = read("assets/store-demo.js");
const config = read("assets/config.js");
const site = read("assets/site.js");
const guest = read("assets/guest-hub.js");
const listing = read("assets/store-listing.js");
const organizer = read("assets/organizer-panel.js");
const holiday = read("puyallup/holiday-coffee-crawl/index.html");
const coffee = read("puyallup/coffee-crawl/index.html");
const rules = read("rules.html");
const faqs = read("faqs.html");
const home = read("index.html");
const guide = read("guides/how-a-hometown-coffee-crawl-works.html");
const sign = read("puyallup/coffee-crawl/shop/sign/index.html");
const visibility = read("migrations/20261014200000_visibility_contributor_listing.sql");
const codes = read("migrations/20261014210000_per_crawl_codes_no_bypass.sql");
const consent = read("migrations/20261014220000_guest_consent.sql");
const bonus = read("migrations/20261014230000_bonus_actions.sql");
const photos = read("migrations/20261014240000_guest_photos.sql");
const claim = read("migrations/20260928150000_claim_stamp_enforce_rules.sql");

test("anonymous sign-in is gone and Log in sits in the header", () => {
  for (const file of [account, crawl, site, home, faqs, guide]) {
    assert.doesNotMatch(file, /signInAnonymously|btn-anon|Continue without an account/i);
  }
  assert.match(site, /id="nav-login"/);
  assert.match(site, />Log in</);
  assert.match(account, /id="contact-consent"/);
  assert.match(account, /participating stores and organizers can access my info/);
  assert.match(account, /record_guest_consent/);
  assert.match(account, /get\("demo"\) !== "1"/);
});

test("coupon stays off until the store turns it on", () => {
  assert.match(config, /enabled: false/);
  assert.match(account, /id="coupon-enabled"/);
  assert.match(account, /id="coupon-fields"/);
  assert.match(demo, /coupon\.enabled === true/);
  assert.match(demo, /coupon-fields/);
});

test("copy uses paid locations, golden rules, three steps, and 50 meters", () => {
  assert.doesNotMatch(holiday, /20\+/);
  assert.doesNotMatch(coffee, /20\+/);
  assert.match(holiday, /Golden Rules of a Crawl/);
  assert.equal((read("index.html").match(/<h2>Three steps to a full passport<\/h2>/g) || []).length, 1);
  assert.doesNotMatch(read("index.html"), /Four simple steps/);
  assert.match(read("index.html"), /Sign in with your email and join the crawl\./);
  assert.match(read("index.html"), /Visit shops and scan or enter the code to stamp your passport\./);
  assert.match(read("index.html"), /Fill your passport to enter the prize drawing\./);
  for (const rel of ["index.html", "puyallup/holiday-coffee-crawl/index.html", "rules.html", "faqs.html", "organize.html"]) {
    assert.doesNotMatch(read(rel), /A few plain rules/);
  }
  assert.match(holiday, /Show some love if you can and buy something at the shop\./);
  assert.match(holiday, /Your passport is saved to your account, so sign in on any device\./);
  assert.match(holiday, /Sign in with your email and join the crawl\./);
  assert.match(rules, /Show some love if you can and buy something at the shop\./);
  assert.match(rules, /50 m/);
  assert.match(faqs, /Show some love if you can and buy something at the shop\./);
  assert.match(holiday, /id="location-count"/);
  assert.match(holiday, /paid location/);
});

test("store tab edits the listing, rotates a code, and prints the counter sign", () => {
  assert.match(account, /id="listing-form"/);
  assert.match(account, /id="list-stamp-label"/);
  assert.match(account, /id="file-list-stamp"/);
  assert.match(account, /id="file-list-logo"/);
  assert.match(account, /id="btn-rotate-code"/);
  assert.match(account, /id="btn-print-sign"/);
  assert.match(listing, /shop_save_listing/);
  assert.match(listing, /shop_set_photo_paths/);
  assert.match(listing, /if \(!form \|\| !demoOn\(\)\) return/);
  const rotate = demo.indexOf("btn-rotate-code");
  const demoBranch = demo.indexOf("if (demoRequested())", rotate);
  const rpc = demo.indexOf("shop_rotate_store_code", rotate);
  assert.ok(demoBranch > rotate && demoBranch < rpc);
  assert.match(sign, /Join our Hometown Crawl/);
  assert.match(sign, /Sign in with your email and join the crawl\./);
  assert.match(sign, /hometowncrawls.com\/play/);
  assert.match(sign, /DEMO DATA/);
  assert.match(read("vercel.json"), /shop\/sign\/index\.html/);
});

test("organizer tab has no revenue split and seeds contributor without demoting the owner", () => {
  assert.match(account, /id="panel-organizer"/);
  assert.match(account, /id="org-details"/);
  assert.match(organizer, /organizer_set_shop_visible/);
  assert.match(organizer, /organizer_update_crawl/);
  assert.match(organizer, /Chris Miller/);
  assert.match(organizer, /contributor/);
  assert.doesNotMatch(organizer, /organizer_share|revenue split|hc_share/);
  assert.match(visibility, /'contributor'/);
  assert.match(visibility, /on conflict \(crawl_id, organizer_id\) do nothing/);
  assert.match(visibility, /bryan@myanthemcoffee.com/);
  assert.match(visibility, /chris@beekings.com/);
  assert.match(visibility, /0,\s*0,/);
  assert.match(visibility, /is_paid and l\.is_approved and l\.is_visible/);
  assert.match(read("puyallup/coffee-crawl/organizer/index.html"), /organizer_set_shop_visible/);
});

test("demo never stamps, joins, or uploads, and claim_stamp has no bypass", () => {
  assert.match(crawl, /Demo mode only shows sample data\. It does not join a crawl\./);
  assert.match(crawl, /Demo mode only shows sample data\. It does not stamp\./);
  assert.match(crawl, /function demoMode\(\)/);
  const photo = guest.indexOf("async function onPhotoSubmit");
  const demoReturn = guest.indexOf("if (demoOn())", photo);
  const storage = guest.indexOf('from("guest-photos")', photo);
  assert.ok(demoReturn > photo && demoReturn < storage);
  assert.match(codes, /drop column if exists demo_bypass_until/);
  assert.doesNotMatch(codes.slice(codes.indexOf("create or replace function public.claim_stamp")), /demo_bypass/);
  assert.match(codes, /c_radius_m constant double precision := 50/);
  assert.match(claim, /50/);
  assert.doesNotMatch(claim, /demo_bypass/);
  assert.match(codes, /crawl_shop_codes/);
});

test("guest entries, bonus actions, and photo consent are present", () => {
  assert.match(account, /id="entries-card"/);
  assert.match(account, /id="bonus-confirm"/);
  assert.match(account, /I give Hometown Crawls permission to show this photo/);
  assert.match(guest, /1 entry for each stop/);
  assert.match(guest, /guest_submit_bonus/);
  assert.match(holiday, /guest-hub\.js/);
  assert.match(holiday, /id="crawl-photo-form"/);
  assert.match(consent, /record_guest_consent/);
  assert.match(bonus, /guest_submit_bonus/);
  assert.match(photos, /moderate_guest_photo/);
  assert.match(photos, /guest-photos/);
  assert.match(read("privacy/index.html"), /Guest crawl photos/);
  assert.equal((read("privacy/index.html").match(/<h2 /g) || []).length, 14);
});

test("stamp labels drop filler words and keep cream", () => {
  const sandbox = {
    window: {},
    location: { hash: "", search: "", origin: "https://example.com" },
    localStorage: { getItem() { return null; }, setItem() {} },
    document: {},
    URLSearchParams,
    navigator: {}
  };
  vm.runInNewContext(crawl, sandbox);
  const label = sandbox.window.HCCrawl.stampLabel;
  assert.equal(label("The Cat & Rabbitt Bakery"), "Cat & Rabbitt");
  assert.equal(label("Pink Chandelier"), "Pink Chandelier");
  assert.equal(label("Lick Homemade Ice cream"), "Lick Ice Cream");
  assert.equal(label("Wanna Cupcake?"), "Wanna Cupcake?");
  assert.equal(label("Anthem Coffee", "Anthem"), "Anthem");
});
