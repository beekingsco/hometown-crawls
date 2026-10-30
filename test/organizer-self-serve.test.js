const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const { handleRequest, _test } = require("../api/crawl-invites");
const { readConfig } = require("../api/public-config");
const webhook = require("../api/stripe-webhook");

const migration = read("migrations/20261030160000_organizer_self_serve.sql");
const organize = read("organize.html");
const join = read("crawls/join/index.html");
const account = read("account.html");
const panel = read("assets/organizer-panel.js");
const crawl = read("assets/crawl.js");
const invitesApi = read("api/crawl-invites.js");
const publicConfig = read("api/public-config.js");

function request(body, headers) {
  return {
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.20", ...(headers || {}) },
    body,
  };
}

function deps(overrides) {
  const emails = [];
  const marked = [];
  return {
    emails,
    marked,
    deps: {
      resendKey: "re_test",
      supabaseUrl: "https://staging.example.supabase.co",
      anonKey: "anon-test",
      appUrl: "https://preview.example.com",
      now: () => Date.now(),
      hits: new Map(),
      getUser: async () => ({ id: "user-1", email: "owner@example.com" }),
      listInvites: async () => ({
        data: [
          {
            email: "ada@shop.test",
            status: "pending",
            token: "token-ada",
            crawl_name: "Tacoma Coffee Crawl",
            city: "Tacoma",
          },
          {
            email: "done@shop.test",
            status: "sent",
            token: "token-done",
            crawl_name: "Tacoma Coffee Crawl",
            city: "Tacoma",
          },
        ],
      }),
      markInvites: async (_jwt, crawlId, results) => {
        marked.push({ crawlId, results });
        return { data: { updated: results.length } };
      },
      fetch: async (_url, init) => {
        emails.push(JSON.parse(init.body));
        return { ok: true, status: 200 };
      },
      ...overrides,
    },
  };
}

