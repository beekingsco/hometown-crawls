const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const migration = read("migrations/20261101140000_organizer_shop_counter_card.sql");
const account = read("account.html");
const organizer = read("assets/organizer-panel.js");
const cardJs = read("assets/counter-card.js");
const cardCss = read("assets/counter-card.css");
const help = read("account/organizer/help/index.html");
const hostCard = read("puyallup/coffee-crawl/shop/card/index.html");
const shop = read("puyallup/coffee-crawl/shop/index.html");

test("staff RPC returns counter codes without opening them to guests", () => {
  assert.match(migration, /create function public\.organizer_shop_counter_card\(p_listing uuid\)/);
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path to ''/);
  assert.match(migration, /stable/);
  assert.match(migration, /private\.is_crawl_staff\(l\.crawl_id\)/);
  assert.match(migration, /Not authorized/);
  assert.match(migration, /Not authenticated/);
  assert.match(migration, /coalesce\(k\.store_code, case when l\.is_paid then b\.store_code end\)/);
  assert.match(migration, /coalesce\(k\.qr_secret, case when l\.is_paid then b\.qr_secret end\)/);
  assert.match(migration, /left join public\.crawl_shop_codes k on k\.listing_id = l\.id and k\.crawl_id = l\.crawl_id/);
  assert.match(migration, /revoke all on function public\.organizer_shop_counter_card\(uuid\) from public/);
  assert.match(migration, /revoke all on function public\.organizer_shop_counter_card\(uuid\) from anon/);
  assert.match(migration, /grant execute on function public\.organizer_shop_counter_card\(uuid\) to authenticated/);
  assert.doesNotMatch(migration, /to anon/);
  assert.doesNotMatch(migration, /service_role/);
  assert.doesNotMatch(migration, /shop_rotate_store_code/);
  const body = migration.slice(migration.indexOf("as $function$"), migration.indexOf("$function$;"));
  assert.doesNotMatch(body, /owner_user_id/);
  assert.match(migration, /Unclaimed shops/);
  assert.doesNotMatch(migration, /grant select on public\.crawl_shop_codes/);
});

test("organizer stores open a counter card beside Edit and do not rotate codes", () => {
  const list = organizer.slice(organizer.indexOf("function renderLive"), organizer.indexOf("async function loadShops"));
  assert.match(list, /data-counter-card/);
  assert.match(list, />Counter card</);
  assert.ok(list.indexOf(">Counter card<") < list.indexOf(">Edit<"));
  assert.doesNotMatch(list, /qr_secret|store_code/);
  assert.match(account, /id="org-counter-card"/);
  assert.match(account, /id="org-counter-print"/);
  assert.match(account, /id="org-counter-download"/);
  assert.match(account, /id="org-counter-tent"/);
  assert.match(account, /assets\/counter-card\.css/);
  assert.match(account, /assets\/counter-card\.js/);
  assert.match(organizer, /organizer_shop_counter_card/);
  assert.match(organizer, /That counter card is only available to the crawl team\./);
  assert.match(organizer, /The database update still needs to be applied\./);
  assert.match(organizer, /This shop is not paid yet, so there is no counter card\./);
  assert.doesNotMatch(organizer, /shop_rotate_store_code/);
  assert.doesNotMatch(organizer, /service_role/);
});

test("organizer help tells staff they can print a counter card", () => {
  assert.match(help, /Counter card/);
  assert.match(help, /next to <strong>Edit<\/strong>/);
  assert.match(help, /has not opened the Store tab/);
  assert.match(help, /before the host has claimed Store/);
  assert.match(help, /Print counter card/);
  assert.match(help, /Download counter card/);
  assert.match(help, /Print counter sign/);
  assert.match(help, /Do not post the code online/);
  assert.doesNotMatch(help, /The counter code is on that tab/);
  assert.doesNotMatch(help, /service_role|RESEND_API_KEY/);
});

test("host tent and organizer tent share the shop and code QR", () => {
  assert.match(hostCard, /counter-card\.js/);
  assert.match(hostCard, /HCCounterCard\.tentHtml/);
  assert.match(hostCard, /class="hc-counter-print"/);
  assert.doesNotMatch(hostCard, /new URL\("https:\/\/www\.hometowncrawls\.com\/puyallup\/holiday-coffee-crawl"\)/);
  assert.match(shop, /HCCounterCard\.stampUrl/);
  assert.match(cardCss, /\.tent-face\.flip/);
  assert.match(cardCss, /\.fold-line/);
  assert.match(cardCss, /letter landscape|11in/);
  assert.match(cardJs, /searchParams\.set\("shop"/);
  assert.match(cardJs, /searchParams\.set\("code"/);
  assert.match(cardJs, /Get your passport stamped here/);

  const sandbox = {
    window: {},
    URL,
    URLSearchParams,
    console
  };
  sandbox.window = sandbox;
  vm.runInNewContext(read("assets/qrcode-generator.js"), sandbox, { filename: "assets/qrcode-generator.js" });
  vm.runInNewContext(cardJs, sandbox, { filename: "assets/counter-card.js" });
  const seen = [];
  const real = sandbox.qrcode;
  sandbox.qrcode = function () {
    const qr = real.apply(null, arguments);
    const add = qr.addData;
    qr.addData = function (data) {
      seen.push(data);
      return add.call(qr, data);
    };
    return qr;
  };

  const listing = {
    crawl_id: "puy-coffee",
    business_id: "anthem",
    qr_secret: "abc123",
    store_code: "ANTHEMCO",
    display_name: "Holiday Cafe"
  };
  assert.equal(
    sandbox.HCCounterCard.stampUrl(listing),
    "https://www.hometowncrawls.com/puyallup/holiday-coffee-crawl?shop=anthem&code=abc123"
  );
  assert.equal(
    sandbox.HCCounterCard.stampUrl({ crawl_id: "arl-coffee", business_id: "north", qr_secret: "xyz" }),
    "https://www.hometowncrawls.com/arlington/holiday-coffee-crawl?shop=north&code=xyz"
  );
  assert.equal(sandbox.HCCounterCard.stampUrl({ crawl_id: "puy-pub", business_id: "x", qr_secret: "y" }), "");
  assert.equal(sandbox.HCCounterCard.stampPage("puy-pub"), "");
  assert.equal(sandbox.HCCounterCard.tentHtml({ crawl_id: "puy-coffee", business_id: "anthem" }), "");

  const html = sandbox.HCCounterCard.tentHtml(listing);
  assert.match(html, /tent-face flip/);
  assert.match(html, /fold-line/);
  assert.match(html, /Get your passport stamped here/);
  assert.match(html, /ANTHEMCO/);
  assert.match(html, /Holiday Cafe/);
  assert.match(html, /<svg/i);
  assert.equal(seen[0], "https://www.hometowncrawls.com/puyallup/holiday-coffee-crawl?shop=anthem&code=abc123");

  const hostile = Object.assign({}, listing, { display_name: '<script>alert(1)</script>' });
  const safe = sandbox.HCCounterCard.tentHtml(hostile);
  assert.doesNotMatch(safe, /<script>/);
  assert.match(safe, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);

  const file = sandbox.HCCounterCard.downloadFile(listing, cardCss);
  assert.equal(file.name, "holiday-cafe-counter-card.html");
  assert.match(file.html, /@page \{ size: letter landscape; margin: 0; \}/);
  assert.match(file.html, /Get your passport stamped here/);
  assert.match(file.html, /ANTHEMCO/);
  assert.match(file.html, /Print counter card/);
  assert.doesNotMatch(file.name, /abc123|ANTHEMCO/);
});
