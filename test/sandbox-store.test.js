const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const S = require("../sandbox/store");

function memoryStorage(initial) {
  const data = new Map();
  if (initial) data.set(S.STORAGE_KEY, initial);
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key)
  };
}

test("seed is a fictional Demo Town crawl with 8 shops and 40 guests", () => {
  const state = S.createSeed();
  assert.equal(state.crawls.length, 1);
  const crawl = state.crawls[0];
  assert.equal(crawl.name, "Holiday Coffee Crawl");
  assert.equal(crawl.city, "Demo Town");
  assert.equal(crawl.stateSlug, "ds");
  assert.equal(crawl.citySlug, "demo-town");
  assert.equal(crawl.slug, "holiday-coffee-crawl");
  assert.equal(crawl.start, "2026-11-01");
  assert.equal(crawl.end, "2026-12-31");
  assert.equal(S.shopsFor(state, crawl.id).length, 8);
  assert.equal(S.guestsFor(state, crawl.id).length, 40);
  assert.equal(S.routeFor(crawl), "#/ds/demo-town/holiday-coffee-crawl");
  crawl.prizes.forEach((prize) => assert.equal(prize.example, true));
});

test("stamps spread across three weeks and Alex is two away", () => {
  const state = S.createSeed();
  const days = new Set(state.stamps.map((stamp) => stamp.at.slice(0, 10)));
  assert.equal(days.size, 21);
  assert.equal([...days].sort()[0], "2026-11-01");
  assert.equal([...days].sort().at(-1), "2026-11-21");
  const alex = S.progress(state, S.CRAWL_ID, S.YOU_ID);
  assert.equal(alex.got, 6);
  assert.equal(alex.total, 8);
  assert.equal(alex.remaining, 2);
  assert.equal(alex.nudge, "You're 2 away");
  assert.equal(alex.done, false);
  const completers = S.guestsFor(state, S.CRAWL_ID).filter((guest) => S.progress(state, S.CRAWL_ID, guest.id).done);
  assert.equal(completers.length, 8);
});

test("stamp claim checks the code and the 150 m geofence", () => {
  const state = S.createSeed();
  const shop = S.shopsFor(state, S.CRAWL_ID)[6];
  const near = S.simulatedFix(shop, "near");
  const far = S.simulatedFix(shop, "far");
  assert.ok(S.haversineMeters(shop, near) <= S.GEOFENCE_M);
  assert.ok(S.haversineMeters(shop, far) > S.GEOFENCE_M);

  const wrong = S.claimStamp(state, { shopId: shop.id, code: "NOPE", lat: near.lat, lng: near.lng });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.error, "Invalid code");

  const away = S.claimStamp(state, { shopId: shop.id, code: shop.code, lat: far.lat, lng: far.lng });
  assert.equal(away.ok, false);
  assert.equal(away.error, "You need to be at the shop");

  const ok = S.claimStamp(state, { shopId: shop.id, code: "cppr31", lat: near.lat, lng: near.lng });
  assert.equal(ok.ok, true);
  assert.equal(S.progress(state, S.CRAWL_ID, S.YOU_ID).nudge, "You're 1 away");

  const again = S.claimStamp(state, { shopId: shop.id, code: shop.code, lat: near.lat, lng: near.lng });
  assert.equal(again.error, "Already stamped");

  const last = S.shopsFor(state, S.CRAWL_ID)[7];
  const finish = S.claimStamp(state, {
    shopId: last.id,
    code: last.code,
    lat: last.lat,
    lng: last.lng
  });
  assert.equal(finish.ok, true);
  assert.equal(finish.completed, true);
  assert.match(finish.voucher, /^EX-[A-Z0-9]{6}$/);
});

test("vouchers redeem once and the demo has no payout or pub crawl", () => {
  const state = S.createSeed();
  assert.equal(S.TEMPLATES.some((item) => item.id === "pub"), false);
  assert.equal(state.applications.some((item) => item.templateId === "pub"), false);

  const guests = S.guestsFor(state, S.CRAWL_ID);
  const redeemed = guests.find((guest) => guest.id === "g1");
  const open = guests.find((guest) => guest.id === "g2");
  const shop = S.shopsFor(state, S.CRAWL_ID)[0];
  const again = S.redeemVoucher(state, { code: redeemed.voucher, shopId: shop.id });
  assert.equal(again.ok, false);
  assert.equal(again.error, "Already redeemed");
  const first = S.redeemVoucher(state, { code: open.voucher.toLowerCase(), shopId: shop.id });
  assert.equal(first.ok, true);
  const second = S.redeemVoucher(state, { code: open.voucher, shopId: shop.id });
  assert.equal(second.error, "Already redeemed");
});

