const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const documentStub = {
  readyState: "loading",
  addEventListener() {},
  getElementById() { return null; },
  createElement(tag) {
    return {
      tag,
      className: "",
      children: [],
      href: "",
      textContent: "",
      setAttribute(name, value) { this[name] = value; },
      append(...nodes) { this.children.push(...nodes); },
      replaceChildren(...nodes) { this.children = nodes.slice(); }
    };
  }
};
const sandbox = {
  document: documentStub,
  console,
  Intl,
  Date,
  URL,
  fetch
};
sandbox.window = sandbox;
vm.runInNewContext(read("assets/home-search.js"), sandbox, { filename: "assets/home-search.js" });
const home = sandbox.HCHome;

const coffee = {
  id: "puy-coffee",
  name: "Puyallup Holiday Coffee Crawl",
  city: "Puyallup",
  type: "coffee",
  lat: 47.191,
  lng: -122.293,
  starts_at: "2026-11-01T07:00:00Z",
  ends_at: "2027-01-01T07:59:00Z",
  created_at: "2026-09-08T16:07:03.903Z"
};
const pub = {
  id: "puy-pub",
  name: "Puyallup Pub Crawl",
  city: "Puyallup",
  type: "pub",
  lat: 47.1912,
  lng: -122.2932,
  starts_at: "2026-10-01T18:00:00Z",
  ends_at: "2026-12-01T06:59:00Z",
  created_at: "2026-09-08T16:07:03.903Z"
};
const ended = {
  id: "old",
  name: "Old Crawl",
  city: "Puyallup",
  type: "coffee",
  lat: 47.191,
  lng: -122.293,
  starts_at: "2025-01-01T08:00:00Z",
  ends_at: "2025-02-01T08:00:00Z",
  created_at: "2026-10-01T00:00:00Z"
};
const now = new Date("2026-10-14T21:00:00Z");

test("distance stays inside 50 miles for a nearby town and outside for a far one", () => {
  assert.ok(home.miles(47.191, -122.293, 47.191, -122.293) < 0.01);
  const seattle = home.miles(47.191, -122.293, 47.6062, -122.3321);
  assert.ok(seattle < 50, String(seattle));
  const boise = home.miles(47.191, -122.293, 43.615, -116.2023);
  assert.ok(boise > 50, String(boise));
});

test("phase treats a started crawl as active and a future crawl as upcoming", () => {
  assert.equal(home.crawlPhase(pub, now), "active");
  assert.equal(home.crawlPhase(coffee, now), "upcoming");
  assert.equal(home.crawlPhase(ended, now), "ended");
  assert.equal(home.crawlPhase({ starts_at: null, ends_at: null }, now), "upcoming");
});

test("newest crawls are the three active or upcoming rows, newest first", () => {
  const extra = Object.assign({}, coffee, { id: "newer", name: "Newer", created_at: "2026-10-02T00:00:00Z" });
  const fourth = Object.assign({}, coffee, { id: "fourth", name: "Fourth", created_at: "2026-08-01T00:00:00Z" });
  const rows = home.newestCrawls([ended, coffee, pub, extra, fourth], now);
  assert.deepEqual(rows.map((row) => row.id), ["newer", "puy-coffee", "puy-pub"]);
});

const arlington = {
  id: "arl-coffee",
  name: "Arlington Holiday Coffee Crawl",
  city: "Arlington",
  type: "coffee",
  lat: 48.1987,
  lng: -122.1251,
  starts_at: "2026-11-01T16:00:00Z",
  ends_at: "2027-01-01T07:59:59Z",
  created_at: "2026-10-30T16:02:31.025Z"
};

function cardText(node, found) {
  const acc = found || [];
  if (node && node.textContent) acc.push(node.textContent);
  (node && node.children || []).forEach((child) => cardText(child, acc));
  return acc;
}

test("new crawl cards place Arlington immediately after the Puyallup holiday crawl", () => {
  const rows = home.newestCrawls([ended, arlington, coffee, pub], now);
  assert.deepEqual(rows.map((row) => row.id), ["puy-coffee", "arl-coffee", "puy-pub"]);
  const newer = Object.assign({}, coffee, { id: "newer", name: "Newer", created_at: "2026-10-31T00:00:00Z" });
  const withNewer = home.newestCrawls([newer, arlington, coffee, pub], now);
  assert.deepEqual(withNewer.map((row) => row.id), ["newer", "puy-coffee", "arl-coffee"]);
  assert.deepEqual(
    home.placeArlingtonAfterPuyallup([
      { id: "arl-coffee" },
      { id: "other" },
      { id: "puy-coffee" }
    ]).map((row) => row.id),
    ["other", "puy-coffee", "arl-coffee"]
  );
});

