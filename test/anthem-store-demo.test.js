const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const account = fs.readFileSync(path.join(root, "account.html"), "utf8");
const shop = fs.readFileSync(path.join(root, "puyallup/coffee-crawl/shop/index.html"), "utf8");
const demoJs = fs.readFileSync(path.join(root, "assets/store-demo.js"), "utf8");
const configJs = fs.readFileSync(path.join(root, "assets/config.js"), "utf8");

test("Anthem demo is one config and opens without a migration", () => {
  assert.match(configJs, /storeCode: "ANTHEMCO"/);
  assert.match(configJs, /name: "Anthem Coffee & Tea"/);
  assert.match(configJs, /reward: "\$1 off next drink"/);
  assert.match(configJs, /expiryDays: 30/);
  assert.match(configJs, /privacy@hometowncrawls\.com/);
  assert.match(account, /id="demo-banner"[^>]*><\/div>/);
  assert.doesNotMatch(account, /id="demo-banner"[\s\S]{0,200}ANTHEMCO/);
  assert.match(demoJs, /banner\.innerHTML/);
  assert.match(demoJs, /if \(demoRequested\(\)\)/);
  assert.match(account, /Total players/);
  assert.match(account, /Total scans/);
  assert.match(account, /Scans at this shop/);
  assert.match(account, /Share of scans/);
  assert.match(account, /First-time visitors/);
  assert.match(account, /id="coupon-reward"/);
  assert.match(account, /id="coupon-days"/);
  assert.match(account, /id="coupon-issued"/);
  assert.match(account, /id="coupon-redeemed"/);
  assert.match(account, /id="btn-guest-csv"/);
  assert.match(account, /id="guest-reward"/);
  assert.match(account, /id="guest-cards"/);
  assert.match(account, /guest-table-wrap/);
  assert.match(account, /assets\/store-demo\.js/);
  assert.match(demoJs, /id="guest-cards"|getElementById\("guest-cards"\)/);
  assert.match(demoJs, /record-name/);
  assert.match(demoJs, /record-email/);
  assert.match(fs.readFileSync(path.join(root, "assets/site.css"), "utf8"), /max-width: 639px/);
  assert.match(fs.readFileSync(path.join(root, "puyallup/coffee-crawl/organizer/index.html"), "utf8"), /id="shop-cards"/);
  assert.match(demoJs, /get\("demo"\) === "1"/);
  assert.match(demoJs, /consentedAt && row\.email && row\.name/);
  assert.match(demoJs, /DEMO DATA/);
  assert.match(shop, /\/account\?demo=1&tab=store/);
  assert.doesNotMatch(demoJs, /service_role|profiles\.role/);
});

function classList(initial) {
  const names = new Set(initial || []);
  return {
    toggle(name, on) {
      const force = on === undefined ? !names.has(name) : !!on;
      if (force) names.add(name);
      else names.delete(name);
      return force;
    },
    add(name) { names.add(name); },
    remove(name) { names.delete(name); },
    contains(name) { return names.has(name); }
  };
}

function rewardSandbox(search, storage, client) {
  const els = {};
  function el(id) {
    if (!els[id]) {
      els[id] = {
        id,
        value: "",
        checked: false,
        textContent: "",
        innerHTML: "",
        hidden: false,
        classList: classList(id === "guest-reward" || id === "coupon-fields" ? ["hidden"] : []),
        setAttribute() {},
        appendChild() {},
        click() {},
        remove() {}
      };
    }
    return els[id];
  }
  const sandbox = {
    document: {
      addEventListener() {},
      getElementById: el,
      querySelectorAll() { return []; },
      createElement() { return el("download"); },
      activeElement: null
    },
    location: { search, href: "https://www.hometowncrawls.com/account" + search },
    history: { replaceState() {} },
    localStorage: {
      getItem(key) { return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null; },
      setItem(key, value) { storage[key] = String(value); }
    },
    URL,
    URLSearchParams,
    Intl,
    HCCrawl: client ? { client } : undefined
  };
  sandbox.window = sandbox;
  sandbox.document.body = { appendChild() {} };
  vm.runInNewContext(configJs, sandbox);
  vm.runInNewContext(demoJs, sandbox);
  return { sandbox, els, storage };
}

