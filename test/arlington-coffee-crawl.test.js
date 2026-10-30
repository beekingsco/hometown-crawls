const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const signup = read("arlington/coffee-crawl/index.html");
const thanks = read("arlington/coffee-crawl/thanks/index.html");
const puyallup = read("puyallup/coffee-crawl/index.html");
const puyallupThanks = read("puyallup/coffee-crawl/thanks/index.html");
const vercel = read("vercel.json");
const site = read("assets/site.js");

function crawlConfig(html) {
  const block = html.match(/var CRAWL = \{[\s\S]*?\};/);
  assert.ok(block, "CRAWL config block");
  const sandbox = { window: {} };
  vm.runInNewContext(block[0] + "\nthis.CRAWL = CRAWL;", sandbox);
  return sandbox.CRAWL;
}

test("Arlington shop signup names the crawl and posts arl-coffee-nov-2026", () => {
  assert.match(signup, /<title>Arlington Holiday Coffee Crawl/);
  assert.match(signup, /rel="canonical" href="https:\/\/www\.hometowncrawls\.com\/arlington\/coffee-crawl"/);
  assert.match(signup, /property="og:url" content="https:\/\/www\.hometowncrawls\.com\/arlington\/coffee-crawl"/);
  assert.match(signup, /property="og:title" content="Join the Arlington Holiday Coffee Crawl/);
  assert.match(signup, /coffee wonderland of Arlington/);
  assert.match(signup, /123 Main St, Arlington, WA/);
  assert.doesNotMatch(signup, /Puyallup|puy-coffee|puyallup/i);
  assert.match(signup, /\/rest\/v1\/crawl_signups/);
  assert.match(signup, /crawl: CRAWL\.id/);

  const crawl = crawlConfig(signup);
  assert.equal(crawl.id, "arl-coffee-nov-2026");
  assert.equal(crawl.paymentLink, "https://buy.stripe.com/8x214n6gm4Op89Ja9ngQE0e");
  assert.equal(crawl.thanksUrl, "/arlington/coffee-crawl/thanks");
});

test("Arlington thanks page stays on the Arlington crawl and account", () => {
  assert.match(thanks, /Arlington Holiday Coffee Crawl · Nov 1 – Dec 31, 2026/);
  assert.match(thanks, /href="\/arlington\/coffee-crawl"/);
  assert.match(thanks, /href="\/account"/);
  assert.match(thanks, /noindex/);
  assert.doesNotMatch(thanks, /Puyallup|puy-coffee|puyallup/i);
});

test("Vercel rewrites serve the Arlington signup and thanks pages", () => {
  const routes = JSON.parse(vercel).rewrites;
  assert.deepEqual(
    routes.find((row) => row.source === "/arlington/coffee-crawl"),
    { source: "/arlington/coffee-crawl", destination: "/arlington/coffee-crawl/index.html" }
  );
  assert.deepEqual(
    routes.find((row) => row.source === "/arlington/coffee-crawl/thanks"),
    { source: "/arlington/coffee-crawl/thanks", destination: "/arlington/coffee-crawl/thanks/index.html" }
  );
  assert.deepEqual(
    routes.find((row) => row.source === "/puyallup/coffee-crawl"),
    { source: "/puyallup/coffee-crawl", destination: "/puyallup/coffee-crawl/index.html" }
  );
});

test("Puyallup shop signup is unchanged", () => {
  const crawl = crawlConfig(puyallup);
  assert.equal(crawl.id, "puy-coffee-nov-2026");
  assert.equal(crawl.paymentLink, "https://buy.stripe.com/8x214n6gm4Op89Ja9ngQE0e");
  assert.equal(crawl.thanksUrl, "/puyallup/coffee-crawl/thanks");
  assert.match(puyallup, /coffee wonderland of Puyallup/);
  assert.match(puyallupThanks, /href="\/puyallup\/coffee-crawl\/shop"/);
  assert.match(puyallupThanks, /Puyallup Holiday Coffee Crawl/);
});

test("city crawl pages keep root-absolute header links", () => {
  assert.match(site, /path\.startsWith\("\/puyallup\/"\)/);
  assert.match(site, /path\.startsWith\("\/arlington\/"\)/);
  const body = site.match(/function assetPrefix\(\) \{([\s\S]*?)\n  \}/)[1];
  function prefixFor(pathname) {
    return vm.runInNewContext(
      `const path = ${JSON.stringify(pathname)};\nfunction assetPrefix() {${body}\n}\nassetPrefix();`,
      {}
    );
  }
  assert.equal(prefixFor("/arlington/coffee-crawl"), "/");
  assert.equal(prefixFor("/arlington/coffee-crawl/thanks"), "/");
  assert.equal(prefixFor("/puyallup/coffee-crawl"), "/");
  assert.equal(prefixFor("/account/store/help"), "/");
});
