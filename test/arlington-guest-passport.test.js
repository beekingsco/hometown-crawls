const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const page = read("arlington/holiday-coffee-crawl/index.html");
const puyallup = read("puyallup/holiday-coffee-crawl/index.html");
const guest = read("assets/guest-hub.js");
const crawlJs = read("assets/crawl.js");
const homeJs = read("assets/home-search.js");
const vercel = read("vercel.json");
const sitemap = read("sitemap.xml");

async function guestCalls(crawlId) {
  const calls = [];
  const query = () => {
    const q = {
      select() { return q; },
      eq(column, value) {
        calls.push(["eq", column, value]);
        return q;
      },
      insert(row) {
        calls.push(["insert", row]);
        return Promise.resolve({ error: null });
      },
      delete() {
        return { eq() { return Promise.resolve({ error: null }); } };
      },
      then(resolve, reject) {
        return Promise.resolve({ data: [], error: null }).then(resolve, reject);
      }
    };
    return q;
  };
  const sandbox = {
    URLSearchParams,
    console,
    localStorage: {
      getItem() { return null; },
      setItem() {}
    },
    location: { search: "", pathname: "/arlington/holiday-coffee-crawl", origin: "https://www.hometowncrawls.com" },
    document: {
      readyState: "loading",
      listeners: {},
      addEventListener(type, fn) { this.listeners[type] = fn; },
      getElementById() { return null; },
      body: { addEventListener() {} }
    }
  };
  sandbox.window = sandbox;
  if (crawlId) sandbox.HC_GUEST_CRAWL = crawlId;
  sandbox.HCCrawl = {
    async getSession() {
      return { user: { id: "guest-1", email: "guest@example.com", is_anonymous: false } };
    },
    client() {
      return {
        from() { return query(); },
        rpc(name, args) {
          calls.push(["rpc", name, args]);
          return Promise.resolve({ data: [], error: null });
        },
        storage: {
          from() {
            return { createSignedUrl: async () => ({ data: {} }) };
          }
        }
      };
    },
    async myStamps(id) {
      calls.push(["myStamps", id]);
      return [{ business_id: "shop-1" }];
    },
    async loadShops(id) {
      calls.push(["loadShops", id]);
      return { shops: [] };
    }
  };
  vm.runInNewContext(guest, sandbox, { filename: "assets/guest-hub.js" });
  sandbox.document.listeners.DOMContentLoaded();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return calls;
}

