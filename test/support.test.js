const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const { handleRequest, _test } = require("../api/support");

const page = read("support/index.html");
const api = read("api/support.js");

function note(extra) {
  return {
    name: "Nichole",
    email: "nichole@example.com",
    role: "Shop host",
    crawl: "Downtown Puyallup Holiday Coffee Crawl",
    shop: "Holiday Cafe",
    message: "QR would not stamp at the counter.",
    company: "",
    started: Date.now() - 5000,
    ...extra,
  };
}

function request(body, headers) {
  return {
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.10", ...(headers || {}) },
    body,
  };
}

function deps(overrides) {
  const emails = [];
  const fetch = overrides.fetch || (async (url, init) => {
    emails.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return { ok: true, status: 200 };
  });
  return {
    emails,
    deps: {
      resendKey: "re_test",
      to: "",
      now: () => Date.now(),
      hits: new Map(),
      fetch,
      ...overrides,
    },
  };
}

test("support page collects the fields and posts to the API", () => {
  assert.match(page, /id="support-name"/);
  assert.match(page, /id="support-email"/);
  assert.match(page, /id="support-role"/);
  assert.match(page, /Shop host/);
  assert.match(page, /Organizer/);
  assert.match(page, /Downtown Puyallup Holiday Coffee Crawl/);
  assert.match(page, /id="support-shop"/);
  assert.match(page, /id="support-message"/);
  assert.match(page, /id="support-company"/);
  assert.match(page, /id="support-done"/);
  assert.match(page, /fetch\("\/api\/support"/);
  assert.match(page, /href="\/account\/store\/help"/);
  assert.match(page, /href="\/account\/organizer\/help"/);
  assert.doesNotMatch(page, /service_role|RESEND_API_KEY|SUPABASE_SERVICE/);
});

test("footer, sitemap, and rewrite point at /support", () => {
  const site = read("assets/site.js");
  const home = read("index.html");
  const vercel = read("vercel.json");
  const sitemap = read("sitemap.xml");
  assert.match(site, /link\("support", "Support"\)/);
  assert.match(home, /href="\/support">Support/);
  assert.match(vercel, /"source": "\/support"/);
  assert.match(vercel, /"destination": "\/support\/index.html"/);
  assert.match(sitemap, /https:\/\/www\.hometowncrawls\.com\/support/);
  assert.match(read(".env.example"), /SUPPORT_TO_EMAIL=hello@hometowncrawls\.com/);
  assert.match(api, /hello@hometowncrawls\.com/);
  assert.doesNotMatch(api, /service_role/);
});

test("subject is easy to triage and long notes are shortened", () => {
  assert.equal(
    _test.subjectLine("Shop host", "QR would not stamp at the counter."),
    "[Hometown Crawls Support] Shop host — QR would not stamp at the counter."
  );
  const long = "a".repeat(80);
  const subject = _test.subjectLine("Guest", long);
  assert.match(subject, /^\[Hometown Crawls Support\] Guest — a+…$/);
  assert.ok(subject.length < 80 + 40);
});

test("sends to the default inbox from the verified sender", async () => {
  const { emails, deps: options } = deps({});
  const result = await handleRequest(request(note()), options);
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(emails.length, 1);
  assert.equal(emails[0].url, "https://api.resend.com/emails");
  assert.equal(emails[0].body.from, "Hometown Crawls <hello@hometowncrawls.com>");
  assert.equal(emails[0].body.to[0], "hello@hometowncrawls.com");
  assert.equal(emails[0].body.reply_to, "nichole@example.com");
  assert.equal(emails[0].body.subject, "[Hometown Crawls Support] Shop host — QR would not stamp at the counter.");
  assert.match(emails[0].body.text, /Shop: Holiday Cafe/);
  assert.match(emails[0].body.text, /Crawl: Downtown Puyallup Holiday Coffee Crawl/);
  assert.equal(emails[0].headers.Authorization, "Bearer re_test");
});

test("SUPPORT_TO_EMAIL overrides the inbox and the form cannot choose it", async () => {
  const { emails, deps: options } = deps({ to: "ops@example.com" });
  const result = await handleRequest(request(note({ to: "attacker@evil.com" })), options);
  assert.equal(result.status, 200);
  assert.equal(emails[0].body.to[0], "ops@example.com");
  assert.equal(emails[0].body.reply_to, "nichole@example.com");
});

test("escapes HTML in the message", async () => {
  const { emails, deps: options } = deps({});
  await handleRequest(request(note({ message: "Hello <script>alert(1)</script>" })), options);
  assert.match(emails[0].body.html, /Hello &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(emails[0].body.html, /<script>/);
});

test("honeypot and a too-fast submit do not send", async () => {
  const honeypot = deps({});
  const hidden = await handleRequest(request(note({ company: "filled by a bot" })), honeypot.deps);
  assert.equal(hidden.status, 200);
  assert.equal(honeypot.emails.length, 0);

  const fast = deps({});
  const rushed = await handleRequest(request(note({ started: Date.now() })), fast.deps);
  assert.equal(rushed.status, 400);
  assert.equal(fast.emails.length, 0);
});

test("rejects a bad role and a missing key", async () => {
  const bad = deps({});
  const role = await handleRequest(request(note({ role: "Owner" })), bad.deps);
  assert.equal(role.status, 400);
  assert.equal(bad.emails.length, 0);

  let called = false;
  const missing = await handleRequest(request(note()), {
    resendKey: "",
    to: "",
    now: () => Date.now(),
    hits: new Map(),
    fetch: async () => { called = true; return { ok: true, status: 200 }; },
  });
  assert.equal(missing.status, 503);
  assert.equal(called, false);
  assert.match(missing.body.error, /hello@hometowncrawls.com/);
});

test("rate limit and Resend failures stay on the server", async () => {
  const { deps: options, emails } = deps({});
  for (let i = 0; i < 5; i += 1) {
    const ok = await handleRequest(request(note()), options);
    assert.equal(ok.status, 200);
  }
  const blocked = await handleRequest(request(note()), options);
  assert.equal(blocked.status, 429);
  assert.equal(emails.length, 5);

  const failed = await handleRequest(request(note(), { "x-forwarded-for": "203.0.113.11" }), {
    resendKey: "re_test",
    to: "",
    now: () => Date.now(),
    hits: new Map(),
    fetch: async () => ({ ok: false, status: 500 }),
  });
  assert.equal(failed.status, 502);

  const get = await handleRequest({ method: "GET", headers: {}, body: note() }, options);
  assert.equal(get.status, 405);
});
