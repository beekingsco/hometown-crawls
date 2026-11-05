const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const NOW = "2026-11-05T18:00:00Z";

function memoryStorage(initial) {
  const data = Object.assign({}, initial || {});
  return {
    getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem(key, value) { data[key] = String(value); },
    removeItem(key) { delete data[key]; },
    dump() { return Object.assign({}, data); }
  };
}

function activeCrawl(id, extra) {
  return Object.assign({
    id: id,
    name: id,
    is_listed: true,
    starts_at: "2026-11-01T00:00:00Z",
    ends_at: "2026-12-31T00:00:00Z"
  }, extra || {});
}

function load(options) {
  const opts = options || {};
  const calls = { otp: [], join: [], crawls: [] };
  const state = {
    session: opts.session === undefined ? null : opts.session,
    crawl: opts.crawl === undefined ? null : opts.crawl,
    joins: (opts.joins || []).slice(),
    joinError: opts.joinError || null,
    loadError: opts.loadError || null
  };
  const location = {
    hash: opts.hash || "",
    search: opts.search || "",
    pathname: opts.pathname || "/puyallup/holiday-coffee-crawl",
    origin: "https://www.hometowncrawls.com",
    replace() {}
  };
  const history = {
    replaceState(_state, _title, next) {
      const url = new URL(next, location.origin);
      location.pathname = url.pathname;
      location.search = url.search;
      location.hash = url.hash;
    }
  };
  const sandbox = {
    URLSearchParams,
    location,
    history,
    localStorage: opts.localStorage || memoryStorage(),
    sessionStorage: opts.sessionStorage || memoryStorage(),
    console: { warn() {} },
    navigator: {},
    document: {},
    setTimeout,
    clearTimeout,
    Promise
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
          signInWithOtp(args) {
            calls.otp.push(args);
            if (opts.otpError) return Promise.resolve({ error: opts.otpError });
            return Promise.resolve({ error: null });
          },
          getSession() {
            return Promise.resolve({ data: { session: state.session } });
          },
          onAuthStateChange(fn) {
            (opts.emit || []).forEach(function (event) { fn(event, state.session); });
            return { data: { subscription: { unsubscribe() {} } } };
          }
        },
        from(table) {
          return {
            select() {
              return {
                eq(_column, value) {
                  calls.crawls.push({ table, value });
                  const pending = Promise.resolve().then(function () {
                    if (table === "crawls") {
                      if (state.loadError) return { data: null, error: state.loadError };
                      const row = state.crawl && state.crawl.id === value ? state.crawl : null;
                      return { data: row, error: null };
                    }
                    if (table === "crawl_joins") return { data: state.joins.slice(), error: null };
                    return { data: null, error: { message: "unexpected table" } };
                  });
                  return {
                    maybeSingle() { return pending; },
                    then(resolve, reject) { return pending.then(resolve, reject); }
                  };
                }
              };
            }
          };
        },
        rpc(name, args) {
          if (name === "join_crawl") {
            calls.join.push(args);
            if (state.joinError) return Promise.resolve({ data: null, error: state.joinError });
            state.joins.push({ crawl_id: args.p_crawl, joined_at: NOW });
            return Promise.resolve({ data: { ok: true }, error: null });
          }
          return Promise.resolve({ data: null, error: { message: "unexpected rpc " + name } });
        }
      };
    }
  };
  vm.runInNewContext(read("assets/crawl.js"), sandbox, { filename: "assets/crawl.js" });
  return { sandbox, calls, state, location };
}

const signedIn = {
  user: { id: "user-1", email: "ada@example.com", is_anonymous: false }
};

function params(search) {
  return new URLSearchParams(String(search || "").replace(/^\?/, ""));
}

test("magic link carries only the crawl that sent it", async () => {
  const page = load({
    search: "?shop=anthem&code=ANTHEMCO&autojoin=arl-coffee",
    pathname: "/puyallup/holiday-coffee-crawl"
  });
  await page.sandbox.HCCrawl.magicLink("ada@example.com", "puy-coffee");
  const redirect = page.calls.otp[0].options.emailRedirectTo;
  const query = params(new URL(redirect).search);
  assert.equal(query.get("autojoin"), "puy-coffee");
  assert.equal(query.get("shop"), "anthem");
  assert.equal(query.get("code"), "ANTHEMCO");
  assert.equal(query.getAll("autojoin").length, 1);
  assert.equal(new URL(redirect).pathname, "/puyallup/holiday-coffee-crawl");
  assert.equal(page.sandbox.localStorage.getItem("hc-autojoin:puy-coffee") != null, true);
  assert.equal(page.sandbox.localStorage.getItem("hc-autojoin:arl-coffee"), null);
  assert.equal(JSON.parse(page.sandbox.sessionStorage.getItem("hc-autojoin:puy-coffee")).crawlId, "puy-coffee");
});