test("live guest reward uses that shop name and does not share the Anthem key", () => {
  const storage = {
    "hc-coupon-anthemco": JSON.stringify({ enabled: true, reward: "ANTHEM ONLY", expiryDays: 9 }),
    "hc-coupon-listing-enchanted": JSON.stringify({ enabled: true, reward: "25% off next drink", expiryDays: 30 }),
    "hc-coupon-listing-other": JSON.stringify({ enabled: true, reward: "Free cookie", expiryDays: 7 })
  };
  const { sandbox, els } = rewardSandbox("", storage);
  sandbox.HCStoreDemo.useLiveListing({
    listing_id: "enchanted",
    display_name: "Enchanted Espresso",
    crawl_id: "puy-coffee",
    business_id: "sl-enchanted",
    reward_enabled: true,
    reward_text: "25% off next drink",
    reward_expiry_days: 30
  });
  assert.equal(els["guest-reward-text"].textContent, "25% off next drink");
  assert.equal(els["guest-reward-meta"].textContent, "Enchanted Espresso · show within 30 days of your stamp");
  assert.equal(els["guest-reward"].classList.contains("hidden"), false);
  assert.equal(els["coupon-issued"].textContent, "—");
  assert.equal(els["coupon-redeemed"].textContent, "—");
  assert.equal(sandbox.HCStoreDemo.couponStorageKey(), "hc-coupon-listing-enchanted");
  assert.doesNotMatch(els["guest-reward-text"].textContent, /ANTHEM ONLY/);
  assert.doesNotMatch(els["guest-reward-meta"].textContent, /Anthem/);
  sandbox.HCStoreDemo.setLiveShopName("Enchanted Espresso Roastery");
  assert.equal(els["guest-reward-meta"].textContent, "Enchanted Espresso Roastery · show within 30 days of your stamp");

  sandbox.HCStoreDemo.useLiveListing({
    listing_id: "other",
    display_name: "Pioneer Pour House",
    reward_enabled: true,
    reward_text: "Free cookie",
    reward_expiry_days: 7
  });
  assert.equal(els["guest-reward-text"].textContent, "Free cookie");
  assert.equal(els["guest-reward-meta"].textContent, "Pioneer Pour House · show within 7 days of your stamp");
  assert.equal(sandbox.HCStoreDemo.couponStorageKey(), "hc-coupon-listing-other");
  assert.doesNotMatch(els["guest-reward-text"].textContent, /25% off next drink/);

  sandbox.HCStoreDemo.useLiveListing({
    listing_id: "enchanted",
    display_name: "Enchanted Espresso"
  });
  assert.equal(els["guest-reward-text"].textContent, "25% off next drink");
  assert.equal(els["guest-reward-meta"].textContent, "Enchanted Espresso · show within 30 days of your stamp");
  assert.equal(Object.prototype.hasOwnProperty.call(storage, "hc-coupon-listing-enchanted"), true);
  assert.doesNotMatch(JSON.stringify(storage["hc-coupon-listing-other"] || ""), /25% off next drink/);
});

test("demo reward card still names Anthem Coffee & Tea", () => {
  const { sandbox, els } = rewardSandbox("?demo=1", {});
  sandbox.HCStoreDemo.paintCoupon({
    enabled: true,
    reward: "$1 off next drink",
    expiryDays: 30,
    issued: 64,
    redeemed: 11
  }, true);
  assert.equal(sandbox.HCStoreDemo.couponStorageKey(), "hc-coupon-anthemco");
  assert.equal(els["guest-reward-meta"].textContent, "Anthem Coffee & Tea · show within 30 days of your stamp");
  assert.equal(els["guest-reward-note"].textContent, "DEMO DATA. Guests see this only after the shop turns the reward on and they stamp.");
  assert.equal(els["coupon-issued"].textContent, "64");
  sandbox.HCStoreDemo.useLiveListing({
    listing_id: "enchanted",
    display_name: "Enchanted Espresso",
    reward_enabled: true,
    reward_text: "25% off next drink",
    reward_expiry_days: 30
  });
  assert.equal(els["guest-reward-meta"].textContent, "Anthem Coffee & Tea · show within 30 days of your stamp");
});

