const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const css = fs.readFileSync(path.join(root, "assets/site.css"), "utf8");
const account = fs.readFileSync(path.join(root, "account.html"), "utf8");
const artJs = fs.readFileSync(path.join(root, "assets/stamp-art.js"), "utf8");
const crawlJs = fs.readFileSync(path.join(root, "assets/crawl.js"), "utf8");
const holiday = fs.readFileSync(path.join(root, "puyallup/holiday-coffee-crawl/index.html"), "utf8");
const migration = fs.readFileSync(path.join(root, "migrations/20261014190000_stamp_art.sql"), "utf8");

test("passport art is grey until stamped, then full color", () => {
  assert.match(css, /\.stamp img\.stamp-art\s*\{[^}]*filter:\s*grayscale\(1\)/);
  assert.match(css, /\.stamp img\.stamp-art\s*\{[^}]*opacity:\s*0\.4/);
  assert.match(css, /\.stamp\.got img\.stamp-art\s*\{[^}]*filter:\s*none/);
  assert.match(css, /\.stamp\.got img\.stamp-art\s*\{[^}]*opacity:\s*1/);
  assert.match(css, /@keyframes stamp-pop/);
  assert.match(css, /@keyframes stamp-ink/);
});

test("store tab explains the square crop and the file limits", () => {
  assert.match(account, /id="stamp-art-form"/);
  assert.match(account, /id="file-stamp"/);
  assert.match(account, /id="file-logo"/);
  assert.match(account, /Square crop/);
  assert.match(account, /PNG, JPG, or WebP, up to 2 MB/);
  assert.match(account, /assets\/stamp-art\.js/);
  assert.match(artJs, /2 \* 1024 \* 1024/);
  assert.match(artJs, /image\/png/);
  assert.match(artJs, /image\/jpeg/);
  assert.match(artJs, /image\/webp/);
  assert.doesNotMatch(artJs, /image\/gif/);
});

test("demo keeps stamp art local and live upload is owner-only", () => {
  const handler = artJs.indexOf("async function onFile");
  const demoReturn = artJs.indexOf("if (demoOn())", handler);
  const liveSave = artJs.indexOf("saveLive(", handler);
  assert.ok(handler > -1 && demoReturn > handler && demoReturn < liveSave);
  assert.match(artJs, /shop_set_stamp_art/);
  assert.doesNotMatch(artJs, /service_role/);
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path to ''/);
  assert.match(migration, /revoke all on function public\.shop_set_stamp_art\(uuid, text, text\) from anon/);
  assert.doesNotMatch(migration, /grant update on public\.shop_listings to anon/);
  assert.doesNotMatch(migration, /grant update on public\.shop_listings to authenticated/);
});

test("migration adds paths and public urls without dropping paid filters", () => {
  assert.ok(migration.indexOf("drop view if exists public.crawl_shops_public") < migration.indexOf("drop function if exists public.get_public_crawl_shops(text)"));
  assert.match(migration, /stamp_image_path text/);
  assert.match(migration, /logo_path text/);
  assert.match(migration, /stamp_image_url text/);
  assert.match(migration, /logo_url text/);
  assert.match(migration, /where l\.is_paid and l\.is_approved/);
  assert.match(migration, /v_owner <> v_uid/);
});

test("render falls back from stamp image to logo to a text label", () => {
  const store = { hcStamp: "" };
  const sandbox = {
    window: {},
    location: { hash: "", search: "?demo=1", origin: "https://example.com" },
    localStorage: {
      getItem() { return store.hcStamp; },
      setItem(_key, value) { store.hcStamp = value; }
    },
    document: {},
    URLSearchParams,
    navigator: {}
  };
  vm.runInNewContext(crawlJs, sandbox);
  store.hcStamp = JSON.stringify({
    anthem: { stamp: "https://cdn.example/stamp.png", logo: "https://cdn.example/logo.png" }
  });
  const el = { innerHTML: "" };
  sandbox.window.HCCrawl.renderStamps(el, [
    { id: "anthem", name: "Anthem Coffee", stamp_image_url: "", logo_url: "" },
    { id: "woods", name: "Woods Coffee", stamp_image_url: "", logo_url: "https://cdn.example/woods-logo.png" },
    { id: "lick", name: "Lick Homemade Ice cream" }
  ], [{ business_id: "anthem" }], "anthem");
  assert.match(el.innerHTML, /class="stamp got just"/);
  assert.match(el.innerHTML, /https:\/\/cdn\.example\/stamp\.png/);
  assert.doesNotMatch(el.innerHTML, /cdn\.example\/logo\.png/);
  assert.match(el.innerHTML, /https:\/\/cdn\.example\/woods-logo\.png/);
  assert.match(el.innerHTML, /class="stamp-label">Lick</);
  assert.match(el.innerHTML, /stamp-art/);

  sandbox.location.search = "";
  const live = { innerHTML: "" };
  sandbox.window.HCCrawl.renderStamps(live, [
    { id: "anthem", name: "Anthem Coffee", stamp_image_url: "https://cdn.example/live-stamp.png", logo_url: "https://cdn.example/live-logo.png" }
  ], [], "");
  assert.match(live.innerHTML, /live-stamp\.png/);
  assert.doesNotMatch(live.innerHTML, /class="stamp got/);
  assert.doesNotMatch(live.innerHTML, /cdn\.example\/stamp\.png"/);
});

test("helpers reject oversized and non image files", () => {
  const sandbox = {
    window: {},
    location: { search: "", hash: "" },
    localStorage: { getItem() { return null; }, setItem() {} },
    document: { addEventListener() {}, getElementById() { return null; } },
    URLSearchParams
  };
  vm.runInNewContext(artJs, sandbox);
  assert.equal(sandbox.window.HCStampArt.acceptFile({ type: "image/gif", size: 1000 }), "Use a PNG, JPG, or WebP image.");
  assert.equal(sandbox.window.HCStampArt.acceptFile({ type: "image/png", size: sandbox.window.HCStampArt.MAX_BYTES + 1 }), "Images need to be 2 MB or smaller.");
  assert.equal(sandbox.window.HCStampArt.acceptFile({ type: "image/webp", size: 1000 }), "");
  assert.equal(sandbox.window.HCStampArt.artSrc("", "logo"), "logo");
  assert.equal(sandbox.window.HCStampArt.artSrc("stamp", "logo"), "stamp");
  assert.equal(sandbox.window.HCStampArt.artSrc("", ""), "");
  assert.equal(sandbox.window.HCStampArt.extFor("image/png"), "png");
});

test("holiday passport passes stamp art through", () => {
  assert.match(holiday, /stamp_image_url: s\.stamp_image_url/);
  assert.match(holiday, /refreshStamps\(pending\.shop\)/);
  assert.match(holiday, /refreshStamps\(business\)/);
});