test("magic link with no crawl context does not pick the default crawl", async () => {
  const page = load({ search: "?autojoin=arl-coffee", pathname: "/account" });
  await page.sandbox.HCCrawl.magicLink("ada@example.com");
  const redirect = page.calls.otp[0].options.emailRedirectTo;
  assert.equal(params(new URL(redirect).search).has("autojoin"), false);
  assert.equal(redirect.includes("puy-coffee"), false);
  assert.deepEqual(page.sandbox.localStorage.dump(), {});
  assert.deepEqual(page.sandbox.sessionStorage.dump(), {});
});

test("a rejected crawl id is not attached to the magic link", async () => {
  const page = load({ pathname: "/account" });
  await page.sandbox.HCCrawl.magicLink("ada@example.com", "puy coffee");
  const redirect = page.calls.otp[0].options.emailRedirectTo;
  assert.equal(params(new URL(redirect).search).has("autojoin"), false);
  assert.deepEqual(page.sandbox.localStorage.dump(), {});
});

test("a failed send does not leave a pending autojoin", async () => {
  const page = load({ otpError: { message: "nope", status: 500 } });
  await assert.rejects(page.sandbox.HCCrawl.magicLink("ada@example.com", "puy-coffee"));
  assert.equal(page.calls.otp.length, 1);
  assert.deepEqual(page.sandbox.localStorage.dump(), {});
  assert.deepEqual(page.sandbox.sessionStorage.dump(), {});
});

test("after auth, autojoin joins that crawl id and then clears it", async () => {
  const localStorage = memoryStorage({
    "hc-autojoin:puy-coffee": JSON.stringify({ crawlId: "puy-coffee" }),
    "hc-autojoin:arl-coffee": JSON.stringify({ crawlId: "arl-coffee" })
  });
  const sessionStorage = memoryStorage({
    "hc-autojoin:puy-coffee": JSON.stringify({ crawlId: "puy-coffee" }),
    "hc-autojoin:arl-coffee": JSON.stringify({ crawlId: "arl-coffee" })
  });
  const page = load({
    search: "?autojoin=puy-coffee&shop=anthem",
    session: signedIn,
    crawl: activeCrawl("puy-coffee"),
    localStorage,
    sessionStorage
  });
  const first = await page.sandbox.HCCrawl.consumeAutoJoin(NOW);
  assert.equal(first.joined, true);
  assert.deepEqual(page.calls.join.map((row) => row.p_crawl), ["puy-coffee"]);
  assert.equal(page.calls.crawls.some((row) => row.table === "crawls" && row.value === "arl-coffee"), false);
  assert.equal(params(page.location.search).has("autojoin"), false);
  assert.equal(params(page.location.search).get("shop"), "anthem");
  assert.equal(localStorage.getItem("hc-autojoin:puy-coffee"), null);
  assert.equal(sessionStorage.getItem("hc-autojoin:puy-coffee"), null);
  assert.equal(JSON.parse(localStorage.getItem("hc-autojoin:arl-coffee")).crawlId, "arl-coffee");
  const second = await page.sandbox.HCCrawl.consumeAutoJoin(NOW);
  assert.equal(second.reason, "none");
  assert.equal(page.calls.join.length, 1);
});

test("an already-joined crawl is not joined again", async () => {
  const page = load({
    search: "?autojoin=arl-coffee",
    pathname: "/arlington/holiday-coffee-crawl",
    session: signedIn,
    crawl: activeCrawl("arl-coffee", { starts_at: "2027-01-01T00:00:00Z", ends_at: "2027-02-01T00:00:00Z" }),
    joins: [{ crawl_id: "arl-coffee", joined_at: NOW }]
  });
  const result = await page.sandbox.HCCrawl.consumeAutoJoin(NOW);
  assert.equal(result.joined, true);
  assert.equal(result.already, true);
  assert.equal(page.calls.join.length, 0);
  assert.equal(params(page.location.search).has("autojoin"), false);
});