test("csv export, launch wizard, and local reset stay inside the mock store", () => {
  const state = S.createSeed();
  const guests = S.guestsCsv(state, S.CRAWL_ID);
  assert.match(guests.split("\n")[0], /name,email,stamps/);
  assert.equal(guests.trim().split("\n").length, 41);
  const stamps = S.stampsCsv(state, S.CRAWL_ID);
  assert.match(stamps, /2026-11-01/);
  assert.match(stamps, /2026-11-21/);

  const wizard = S.defaultWizard();
  wizard.town = "Frostford";
  wizard.stateName = "ds";
  wizard.templateId = "taco";
  S.applyTemplate(wizard);
  wizard.crawlName = "Frostford Taco Crawl";
  const created = S.createCrawl(state, wizard);
  assert.equal(created.ok, true);
  assert.equal(created.receipt.simulated, true);
  assert.equal(created.crawl.stateSlug, "ds");
  assert.equal(created.crawl.citySlug, "frostford");
  assert.equal(created.crawl.slug, "frostford-taco-crawl");
  assert.equal(created.crawl.status, "pending");
  assert.equal(S.shopsFor(state, created.crawl.id).length, 4);
  assert.equal(state.applications[0].status, "pending");
  const decision = S.decideApplication(state, state.applications[0].id, "approved");
  assert.equal(decision.ok, true);
  assert.equal(created.crawl.status, "live");

  const refund = S.simulateRefund(state, S.shopsFor(state, S.CRAWL_ID)[0].id);
  assert.match(refund.summary, /No Stripe call/);
  const resend = S.simulateResend(state, S.shopsFor(state, S.CRAWL_ID)[0].id);
  assert.match(resend.summary, /No email was sent/);

  const storage = memoryStorage();
  S.saveState(storage, state);
  const loaded = S.loadState(storage);
  assert.equal(loaded.crawls.length, 2);
  const fresh = S.resetState(storage);
  assert.equal(fresh.crawls.length, 1);
  assert.equal(S.loadState(storage).crawls[0].id, S.CRAWL_ID);
});

test("sandbox pages stay out of search and away from live keys", () => {
  const root = path.join(__dirname, "..");
  const robots = fs.readFileSync(path.join(root, "robots.txt"), "utf8");
  const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
  const html = fs.readFileSync(path.join(root, "sandbox/index.html"), "utf8");
  const ui = fs.readFileSync(path.join(root, "sandbox/ui.js"), "utf8");
  const store = fs.readFileSync(path.join(root, "sandbox/store.js"), "utf8");
  assert.match(robots, /Disallow:\s*\/sandbox\/?/);
  assert.doesNotMatch(sitemap, /sandbox/i);
  assert.match(html, /noindex,\s*nofollow/);
  const sandboxRobots = fs.readFileSync(path.join(root, "sandbox/robots.txt"), "utf8");
  assert.match(sandboxRobots, /Disallow:\s*\//);
  assert.doesNotMatch(robots, /^Disallow:\s*\/\s*$/m);
  assert.match(robots, /Sitemap:\s*https:\/\/hometowncrawls\.com\/sitemap\.xml/);
  const config = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  const sandboxHeaders = config.headers.filter((rule) =>
    (rule.has || []).some((item) => item.type === "host" && /sandbox/.test(item.value))
  );
  assert.ok(sandboxHeaders.some((rule) =>
    rule.headers.some((header) => header.key === "X-Robots-Tag" && header.value === "noindex, nofollow")
  ));
  const sandboxRedirects = config.redirects.filter((rule) =>
    (rule.has || []).some((item) => item.type === "host" && /sandbox/.test(item.value))
  );
  assert.ok(sandboxRedirects.some((rule) => rule.source === "/" && rule.destination === "/sandbox"));
  assert.ok(sandboxRedirects.some((rule) => rule.source === "/robots.txt" && rule.destination === "/sandbox/robots.txt"));
  assert.equal(config.redirects.some((rule) => rule.source === "/puyallup" && rule.has), false);
  for (const source of [html, ui, store]) {
    assert.doesNotMatch(source, /config\.js/);
    assert.doesNotMatch(source, /supabase/i);
    assert.doesNotMatch(source, /sk_live|pk_live|STRIPE_SECRET|SUPABASE_ANON/i);
    assert.doesNotMatch(source, /api\/stripe/);
    assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest/);
    assert.doesNotMatch(source, /payout|50\/50|organizer half|revenue share/i);
    assert.doesNotMatch(source, /\bpub\b/i);
  }
});