test("Arlington cards say starting soon and other crawls keep Active or Upcoming", () => {
  assert.equal(home.crawlStatusLabel(arlington, now), "starting soon");
  assert.equal(home.crawlStatusLabel(arlington, new Date("2026-11-02T18:00:00Z")), "starting soon");
  assert.equal(home.crawlStatusLabel(coffee, now), "Upcoming");
  assert.equal(home.crawlStatusLabel(pub, now), "Active");
  assert.equal(home.crawlStatusLabel(ended, now), "");

  const featured = home.renderCard(arlington, true, now);
  const tag = featured.children[0].children.find((node) => String(node.className).includes("home-tag"));
  assert.equal(tag.textContent, "starting soon");
  assert.match(tag.className, /home-tag-soon/);
  assert.equal(cardText(featured).includes("Upcoming"), false);
  assert.equal(cardText(featured).includes("Active"), false);

  const searched = home.renderCard(arlington, false, now);
  assert.equal(cardText(searched).includes("starting soon"), true);
  assert.equal(searched.children.some((node) => String(node.className).includes("home-tag")), false);

  const puyallupCard = home.renderCard(coffee, true, now);
  const puyTag = puyallupCard.children[0].children.find((node) => String(node.className).includes("home-tag"));
  assert.equal(puyTag.textContent, "Upcoming");
  assert.equal(puyTag.className, "home-tag");

  const css = read("assets/home.css");
  assert.match(css, /\.home-tag\.home-tag-soon \{ text-transform: none/);
  assert.doesNotMatch(read("assets/home-search.js"), /Sunday go-live/);
  assert.doesNotMatch(read("puyallup/holiday-coffee-crawl/index.html"), /Arlington|arl-coffee/);
  assert.match(read("puyallup/holiday-coffee-crawl/index.html"), /Fill your passport to enter the prize drawing\./);
});

test("nearby search stays in distance order when Arlington is closer than Puyallup", () => {
  const rows = home.nearbyCrawls([coffee, arlington], { lat: 48.1987, lng: -122.1251 }, now, 200);
  assert.deepEqual(rows.map((row) => row.id), ["arl-coffee", "puy-coffee"]);
});

test("nearby crawls sort by distance and drop ended or far rows", () => {
  const far = Object.assign({}, coffee, { id: "far", name: "Far", lat: 43.615, lng: -116.2023 });
  const rows = home.nearbyCrawls([ended, far, coffee, pub], { lat: 47.2, lng: -122.3 }, now);
  assert.deepEqual(rows.map((row) => row.id), ["puy-pub", "puy-coffee"]);
  assert.ok(rows[0].distance <= rows[1].distance);
});

test("the Puyallup holiday crawl card uses the holiday hero, other coffee crawls do not", () => {
  assert.equal(home.typeArt("coffee", "puy-coffee"), "/assets/home/puyallup-holiday-coffee-crawl-hero.jpg");
  assert.equal(home.typeArt("coffee", "other-coffee"), "/assets/home/coffee.jpg");
  assert.equal(home.typeArt("coffee"), "/assets/home/coffee.jpg");
  assert.equal(home.typeArt("pub", "puy-pub"), "/assets/home/pub.jpg");
});

test("dates use Pacific time and known crawls link to their pages", () => {
  assert.equal(home.formatDates(coffee), "November 1 – December 31, 2026");
  assert.equal(home.formatDates(pub), "October 1 – November 30, 2026");
  assert.equal(home.crawlHref("puy-coffee"), "/puyallup/holiday-coffee-crawl");
  assert.equal(home.crawlHref("puy-pub"), "/puyallupwa/pub");
  assert.equal(home.crawlHref("arl-coffee"), "/arlington/holiday-coffee-crawl");
  assert.equal(home.typeArt("coffee", "arl-coffee"), "/assets/home/coffee.jpg");
  assert.equal(home.crawlHref("future"), "/account.html");
});

test("geocode sends zips to zippopotam and cities to Nominatim", async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes("zippopotam")) {
      return {
        ok: true,
        json: async () => ({ places: [{ latitude: "47.185", longitude: "-122.293", "place name": "Puyallup", "state abbreviation": "WA" }] })
      };
    }
    return { ok: true, json: async () => ([{ lat: "47.25", lon: "-122.44", display_name: "Tacoma, WA" }]) };
  };
  const zip = await home.geocode("98371-1234", fakeFetch);
  assert.equal(zip.lat, 47.185);
  assert.match(calls[0], /^https:\/\/api\.zippopotam\.us\/us\/98371$/);
  const city = await home.geocode("Tacoma, WA", fakeFetch);
  assert.equal(city.lng, -122.44);
  assert.match(calls[1], /nominatim\.openstreetmap\.org/);
  assert.match(calls[1], /countrycodes=us/);
});

test("empty search state links to organize", () => {
  const box = { children: [], replaceChildren(...nodes) { this.children = nodes.slice(); } };
  home.renderEmpty(box);
  const paragraph = box.children[0];
  assert.equal(paragraph.children[0], home.EMPTY_LEAD);
  assert.equal(paragraph.children[1].href, "/organize");
  assert.equal(paragraph.children[1].textContent, "start one");
  assert.equal(home.EMPTY_LEAD + home.EMPTY_LINK, "No crawls near you yet — start one");
});

test("homepage search markup replaces the Puyallup map", () => {
  const page = read("index.html");
  const script = read("assets/home-search.js");
  const sql = read("migrations/20261014250000_public_crawls.sql");
  assert.match(page, /id="crawl-search"/);
  assert.match(page, /id="new-crawls-heading">New crawls</);
  assert.doesNotMatch(page, /interactive map isn't available/i);
  assert.doesNotMatch(page, /leaflet/);
  assert.doesNotMatch(page, /home-map/);
  assert.doesNotMatch(read("assets/home.js"), /loadShops\('puy-coffee'\)/);
  assert.doesNotMatch(script, /select\("\*"/);
  assert.match(script, /list_public_crawls/);
  assert.match(sql, /grant execute on function public\.list_public_crawls\(\) to anon, authenticated/);
  assert.doesNotMatch(sql, /grant insert|grant update|grant delete/i);
  assert.doesNotMatch(sql, /signup_key|payment_link/);
  assert.equal((page.match(/<h2[^>]*>Three steps to a full passport<\/h2>/g) || []).length, 1);
});