test("a duplicate join from the server still counts as joined and clears", async () => {
  const page = load({
    search: "?autojoin=puy-coffee",
    session: signedIn,
    crawl: activeCrawl("puy-coffee"),
    joinError: { message: "duplicate key value violates unique constraint", code: "23505" }
  });
  const result = await page.sandbox.HCCrawl.consumeAutoJoin(NOW);
  assert.equal(result.joined, true);
  assert.deepEqual(page.calls.join.map((row) => row.p_crawl), ["puy-coffee"]);
  assert.equal(params(page.location.search).has("autojoin"), false);
});

test("no crawl context does nothing, even if another crawl is pending in storage", async () => {
  const localStorage = memoryStorage({
    "hc-autojoin:puy-coffee": JSON.stringify({ crawlId: "puy-coffee" }),
    "hc-autojoin:arl-coffee": JSON.stringify({ crawlId: "arl-coffee" })
  });
  const page = load({
    search: "",
    pathname: "/account",
    session: signedIn,
    crawl: activeCrawl("puy-coffee"),
    localStorage
  });
  const result = await page.sandbox.HCCrawl.consumeAutoJoin(NOW);
  assert.equal(result.joined, false);
  assert.equal(result.reason, "none");
  assert.equal(page.calls.join.length, 0);
  assert.equal(localStorage.getItem("hc-autojoin:puy-coffee") != null, true);
  assert.equal(localStorage.getItem("hc-autojoin:arl-coffee") != null, true);
});

test("a mismatched autojoin param joins neither crawl", async () => {
  const page = load({
    search: "?autojoin=puy-coffee",
    session: signedIn,
    crawl: activeCrawl("puy-coffee")
  });
  page.location.search = "?autojoin=arl-coffee";
  const result = await page.sandbox.HCCrawl.consumeAutoJoin(NOW);
  assert.equal(result.joined, false);
  assert.equal(result.reason, "mismatch");
  assert.equal(page.calls.join.length, 0);
  assert.equal(params(page.location.search).has("autojoin"), false);
});

test("missing, hidden, and ended crawls are not joined", async () => {
  const cases = [
    { name: "missing", crawl: null, reason: "missing" },
    { name: "hidden", crawl: activeCrawl("puy-pub", { is_listed: false }), reason: "inactive" },
    { name: "ended", crawl: activeCrawl("puy-coffee", { ends_at: "2026-11-01T00:00:00Z" }), reason: "inactive" }
  ];
  for (const item of cases) {
    const id = item.crawl ? item.crawl.id : "puy-coffee";
    const localStorage = memoryStorage({
      ["hc-autojoin:" + id]: JSON.stringify({ crawlId: id }),
      "hc-autojoin:arl-coffee": JSON.stringify({ crawlId: "arl-coffee" })
    });
    const page = load({
      search: "?autojoin=" + id,
      session: signedIn,
      crawl: item.name === "missing" ? activeCrawl("someone-else") : item.crawl,
      localStorage
    });
    if (item.name === "missing") page.state.crawl = null;
    const result = await page.sandbox.HCCrawl.consumeAutoJoin(NOW);
    assert.equal(result.joined, false, item.name);
    assert.equal(result.reason, item.reason, item.name);
    assert.equal(page.calls.join.length, 0, item.name);
    assert.equal(params(page.location.search).has("autojoin"), false, item.name);
    assert.equal(localStorage.getItem("hc-autojoin:" + id), null, item.name);
    assert.equal(localStorage.getItem("hc-autojoin:arl-coffee") != null, true, item.name);
  }
});

test("a crawl lookup failure leaves the pending value in place", async () => {
  const localStorage = memoryStorage({
    "hc-autojoin:puy-coffee": JSON.stringify({ crawlId: "puy-coffee" })
  });
  const page = load({
    search: "?autojoin=puy-coffee",
    session: signedIn,
    loadError: { message: "timeout" },
    localStorage
  });
  const result = await page.sandbox.HCCrawl.consumeAutoJoin(NOW);
  assert.equal(result.joined, false);
  assert.equal(result.reason, "error");
  assert.equal(page.calls.join.length, 0);
  assert.equal(params(page.location.search).get("autojoin"), "puy-coffee");
  assert.equal(localStorage.getItem("hc-autojoin:puy-coffee") != null, true);
});

test("signed-out visitors keep the pending crawl for after auth", async () => {
  const page = load({
    search: "?autojoin=arl-coffee",
    session: null,
    crawl: activeCrawl("arl-coffee")
  });
  const result = await page.sandbox.HCCrawl.consumeAutoJoin(NOW);
  assert.equal(result.joined, false);
  assert.equal(result.reason, "signed-out");
  assert.equal(page.calls.join.length, 0);
  assert.equal(params(page.location.search).get("autojoin"), "arl-coffee");
});

