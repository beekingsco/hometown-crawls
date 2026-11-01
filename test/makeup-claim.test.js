const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const sql = read("migrations/20261101190000_makeup_claim_tokens.sql");
const page = read("makeup/index.html");
const client = read("assets/makeup.js");
const docs = read("docs/makeup-stamp.md");

test("makeup migration locks tokens down and stamps without GPS", () => {
  assert.match(sql, /create table if not exists public\.makeup_claim_tokens/);
  assert.match(sql, /token uuid primary key/);
  assert.match(sql, /makeup_claim_tokens_one_open_idx/);
  assert.match(sql, /where used_at is null/);
  assert.match(sql, /makeup_claim_tokens_one_used_idx/);
  assert.match(sql, /where used_at is not null/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.makeup_claim_tokens from public, anon, authenticated/);
  assert.match(sql, /user_id = \(select auth\.uid\(\)\)/);
  assert.match(sql, /'digital'::text, 'manual'::text, 'makeup'::text/);
  assert.match(sql, /l\.is_paid is true/);
  assert.match(sql, /l\.is_approved is true/);
  assert.match(sql, /l\.is_visible is true/);
  assert.match(sql, /l\.lat is not null/);
  assert.match(sql, /l\.lng is not null/);
  assert.match(sql, /function public\.get_makeup_claim\(p_token uuid\)/);
  assert.match(sql, /function public\.claim_makeup_stamp\(p_token uuid, p_business text\)/);
  assert.match(sql, /function public\.issue_makeup_claim\(/);
  assert.match(sql, /security definer/i);
  assert.match(sql, /set search_path to ''/i);
  assert.match(sql, /grant execute on function public\.get_makeup_claim\(uuid\) to anon, authenticated/);
  assert.match(sql, /grant execute on function public\.claim_makeup_stamp\(uuid, text\) to anon, authenticated/);
  assert.match(sql, /revoke all on function public\.issue_makeup_claim\(text, uuid, integer\) from public, anon/);
  assert.match(sql, /grant execute on function public\.issue_makeup_claim\(text, uuid, integer\) to authenticated/);
  assert.match(sql, /auth\.role\(\) = 'service_role'/);
  assert.match(sql, /co\.role = 'owner'/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /source = 'makeup'/);
  assert.match(sql, /values \(v_token\.user_id, v_token\.crawl_id, v_business, null, null, 'makeup'\)/);
  assert.match(sql, /One makeup stamp per guest on this crawl/);
  assert.doesNotMatch(sql, /getCurrentPosition|geolocation|c_radius_m|Location required/);
  assert.doesNotMatch(sql, /—/);
});

test("makeup page is a noindex token link with a Vercel route", () => {
  const vercel = JSON.parse(read("vercel.json"));
  assert.deepEqual(
    vercel.rewrites.find((row) => row.source === "/makeup"),
    { source: "/makeup", destination: "/makeup/index.html" }
  );
  assert.match(read("robots.txt"), /Disallow: \/makeup/);
  assert.doesNotMatch(read("sitemap.xml"), /\/makeup/);
  assert.match(page, /noindex, nofollow/);
  assert.match(page, /name="referrer" content="strict-origin"/);
  assert.match(page, /\/assets\/makeup\.js\?v=makeup-1/);
  assert.match(page, /id="makeup-shops"/);
  assert.doesNotMatch(page + client, /—|getCurrentPosition|navigator\.geolocation/);
  assert.match(docs, /\/makeup\?t=/);
  assert.match(docs, /issue_makeup_claim/);
  assert.match(docs, /makeup_claim_tokens_one_open_idx/);
  assert.match(docs, /makeup_claim_tokens_one_used_idx/);
});

test("makeup page copy stays closed after use and does not ask for GPS or sign-in", () => {
  const sandbox = {
    URLSearchParams,
    document: { addEventListener() {}, getElementById() { return null; } }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(client, sandbox, { filename: "assets/makeup.js" });
  const ui = sandbox.window.HCMakeup;

  assert.equal(ui.tokenFromSearch("?t=AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"), "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(ui.tokenFromSearch("?t=not-a-token"), "");
  assert.equal(ui.tokenFromSearch("?token=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), "");
  assert.equal(ui.passportHref("puy-coffee"), "/puyallup/holiday-coffee-crawl");
  assert.equal(ui.passportHref("arl-coffee"), "/arlington/holiday-coffee-crawl");
  assert.equal(ui.passportHref("other"), "/account");

  const ready = ui.viewFor({
    status: "ready",
    crawl_id: "puy-coffee",
    crawl_name: "Downtown Puyallup Holiday Coffee Crawl",
    shops: [
      { id: "cedar", name: "Cedar Coffee" },
      { id: "anthem", name: "Anthem Coffee" }
    ]
  });
  assert.equal(ready.mode, "ready");
  assert.deepEqual(ready.shops.map((shop) => shop.id), ["anthem", "cedar"]);
  assert.match(ready.body, /Tap the shop you were trying to stamp/);
  assert.match(ready.body, /on the Downtown Puyallup Holiday Coffee Crawl/);
  assert.doesNotMatch(ready.body, /sign in|GPS required|location/i);

  const html = ui.shopsHtml([{ id: 'shop"><script>', name: "A & B <Cafe>" }]);
  assert.match(html, /data-business="shop&quot;&gt;&lt;script&gt;"/);
  assert.match(html, /A &amp; B &lt;Cafe&gt;/);
  assert.doesNotMatch(html, /<script>/);

  const claimed = ui.nextView(ready, {
    status: "claimed",
    crawl_id: "puy-coffee",
    business_name: "Anthem Coffee"
  });
  assert.equal(claimed.mode, "success");
  assert.equal(claimed.shops.length, 0);
  assert.match(claimed.body, /Anthem Coffee is on your passport/);

  const again = ui.viewFor({ status: "used", crawl_id: "puy-coffee", business_name: "Anthem Coffee" });
  assert.equal(again.mode, "used");
  assert.equal(again.shops.length, 0);
  assert.match(again.body, /this link is closed/);

  const keep = ui.nextView({
    status: "ready",
    crawl_id: "puy-coffee",
    shops: [{ id: "cedar", name: "Cedar Coffee" }]
  }, { status: "already_stamped", business_name: "Anthem Coffee" });
  assert.equal(keep.mode, "ready");
  assert.equal(keep.shops.length, 1);
  assert.match(keep.error, /already have that shop/);

  for (const status of ["expired", "invalid", "used"]) {
    const view = ui.viewFor({ status });
    assert.equal(view.shops.length, 0, status);
  }
  assert.match(ui.viewFor({ status: "expired" }).body, /expired|little while/);
  assert.match(ui.viewFor({ status: "invalid" }).title, /can't open this link/);
  assert.doesNotMatch(JSON.stringify([ready, claimed, again, keep]), /—/);
});

test("makeup claim rules hold on a local database", () => {
  execFileSync("sudo", ["-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-c", "drop database if exists hc_makeup_test"], {
    stdio: "pipe"
  });
  execFileSync("sudo", ["-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-c", "create database hc_makeup_test"], {
    stdio: "pipe"
  });
  execFileSync(
    "sudo",
    ["-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-d", "hc_makeup_test", "-f", path.join(__dirname, "makeup-claim.pg.sql")],
    { stdio: "pipe" }
  );
});
