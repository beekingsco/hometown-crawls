const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const video = require("../assets/video-embed.js");
const migration = read("migrations/20261027150000_shop_crawl_video_url.sql");

const YT = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const SHORT = "https://www.youtube.com/shorts/dQw4w9WgXcQ";
const BE = "https://youtu.be/dQw4w9WgXcQ";
const REEL = "https://www.instagram.com/reel/C0ffee1234/";
const POST = "https://www.instagram.com/p/C0ffee1234/";
const TIKTOK = "https://www.tiktok.com/@anthemcoffee/video/1234567890123456789";

test("known video links become official embed iframes", () => {
  assert.equal(video.parse(YT).src, "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  assert.equal(video.parse(SHORT).src, "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  assert.equal(video.parse(BE + "?si=tracking").src, "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  assert.equal(video.parse("https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=30").src, "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  assert.equal(video.parse(REEL).src, "https://www.instagram.com/reel/C0ffee1234/embed");
  assert.equal(video.parse(POST + "?img_index=1").src, "https://www.instagram.com/p/C0ffee1234/embed");
  assert.equal(video.parse("https://www.instagram.com/anthemcoffee/reel/C0ffee1234/").src, "https://www.instagram.com/reel/C0ffee1234/embed");
  assert.equal(video.parse(TIKTOK + "?is_from_webapp=1").src, "https://www.tiktok.com/embed/v2/1234567890123456789");
  assert.equal(video.parse(SHORT).layout, "wide");
  assert.equal(video.parse(REEL).layout, "portrait");
  assert.equal(video.parse(POST).layout, "post");
  assert.equal(video.parse(TIKTOK).layout, "portrait");
});

test("unknown hosts, handles, and raw html do not render", () => {
  [
    "",
    "   ",
    "not a url",
    "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://vimeo.com/123456",
    "https://www.instagram.com/anthemcoffee",
    "https://www.tiktok.com/@anthemcoffee",
    "https://vm.tiktok.com/Zabc123/",
    "https://www.youtube.com/channel/UC123",
    "javascript:alert(1)",
    "https://evil.com@www.youtube.com/watch?v=dQw4w9WgXcQ",
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ"><script>alert(1)</script>',
    "<iframe src='https://www.youtube.com/embed/dQw4w9WgXcQ'></iframe>"
  ].forEach((input) => {
    assert.equal(video.parse(input), null, input);
    assert.equal(video.frame(input), "");
  });
  assert.match(video.problem("https://vimeo.com/1"), /YouTube, Instagram, or TikTok/);
  assert.equal(video.problem(""), "");
  assert.equal(video.problem(YT), "");
});

test("embed markup uses the official src and not the pasted string", () => {
  const html = video.frame(YT + "&foo=%3Cscript%3E");
  assert.match(html, /src="https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ"/);
  assert.doesNotMatch(html, /foo=/);
  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /class="hc-video-frame"/);
  const reel = video.frame(REEL);
  assert.match(reel, /class="hc-video-frame is-portrait"/);
  assert.match(reel, /src="https:\/\/www\.instagram\.com\/reel\/C0ffee1234\/embed"/);
  const tiktok = video.frame(TIKTOK);
  assert.match(tiktok, /src="https:\/\/www\.tiktok\.com\/embed\/v2\/1234567890123456789"/);
  assert.doesNotMatch(tiktok, /anthemcoffee/);
});

test("video url check is executable by the roles that write shop and crawl rows", () => {
  const grant = read("migrations/20261030182000_grant_video_url_is_embeddable.sql");
  assert.match(grant, /grant execute on function private\.video_url_is_embeddable\(text\) to authenticated/i);
  assert.match(grant, /grant execute on function private\.video_url_is_embeddable\(text\) to anon/i);
  assert.doesNotMatch(grant, /security definer/i);
  assert.doesNotMatch(grant, /service_role/);
  assert.doesNotMatch(grant, /grant execute on function private\.video_url_is_embeddable\(text\) to public/i);
  assert.ok(migration.indexOf("revoke all on function private.video_url_is_embeddable(text) from public, anon, authenticated") >= 0);
});

test("migration stores video_url and keeps embeds off the anon write path", () => {
  assert.match(migration, /alter table public\.shop_listings\s+add column if not exists video_url text/);
  assert.match(migration, /alter table public\.crawls\s+add column if not exists video_url text/);
  assert.match(migration, /private\.video_url_is_embeddable/);
  assert.match(migration, /p_video_url text default null/);
  assert.match(migration, /video_url = v_video/);
  assert.match(migration, /grant execute on function public\.get_public_crawl_shops\(text\) to anon, authenticated/);
  assert.doesNotMatch(migration, /service_role/);
  assert.doesNotMatch(migration, /grant execute on function public\.shop_save_listing\([^)]*\) to anon/);
  assert.doesNotMatch(migration, /grant execute on function public\.organizer_update_crawl\([^)]*\) to anon/);
  assert.ok(migration.indexOf("drop view if exists public.crawl_shops_public") < migration.indexOf("drop function if exists public.get_public_crawl_shops(text)"));
});

test("edit forms and public pages wire the video link", () => {
  const account = read("account.html");
  const listing = read("assets/store-listing.js");
  const organizer = read("assets/organizer-panel.js");
  const holiday = read("puyallup/holiday-coffee-crawl/index.html");
  const coffee = read("puyallupwa/coffee/index.html");
  assert.match(account, /id="list-video"/);
  assert.match(account, /id="org-video"/);
  assert.match(account, /id="org-shop-video"/);
  assert.match(account, /Paste a YouTube, Instagram, or TikTok video URL\./);
  assert.match(account, /id="list-instagram"/);
  assert.match(listing, /p_video_url: draft\.video/);
  assert.match(organizer, /p_video_url: videoUrl/);
  assert.match(organizer, /p_video_url: draft\.video/);
  assert.match(holiday, /id="crawl-video"/);
  assert.match(holiday, /HCVideo\.frame\(s\.video_url\)/);
  assert.match(holiday, /select\("name"\)/);
  assert.match(coffee, /id="crawl-video"/);
  assert.match(coffee, /renderVideo/);
  assert.match(read("assets/crawl.js"), /function renderVideo/);
  assert.doesNotMatch(listing, /innerHTML\s*=\s*[^;]*video/);
});