test("demo mode does not auto-join", async () => {
  const page = load({
    search: "?demo=1&autojoin=puy-coffee",
    session: signedIn,
    crawl: activeCrawl("puy-coffee")
  });
  const result = await page.sandbox.HCCrawl.consumeAutoJoin(NOW);
  assert.equal(result.joined, false);
  assert.equal(result.reason, "demo");
  assert.equal(page.calls.join.length, 0);
});

test("overlapping auth events join the linked crawl once, before the page callback", async () => {
  const page = load({
    search: "?autojoin=arl-coffee",
    pathname: "/arlington/holiday-coffee-crawl",
    session: signedIn,
    crawl: activeCrawl("arl-coffee"),
    emit: ["INITIAL_SESSION", "SIGNED_IN"]
  });
  let seen = null;
  page.sandbox.HCCrawl.watchSession(function () {
    seen = page.state.joins.map((row) => row.crawl_id);
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(Array.from(seen), ["arl-coffee"]);
  assert.deepEqual(page.calls.join.map((row) => row.p_crawl), ["arl-coffee"]);
  assert.equal(params(page.location.search).has("autojoin"), false);
});

test("two consume calls in flight share one join", async () => {
  const page = load({
    search: "?autojoin=puy-coffee",
    session: signedIn,
    crawl: activeCrawl("puy-coffee")
  });
  const [a, b] = await Promise.all([
    page.sandbox.HCCrawl.consumeAutoJoin(NOW),
    page.sandbox.HCCrawl.consumeAutoJoin(NOW)
  ]);
  assert.equal(a.joined, true);
  assert.equal(b.joined, true);
  assert.deepEqual(page.calls.join.map((row) => row.p_crawl), ["puy-coffee"]);
});

test("the account prompt shows only for a signed-in guest with zero joins", () => {
  const account = read("account.html");
  const crawl = read("assets/crawl.js");
  assert.match(account, /id="join-your-crawl"/);
  assert.match(account, /<h2>Join your crawl<\/h2>/);
  assert.match(account, /class="card hidden" id="join-your-crawl"/);
  assert.match(account, /haven't joined a crawl yet/);
  assert.match(account, /function refreshJoinPrompt/);
  assert.match(account, /HCCrawl\.syncJoinPrompt\(card, joins\)/);
  assert.match(account, /HCCrawl\.syncJoinPrompt\(card, \[\]\)/);
  assert.match(account, /get\("demo"\) === "1"/);
  assert.match(account, /await HCCrawl\.magicLink\(email\);/);
  assert.doesNotMatch(account, /magicLink\(email,/);
  assert.match(crawl, /function syncJoinPrompt/);
  const page = load();
  const shown = { hidden: true, classList: { toggle(name, on) { if (name === "hidden") shown.hidden = !!on; } } };
  const filled = { hidden: false, classList: { toggle(name, on) { if (name === "hidden") filled.hidden = !!on; } } };
  page.sandbox.HCCrawl.syncJoinPrompt(shown, []);
  page.sandbox.HCCrawl.syncJoinPrompt(filled, [{ crawl_id: "puy-coffee" }]);
  assert.equal(shown.hidden, false);
  assert.equal(filled.hidden, true);
});

test("guest crawl pages send their own crawl id and do not default the join", () => {
  const crawl = read("assets/crawl.js");
  assert.match(crawl, /emailRedirectTo: signInRedirect/);
  assert.match(crawl, /const signInRedirect = redirectForMagicLink\(id\)/);
  assert.match(crawl, /location\.origin \+ location\.pathname \+ location\.search/);
  assert.doesNotMatch(crawl, /emailRedirectTo: redirectTo/);
  assert.match(crawl, /p_crawl: id/);
  for (const rel of [
    "puyallup/holiday-coffee-crawl/index.html",
    "arlington/holiday-coffee-crawl/index.html"
  ]) {
    const page = read(rel);
    assert.match(page, /HCCrawl\.magicLink\(email, CRAWL\)/);
    assert.match(page, /adds you to this crawl/);
  }
  assert.match(read("puyallup/holiday-coffee-crawl/index.html"), /var CRAWL = "puy-coffee"/);
  assert.match(read("arlington/holiday-coffee-crawl/index.html"), /var CRAWL = "arl-coffee"/);
  assert.doesNotMatch(read("assets/paper-card.js"), /magicLink\(row\.email,/);
});
