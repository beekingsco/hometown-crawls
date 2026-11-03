const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const migration = read("migrations/20261103150000_shop_my_stats.sql");
const demoJs = read("assets/store-demo.js");
const listing = read("assets/store-listing.js");
const account = read("account.html");

function statEls() {
  const els = {};
  ["stat-players", "stat-scans", "stat-shop-scans", "stat-share", "stat-first"].forEach((id) => {
    els[id] = { textContent: "—" };
  });
  return els;
}

function loadDemo(els, search, client) {
  const sandbox = {
    document: {
      addEventListener() {},
      getElementById(id) { return els[id] || null; },
      querySelectorAll() { return []; },
      createElement() { return { style: {} }; }
    },
    location: { search, href: "https://www.hometowncrawls.com/account" + search },
    history: { replaceState() {} },
    localStorage: { getItem() { return null; }, setItem() {} },
    URL,
    URLSearchParams,
    Intl,
    HCCrawl: client ? { client } : undefined
  };
  sandbox.window = sandbox;
  vm.runInNewContext(demoJs, sandbox);
  return sandbox;
}

test("shop_my_stats is owner-only and isolated by crawl", () => {
  assert.match(migration, /create or replace function public\.shop_my_stats\(\)/);
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path to ''/);
  assert.match(migration, /if \(select auth\.uid\(\)\) is null then/);
  assert.match(migration, /raise exception 'Not authenticated'/);
  assert.match(migration, /l\.owner_user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /from public\.crawl_joins j/);
  assert.match(migration, /j\.crawl_id in \(select c\.crawl_id from crawl_ids c\)/);
  assert.match(migration, /from public\.stamps s/);
  assert.match(migration, /s\.crawl_id in \(select c\.crawl_id from crawl_ids c\)/);
  assert.match(migration, /ss\.crawl_id = m\.crawl_id/);
  assert.match(migration, /ss\.business_id = m\.business_id/);
  assert.match(migration, /order by s\.crawl_id, s\.user_id, s\.claimed_at asc, s\.id asc/);
  assert.match(migration, /when m\.business_id is null then 0::bigint/);
  assert.match(migration, /revoke all on function public\.shop_my_stats\(\) from public/);
  assert.match(migration, /revoke all on function public\.shop_my_stats\(\) from anon/);
  assert.match(migration, /grant execute on function public\.shop_my_stats\(\) to authenticated/);
  assert.doesNotMatch(migration, /grant execute on function public\.shop_my_stats\(\) to anon/);
  assert.doesNotMatch(migration, /grant execute on function public\.shop_my_stats\(\) to service_role/);
  assert.doesNotMatch(migration, /function public\.(organizer_crawl_stats|claim_stamp)|stripe|user_metadata/i);
});

test("live store path fills the listing that shop_my_listings showed", async () => {
  const els = statEls();
  const calls = [];
  const sandbox = loadDemo(els, "", function () {
    return {
      rpc(name) {
        calls.push(name);
        return Promise.resolve({
          data: [
            { listing_id: "arlington-shop", crawl_id: "arl-coffee", players: "3", scans: "9", shop_scans: "9", first_time: "3" },
            { listing_id: "enchanted", crawl_id: "puy-coffee", players: "204", scans: "238", shop_scans: "16", first_time: "11" }
          ],
          error: null
        });
      }
    };
  });
  const ok = await sandbox.HCStoreDemo.fillLiveStats("enchanted");
  assert.equal(ok, true);
  assert.deepEqual(calls, ["shop_my_stats"]);
  assert.equal(els["stat-players"].textContent, "204");
  assert.equal(els["stat-scans"].textContent, "238");
  assert.equal(els["stat-shop-scans"].textContent, "16");
  assert.equal(els["stat-share"].textContent, "6.7%");
  assert.equal(els["stat-first"].textContent, "11");
  assert.match(listing, /rpc\("shop_my_listings"\)/);
  assert.match(listing, /HCStoreDemo\.fillLiveStats\(listing\.listing_id\)/);
  assert.match(account, /assets\/store-demo\.js\?v=shop-reward-1/);
  assert.match(account, /assets\/store-listing\.js\?v=shop-reward-1/);
});

test("demo mode still shows sample stats and does not call shop_my_stats", async () => {
  const els = statEls();
  let called = false;
  const sandbox = loadDemo(els, "?demo=1&tab=store", function () {
    return {
      rpc() {
        called = true;
        return Promise.resolve({ data: [], error: null });
      }
    };
  });
  const ok = await sandbox.HCStoreDemo.fillLiveStats("enchanted");
  assert.equal(ok, false);
  assert.equal(called, false);
  assert.equal(els["stat-players"].textContent, "—");
  sandbox.HCStoreDemo.fillStats({
    stats: { players: 128, scans: 412, shopScans: 64, firstTime: 27 }
  });
  assert.equal(els["stat-players"].textContent, "128");
  assert.equal(els["stat-scans"].textContent, "412");
  assert.equal(els["stat-shop-scans"].textContent, "64");
  assert.equal(els["stat-share"].textContent, "15.5%");
  assert.equal(els["stat-first"].textContent, "27");
  assert.match(demoJs, /function showSample\(demo\)/);
  assert.match(demoJs, /fillStats\(demo\)/);
});

test("a missing stats RPC leaves the dashes in place", async () => {
  const els = statEls();
  const sandbox = loadDemo(els, "", function () {
    return {
      rpc() {
        return Promise.resolve({ data: null, error: { message: "schema cache" } });
      }
    };
  });
  const ok = await sandbox.HCStoreDemo.fillLiveStats("enchanted");
  assert.equal(ok, false);
  assert.equal(els["stat-players"].textContent, "—");
  assert.equal(els["stat-share"].textContent, "—");
});