test("Arlington guest passport is its own page and never names Puyallup", () => {
  assert.match(page, /<title>Arlington Holiday Coffee Crawl/);
  assert.match(page, /rel="canonical" href="https:\/\/www\.hometowncrawls\.com\/arlington\/holiday-coffee-crawl"/);
  assert.match(page, /property="og:url" content="https:\/\/www\.hometowncrawls\.com\/arlington\/holiday-coffee-crawl"/);
  assert.match(page, /coffee wonderland of Arlington/);
  assert.match(page, /var CRAWL = "arl-coffee"/);
  assert.match(page, /window\.HC_GUEST_CRAWL = "arl-coffee"/);
  assert.match(page, /window\.HC_GUEST_CRAWL = CRAWL/);
  assert.match(page, /CLAIM_KEY = "hc-arl-coffee-claim"/);
  assert.match(page, /lat: 48\.1987, lng: -122\.1251/);
  assert.match(page, /You're on the Arlington Holiday Coffee Crawl passport\./);
  assert.match(page, /Shops joining soon/);
  assert.match(page, /downtown Arlington/);
  assert.match(page, /src="\/assets\/guest-hub\.js"/);
  assert.match(page, /src="\/assets\/crawl\.js"/);
  assert.match(page, /HCCrawl\.claimStamp\(\{ crawl: CRAWL/);
  assert.match(page, /HCCrawl\.joinCrawl\(CRAWL\)/);
  assert.match(page, /HCCrawl\.myStamps\(CRAWL\)/);
  assert.match(page, /get_public_crawl_shops", \{ p_crawl: CRAWL \}/);
  assert.match(page, /eq\("crawl_id", CRAWL\)/);
  assert.doesNotMatch(page, /puy-coffee|Puyallup|puyallup|hc-holiday-claim|98371|47\.191/);
  assert.doesNotMatch(page, /holiday-coffee-crawl\/rules/);
  const hubAt = page.indexOf('src="/assets/guest-hub.js"');
  const crawlSet = page.indexOf('window.HC_GUEST_CRAWL = "arl-coffee"');
  assert.ok(crawlSet > -1 && crawlSet < hubAt);
});

test("Arlington guest copy fills the passport without promising a prize", () => {
  assert.match(page, /<h3>Fill your passport\.<\/h3>/);
  assert.match(page, /A photo does not change your stamp\./);
  assert.doesNotMatch(page, /prize drawing|prize entry|Prizes are TBA|What are the prizes\?/i);
  assert.match(puyallup, /Fill your passport to enter the prize drawing\./);
  assert.match(puyallup, /What are the prizes\?/);
  assert.match(puyallup, /does not add a prize entry/);
  assert.match(guest, /It does not add a prize entry, and your stamp is unchanged\./);
  assert.match(guest, /guestCrawl\(\) === "arl-coffee"/);
  assert.match(guest, /It does not change your stamp\./);
});

test("Puyallup holiday passport is unchanged", () => {
  assert.match(puyallup, /var CRAWL = "puy-coffee"/);
  assert.match(puyallup, /You're on the Puyallup Holiday Coffee Crawl passport\./);
  assert.match(puyallup, /downtown Puyallup/);
  assert.match(puyallup, /CLAIM_KEY = "hc-holiday-claim"/);
  assert.doesNotMatch(puyallup, /arl-coffee|HC_GUEST_CRAWL|Arlington/);
  assert.match(puyallup, /href="\/puyallup\/holiday-coffee-crawl\/rules"/);
});

test("home search sends Arlington to the guest passport and leaves other crawls alone", () => {
  assert.match(homeJs, /"arl-coffee": "\/arlington\/holiday-coffee-crawl"/);
  assert.match(homeJs, /"puy-coffee": "\/puyallup\/holiday-coffee-crawl"/);
  assert.match(homeJs, /"puy-pub": "\/puyallupwa\/pub"/);
  assert.match(homeJs, /return KNOWN_PAGES\[id\] \|\| "\/account\.html"/);
});

test("guest hub follows the page crawl and defaults to Puyallup", async () => {
  assert.match(guest, /function guestCrawl\(\)/);
  assert.match(guest, /return "puy-coffee"/);
  assert.doesNotMatch(guest, /myStamps\("puy-coffee"\)|loadShops\("puy-coffee"\)|p_crawl: "puy-coffee"|crawl_id: "puy-coffee"/);

  const arlington = await guestCalls("arl-coffee");
  const ids = JSON.stringify(arlington);
  assert.match(ids, /arl-coffee/);
  assert.doesNotMatch(ids, /puy-coffee/);
  assert.ok(arlington.some((row) => row[0] === "loadShops" && row[1] === "arl-coffee"));
  assert.ok(arlington.some((row) => row[0] === "myStamps" && row[1] === "arl-coffee"));
  assert.ok(arlington.some((row) => row[0] === "eq" && row[1] === "crawl_id" && row[2] === "arl-coffee"));
  assert.ok(arlington.some((row) => row[0] === "rpc" && row[1] === "get_public_crawl_photos" && row[2].p_crawl === "arl-coffee"));

  const puyallupCalls = await guestCalls("");
  const dumped = JSON.stringify(puyallupCalls);
  assert.match(dumped, /puy-coffee/);
  assert.doesNotMatch(dumped, /arl-coffee/);
});

test("paid shop listings load for Arlington the same way as Puyallup", async () => {
  assert.match(crawlJs, /id === "puy-coffee" \|\| id === "arl-coffee"/);
  const calls = [];
  const query = () => {
    const q = {
      select() { return q; },
      eq() { return q; },
      in() { return Promise.resolve({ data: [], error: null }); },
      then(resolve, reject) {
        calls.push(["memberships"]);
        return Promise.resolve({ data: [], error: null }).then(resolve, reject);
      }
    };
    return q;
  };
  const sandbox = {
    URLSearchParams,
    console,
    navigator: {},
    localStorage: { getItem() { return null; }, setItem() {} },
    location: { hash: "", search: "", origin: "https://www.hometowncrawls.com", pathname: "/" },
    document: {}
  };
  sandbox.window = sandbox;
  sandbox.__HC_ENV__ = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_ANON_KEY: "anon",
    CRAWL_ID: "puy-coffee"
  };
  sandbox.supabase = {
    createClient() {
      return {
        auth: {
          getSession: async () => ({ data: { session: null } }),
          onAuthStateChange() {
            return { data: { subscription: { unsubscribe() {} } } };
          }
        },
        from(table) {
          calls.push(["from", table]);
          return query();
        },
        rpc(name, args) {
          calls.push(["rpc", name, args]);
          return Promise.resolve({ data: [], error: null });
        }
      };
    }
  };
  vm.runInNewContext(crawlJs, sandbox, { filename: "assets/crawl.js" });
  await sandbox.HCCrawl.loadShops("arl-coffee");
  await sandbox.HCCrawl.loadShops("puy-coffee");
  await sandbox.HCCrawl.loadShops("puy-pub");
  assert.equal(
    JSON.stringify(calls.filter((row) => row[0] === "rpc")),
    JSON.stringify([
      ["rpc", "get_public_crawl_shops", { p_crawl: "arl-coffee" }],
      ["rpc", "get_public_crawl_shops", { p_crawl: "puy-coffee" }]
    ])
  );
  assert.equal(JSON.stringify(calls.filter((row) => row[0] === "from")), JSON.stringify([["from", "memberships"]]));
});

test("Arlington guest page is routed and listed in the sitemap", () => {
  const routes = JSON.parse(vercel).rewrites;
  assert.deepEqual(
    routes.find((row) => row.source === "/arlington/holiday-coffee-crawl"),
    { source: "/arlington/holiday-coffee-crawl", destination: "/arlington/holiday-coffee-crawl/index.html" }
  );
  assert.match(sitemap, /https:\/\/www\.hometowncrawls\.com\/arlington\/holiday-coffee-crawl</);
  assert.match(sitemap, /https:\/\/www\.hometowncrawls\.com\/puyallup\/holiday-coffee-crawl</);
});
