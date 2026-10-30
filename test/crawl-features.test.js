const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const sql = fs.readFileSync(path.join(root, "migrations", "20261029180000_crawl_feature_settings.sql"), "utf8");
const js = fs.readFileSync(path.join(root, "assets", "crawl-features.js"), "utf8");
const crawlJs = fs.readFileSync(path.join(root, "assets", "crawl.js"), "utf8");
const account = fs.readFileSync(path.join(root, "account.html"), "utf8");
const page = fs.readFileSync(path.join(root, "olympia", "coffee-crawl", "index.html"), "utf8");
const robots = fs.readFileSync(path.join(root, "robots.txt"), "utf8");
const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
const vercel = fs.readFileSync(path.join(root, "vercel.json"), "utf8");
const siteJs = fs.readFileSync(path.join(root, "assets", "site.js"), "utf8");
const homeSearch = fs.readFileSync(path.join(root, "assets", "home-search.js"), "utf8");

test("settings default off and the public read is a whitelist", () => {
  assert.match(sql, /add column if not exists settings jsonb/);
  assert.match(sql, /alter column settings set default '\{\}'::jsonb/);
  assert.match(sql, /alter column settings set not null/);
  assert.match(sql, /function public\.public_crawl_features\(p_crawl text\)/);
  assert.match(sql, /function public\.organizer_set_crawl_features\(p_crawl text, p_settings jsonb\)/);
  assert.match(sql, /grant execute on function public\.public_crawl_features\(text\) to anon, authenticated/);
  assert.match(sql, /grant execute on function public\.organizer_set_crawl_features\(text, jsonb\) to authenticated/);
  assert.match(sql, /co\.role in \('owner', 'organizer'\)/);
  assert.match(sql, /security definer/i);
  assert.match(sql, /set search_path to ''/i);
  ["guest_reviews", "peoples_choice", "completion_badge", "completion_raffle"].forEach(function (key) {
    assert.match(sql, new RegExp(key));
  });
});

test("puy-coffee cannot enable a switch and reads stay off", () => {
  assert.match(sql, /Puyallup crawl features stay off/);
  assert.match(sql, /when p_crawl = 'puy-coffee' then false/);
  assert.match(sql, /if v_crawl = 'puy-coffee' then/);
  assert.match(sql, /if p_crawl = 'puy-coffee' and v_val = 'true'::jsonb then/);
});

test("free seats, donations, and Lacey are omitted", () => {
  [sql, js, page, account].forEach(function (file) {
    assert.doesNotMatch(file, /shops_free/);
    assert.doesNotMatch(file, /sponsor_donate/);
    assert.doesNotMatch(file, /lacey/i);
  });
  assert.doesNotMatch(sql, /prize|winner|drawing/i);
});

test("guest completion line is only the held sentence", () => {
  const lines = sql.match(/You're on the completion list\./g) || [];
  assert.equal(lines.length, 1);
  assert.match(sql, /v_line := 'You''re on the completion list\.'/);
  assert.match(js, /var COMPLETION_LINE = "You're on the completion list\."/);
  assert.match(js, /progress\.completion_line === COMPLETION_LINE/);
  assert.match(js, /list\.textContent = COMPLETION_LINE/);
  assert.doesNotMatch(page, /You're on the completion list/);
  assert.doesNotMatch(page, /prize|raffle|drawing|winner/i);
});

test("paper stamps count and new crawls require a paid pin plus 50 meters", () => {
  assert.match(sql, /coalesce\(s\.source, 'digital'\) in \('digital', 'manual'\)/);
  assert.match(sql, /c_radius_m constant double precision := 50/);
  assert.match(sql, /raise exception 'You need to be at the shop'/);
  assert.match(sql, /raise exception 'Location required'/);
  assert.match(sql, /raise exception 'Not authenticated'/);
  assert.match(sql, /is_anonymous/);
  assert.match(sql, /if p_crawl is distinct from 'puy-coffee' then/);
  assert.match(sql, /raise exception 'Map pin required'/);
  assert.match(sql, /l\.is_paid is true/);
  assert.match(sql, /p_business, 'manual'/);
  assert.match(crawlJs, /Map pin required/);
  assert.match(crawlJs, /id === "puy-coffee" \|\| id === "oly-coffee"/);
});

test("oly-coffee is an unlisted staging crawl and is not linked from search", () => {
  assert.match(sql, /'oly-coffee'/);
  assert.match(sql, /is_listed = false/);
  assert.match(sql, /'chris@beekings.com'/);
  assert.match(page, /noindex, nofollow/);
  assert.match(page, /oly-coffee/);
  assert.match(robots, /Disallow: \/olympia/);
  assert.match(vercel, /\/olympia\/coffee-crawl/);
  assert.match(siteJs, /path\.startsWith\("\/olympia\/"\)/);
  assert.doesNotMatch(sitemap, /olympia|oly-coffee|lacey/i);
  assert.doesNotMatch(homeSearch, /oly-coffee/);
});

test("organizer screen exposes the four switches and refuses puy-coffee in the client", () => {
  assert.match(account, /id="org-features"/);
  assert.match(account, /id="feat-guest-reviews"/);
  assert.match(account, /id="feat-peoples-choice"/);
  assert.match(account, /id="feat-completion-badge"/);
  assert.match(account, /id="feat-completion-raffle"/);
  assert.match(account, /assets\/crawl-features\.js/);
  assert.match(js, /LOCKED = "puy-coffee"/);
  assert.match(js, /These stay off for the Puyallup crawl/);
  assert.match(js, /organizer_set_crawl_features/);
  assert.match(js, /Pending approval/);
  assert.match(js, /Stamp a shop before you vote/);
  assert.match(js, /Stamp this shop first|cast_peoples_choice/);
});

test("client whitelist drops unknown switches and locks puy-coffee", () => {
  const sandbox = { console: console };
  vm.createContext(sandbox);
  vm.runInContext(js, sandbox);
  const api = sandbox.HCFeatures;
  assert.equal(api.COMPLETION_LINE, "You're on the completion list.");
  const oly = api.flagsFrom({
    guest_reviews: true,
    peoples_choice: false,
    completion_badge: true,
    completion_raffle: true,
    extra: true
  }, "oly-coffee");
  assert.equal(oly.guest_reviews, true);
  assert.equal(oly.peoples_choice, false);
  assert.equal(oly.completion_badge, true);
  assert.equal(oly.completion_raffle, true);
  assert.equal(Object.keys(oly).join(","), "guest_reviews,peoples_choice,completion_badge,completion_raffle");
  const locked = api.flagsFrom({ guest_reviews: true, peoples_choice: true }, "puy-coffee");
  assert.equal(locked.guest_reviews, false);
  assert.equal(locked.peoples_choice, false);
  assert.equal(locked.completion_badge, false);
  assert.equal(locked.completion_raffle, false);
});