test("saving a live reward calls shop_save_reward for that listing", async () => {
  const storage = {};
  const calls = [];
  const { sandbox, els } = rewardSandbox("", storage, function () {
    return {
      rpc(name, args) {
        calls.push({ name, args });
        return Promise.resolve({ data: null, error: null });
      }
    };
  });
  sandbox.document.addEventListener = function (type, fn) {
    if (type === "DOMContentLoaded") fn();
  };
  vm.runInNewContext(demoJs, sandbox);
  sandbox.HCStoreDemo.useLiveListing({
    listing_id: "11111111-1111-4111-8111-111111111111",
    display_name: "Enchanted Espresso",
    crawl_id: "puy-coffee",
    reward_enabled: false,
    reward_text: null,
    reward_expiry_days: 30
  });
  els["coupon-enabled"].checked = true;
  els["coupon-reward"].value = "25% off next drink";
  els["coupon-days"].value = "30";
  await els["coupon-form"].onsubmit({ preventDefault() {} });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "shop_save_reward");
  assert.equal(calls[0].args.p_listing, "11111111-1111-4111-8111-111111111111");
  assert.equal(calls[0].args.p_enabled, true);
  assert.equal(calls[0].args.p_reward, "25% off next drink");
  assert.equal(calls[0].args.p_expiry_days, 30);
  assert.equal(els["guest-reward-meta"].textContent, "Enchanted Espresso · show within 30 days of your stamp");
  assert.equal(els["coupon-ok"].textContent, "Reward saved for this shop. Guests see it after they stamp.");
  assert.match(storage["hc-coupon-listing-11111111-1111-4111-8111-111111111111"], /25% off next drink/);
  assert.equal(storage["hc-coupon-anthemco"], undefined);
});

test("post-stamp reward migration is owner scoped and keeps shop_my_listings owner filter", () => {
  const migration = fs.readFileSync(path.join(root, "migrations/20261103193000_shop_post_stamp_reward.sql"), "utf8");
  const listing = fs.readFileSync(path.join(root, "assets/store-listing.js"), "utf8");
  assert.match(migration, /add column if not exists reward_enabled boolean not null default false/);
  assert.match(migration, /add column if not exists reward_text text/);
  assert.match(migration, /add column if not exists reward_expiry_days integer not null default 30/);
  assert.match(migration, /char_length\(reward_text\) between 1 and 140/);
  assert.match(migration, /reward_expiry_days between 1 and 365/);
  assert.match(migration, /create or replace function public\.shop_save_reward\(/);
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path to ''/);
  assert.match(migration, /if \(select auth\.uid\(\)\) is null then/);
  assert.match(migration, /l\.owner_user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /raise exception 'Not authorized'/);
  assert.match(migration, /revoke all on function public\.shop_save_reward\(uuid, boolean, text, integer\) from public/);
  assert.match(migration, /revoke all on function public\.shop_save_reward\(uuid, boolean, text, integer\) from anon/);
  assert.match(migration, /grant execute on function public\.shop_save_reward\(uuid, boolean, text, integer\) to authenticated/);
  assert.doesNotMatch(migration, /grant execute on function public\.shop_save_reward\([^)]*\) to anon/);
  assert.doesNotMatch(migration, /grant execute on function public\.shop_save_reward\([^)]*\) to service_role/);
  assert.doesNotMatch(migration, /service_role|user_metadata/);
  assert.match(migration, /reward_enabled boolean,\s+reward_text text,\s+reward_expiry_days integer/s);
  assert.match(migration, /l\.video_url,\s+l\.reward_enabled, l\.reward_text, l\.reward_expiry_days/s);
  assert.match(migration, /where l\.owner_user_id = \(select auth\.uid\(\)\)/);
  assert.match(demoJs, /DEMO_COUPON_KEY = "hc-coupon-anthemco"/);
  assert.match(demoJs, /hc-coupon-listing-/);
  assert.match(demoJs, /shop_save_reward/);
  assert.match(demoJs, /display_name/);
  assert.match(listing, /HCStoreDemo\.useLiveListing\(listing\)/);
  assert.match(listing, /HCStoreDemo\.setLiveShopName\(draft\.name\)/);
  assert.match(account, /assets\/store-demo\.js\?v=shop-reward-1/);
  assert.match(account, /assets\/store-listing\.js\?v=shop-reward-1/);
  assert.doesNotMatch(demoJs, /Reward saved for this shop[^"]*—|Reward turned off for this shop[^"]*—/);
});

test("share of scans and consented export stay consistent", () => {
  const sandbox = { window: {}, document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } }, location: { search: "", href: "https://example.com/account" }, history: { replaceState() {} }, localStorage: { getItem() { return null; }, setItem() {} }, URL, URLSearchParams, Intl };
  vm.runInNewContext(demoJs, sandbox);
  assert.equal(sandbox.window.HCStoreDemo.percent(64, 412), "15.5%");
  const kept = sandbox.window.HCStoreDemo.consentedGuests([
    { name: "A", email: "a@example.com", consentedAt: "2026-10-01T00:00:00Z" },
    { name: "B", email: "b@example.com" },
    { name: "", email: "c@example.com", consentedAt: "2026-10-01T00:00:00Z" }
  ]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].name, "A");
});