test("migration keeps seats paid, pins required, and owner control", () => {
  assert.match(migration, /function public\.organizer_create_crawl\(/);
  assert.match(migration, /signup_key, price_cents, is_listed/);
  assert.match(migration, /4999/);
  assert.match(migration, /function public\.organizer_save_shop_invites\(/);
  assert.match(migration, /function public\.shop_signup_target\(/);
  assert.match(migration, /function public\.shop_set_pin\(/);
  assert.match(migration, /Add a map pin before this shop can show on the passport/);
  assert.match(migration, /private\.is_crawl_owner_or_organizer\(v_crawl\)/);
  assert.match(migration, /hours, is_visible[\s\S]{0,800}false/);
  assert.match(migration, /c\.signup_key = crawl\s+or c\.id = crawl/);
  assert.match(migration, /grant execute on function public\.shop_signup_target\(text, text\) to anon, authenticated/);
  assert.match(migration, /enable row level security/);
  assert.doesNotMatch(migration, /service_role key|SUPABASE_SERVICE_ROLE|eyJ/);
  assert.doesNotMatch(migration, /puy-coffee-nov-2026/);
});

test("pages create a crawl and join by crawl id or invite token", () => {
  assert.match(organize, /phone-mascot\.png/);
  assert.match(organize, /width="571" height="720"/);
  assert.doesNotMatch(organize, /\/mascot\.png/);
  assert.doesNotMatch(organize, /Staging setup|SUPABASE_URL|will not write to the live/);
  assert.doesNotMatch(organize, /aspect-ratio:\s*1/);
  assert.match(organize, /organizer_create_crawl/);
  assert.match(organize, /id="organize-crawl-name"/);
  assert.match(organize, /id="organize-city"/);
  assert.match(organize, /id="organize-start"/);
  assert.match(organize, /id="organize-end"/);
  assert.match(organize, /id="organize-shops"/);
  assert.match(organize, /selfServeWritesAllowed/);
  assert.doesNotMatch(organize, /mailto:hello@hometowncrawls.com\?subject/);
  assert.match(join, /shop_signup_target/);
  assert.match(join, /\/rest\/v1\/crawl_signups/);
  assert.match(join, /client_reference_id/);
  assert.match(join, /\$49\.99/);
  assert.match(organize, /\$49\.99/);
  assert.doesNotMatch(organize + join + account + invitesApi, /no free shop/i);
  assert.match(account, /id="shop-invite-send"/);
  assert.match(account, /id="org-shop-pin"/);
  assert.match(panel, /organizer_save_shop_invites/);
  assert.match(panel, /\/api\/crawl-invites/);
  assert.match(panel, /shop_set_pin/);
  assert.match(panel, /Only the crawl owner or an organizer can show or hide a shop/);
  assert.match(crawl, /function selfServeWritesAllowed/);
  assert.match(crawl, /tatwbjuwufeqynpufodq/);
  assert.match(read("vercel.json"), /\/crawls\/join\/index\.html/);
  assert.match(read("puyallup/coffee-crawl/index.html"), /puy-coffee-nov-2026/);
  assert.doesNotMatch(invitesApi, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(publicConfig, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  for (const file of [organize, join, account, panel, invitesApi, publicConfig, migration]) {
    assert.doesNotMatch(file, /eyJ[A-Za-z0-9_-]{20,}/);
  }
});

test("public config returns only the anon key and never a service role", () => {
  const previous = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    VERCEL_ENV: process.env.VERCEL_ENV,
    HC_APP_URL: process.env.HC_APP_URL,
  };
  process.env.SUPABASE_URL = "https://staging.example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-must-not-leak";
  process.env.VERCEL_ENV = "preview";
  process.env.HC_APP_URL = "https://preview.example.com/";
  try {
    const config = readConfig();
    assert.equal(config.configured, true);
    assert.equal(config.preview, true);
    assert.equal(config.supabaseUrl, "https://staging.example.supabase.co");
    assert.equal(config.supabaseAnonKey, "anon-test");
    assert.equal(config.appUrl, "https://preview.example.com");
    assert.equal(JSON.stringify(config).includes("service-role"), false);
    assert.doesNotMatch(publicConfig, /SUPABASE_SERVICE_ROLE_KEY/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("invite mail uses a unique join link and does not echo the token in the API result", async () => {
  const mail = _test.inviteMail({
    crawlName: "Tacoma Coffee Crawl",
    city: "Tacoma",
    price: "$49.99",
    link: "https://preview.example.com/crawls/join?invite=token-ada",
  });
  assert.match(mail.subject, /You've been invited to Tacoma Coffee Crawl/);
  assert.match(mail.text, /You've been invited to a crawl/);
  assert.match(mail.html, /https:\/\/preview\.example\.com\/crawls\/join\?invite=token-ada/);
  assert.match(mail.text, /\$49\.99/);
  assert.doesNotMatch(mail.text + mail.html, /no free shop/i);

  const { emails, marked, deps: sendDeps } = deps();
  const result = await handleRequest(
    request({ crawlId: "tacoma-coffee" }, { authorization: "Bearer signed-in-token" }),
    sendDeps
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.sent, 1);
  assert.equal(result.body.failed, 0);
  assert.equal(JSON.stringify(result.body).includes("token-ada"), false);
  assert.equal(emails.length, 1);
  assert.equal(emails[0].to[0], "ada@shop.test");
  assert.match(emails[0].text, /invite=token-ada/);
  assert.equal(emails[0].reply_to, "owner@example.com");
  assert.equal(marked[0].results[0].status, "sent");
  assert.equal(marked[0].results.length, 1);
});

test("invite send refuses a missing key, a bad crawl, and a failed mailbox", async () => {
  const missing = await handleRequest(request({ crawlId: "tacoma-coffee" }, { authorization: "Bearer t" }), {
    ...deps().deps,
    resendKey: "",
  });
  assert.equal(missing.status, 503);

  const anon = await handleRequest(request({ crawlId: "tacoma-coffee" }), deps().deps);
  assert.equal(anon.status, 401);

  const bad = await handleRequest(request({ crawlId: "../puyallup" }, { authorization: "Bearer t" }), deps().deps);
  assert.equal(bad.status, 400);

  const { deps: failedDeps, marked } = deps({
    fetch: async () => ({ ok: false, status: 500 }),
  });
  const failed = await handleRequest(
    request({ crawlId: "tacoma-coffee" }, { authorization: "Bearer t" }),
    failedDeps
  );
  assert.equal(failed.status, 502);
  assert.equal(marked[0].results[0].status, "failed");
});

test("paid receipt stays on the Puyallup pages and other crawls use their join URL", () => {
  const puyallup = webhook._test.buildEmail({
    crawlName: "Puyallup Holiday Coffee Crawl",
    dates: "Nov 1 – Dec 31, 2026",
    amount: "$49.99",
    businessName: "Anthem Coffee",
  });
  assert.match(puyallup.text, /https:\/\/www\.hometowncrawls\.com\/puyallup\/holiday-coffee-crawl\./);
  assert.match(puyallup.html, /puyallup\/coffee-crawl\/shop/);

  const urls = webhook._test.crawlPublicUrls(
    { id: "tacoma-coffee", signup_key: "tacoma-coffee", name: "Tacoma Coffee Crawl" },
    "https://preview.example.com"
  );
  assert.equal(urls.shopPortalUrl, "https://preview.example.com/account?tab=store");
  assert.equal(urls.mapUrl, "https://preview.example.com/crawls/join?crawl=tacoma-coffee");
  const other = webhook._test.buildEmail({
    crawlName: "Tacoma Coffee Crawl",
    dates: "Jan 1 – Jan 31, 2027",
    amount: "$49.99",
    businessName: "Main Street",
    shopPortalUrl: urls.shopPortalUrl,
    mapUrl: urls.mapUrl,
  });
  assert.match(other.text, /preview\.example\.com\/crawls\/join\?crawl=tacoma-coffee/);
  assert.doesNotMatch(other.text, /puyallup\/holiday-coffee-crawl/);
});
