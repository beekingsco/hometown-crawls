const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const migration = read("migrations/20261022140000_organizer_shop_edit.sql");
const account = read("account.html");
const organizer = read("assets/organizer-panel.js");
const listing = read("assets/store-listing.js");
const holiday = read("puyallup/holiday-coffee-crawl/index.html");
const card = read("assets/card-holiday.js");

test("zip and organizer shop edits are gated by crawl staff", () => {
  assert.match(migration, /add column if not exists postal_code text/);
  assert.match(migration, /private\.is_crawl_staff\(l\.crawl_id\)/);
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path to ''/);
  assert.match(migration, /shop_images_staff_insert/);
  assert.match(migration, /private\.can_manage_shop_image/);
  assert.match(migration, /organizer_shop_listing/);
  assert.match(migration, /Not authorized/);
  assert.doesNotMatch(migration, /grant execute on function public\.shop_save_listing\(uuid, text, text, text, text, text, text, text, text, text\) to anon/);
  assert.doesNotMatch(migration, /grant execute on function public\.shop_save_listing\(uuid, text, text, text, text, text, text, text, text, text\) to service_role/);
  assert.doesNotMatch(migration, /service_role/);
  assert.match(account, /id="list-postal"/);
  assert.match(account, /id="org-shop-form"/);
  assert.match(account, /id="org-shop-postal"/);
  assert.match(account, /id="file-org-stamp"/);
  assert.match(account, /id="file-org-cover"/);
  assert.match(listing, /p_postal: draft\.postal/);
  assert.match(organizer, /data-edit-shop/);
  assert.match(organizer, /organizer_shop_listing/);
  assert.match(organizer, /shop_save_listing/);
  assert.match(organizer, /shop_set_stamp_art/);
  assert.doesNotMatch(organizer, /service_role/);
});

test("Puyallup display name changes in data and the public URL stays", () => {
  assert.match(migration, /set name = 'Downtown Puyallup Holiday Coffee Crawl'/);
  assert.match(migration, /where id = 'puy-coffee'/);
  assert.doesNotMatch(migration, /update public\.crawls[\s\S]*set id/);
  assert.match(holiday, /https:\/\/www\.hometowncrawls\.com\/puyallup\/holiday-coffee-crawl/);
  assert.match(holiday, /id="crawl-display-name"/);
  assert.match(holiday, /from\("crawls"\)\.select\("name"\)/);
  assert.match(holiday, /Zip /);
  assert.match(holiday, /stamp_image_url/);
  assert.match(card, /m\.crawlName \|\| 'Puyallup Holiday Coffee Crawl'/);
  assert.match(read("assets/crawl.js"), /Zip \$\{escapeHtml\(shop\.postal_code\)\}/);
});

test("printable card uses the live crawl name and shop zip", () => {
  const sandbox = {
    window: {},
    document: { addEventListener() {}, getElementById() { return null; } },
    location: { search: "" },
    URLSearchParams,
    Intl,
    Date
  };
  sandbox.window = sandbox;
  vm.runInNewContext(read("assets/card-holiday.js"), sandbox);
  vm.runInNewContext(read("assets/card-print.js"), sandbox);
  const html = sandbox.HCHolidayCard.markup({
    crawlId: "puy-coffee",
    crawlName: "Downtown Puyallup Holiday Coffee Crawl",
    shops: ["Happy Donuts · 98372"],
    playerName: "",
    playerEmail: "",
    signupShop: "",
    turnIn: []
  });
  assert.match(html, /Downtown Puyallup Holiday Coffee Crawl/);
  assert.match(html, /Happy Donuts · 98372/);
  assert.deepEqual(
    sandbox.HCCard.orderedShops([{ display_name: "Happy Donuts", postal_code: "98372" }]),
    ["Happy Donuts · 98372"]
  );
});
