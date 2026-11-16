const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const crawlJs = read("assets/crawl.js");
const guestJs = read("assets/guest-hub.js");

function loadCrawl() {
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
    SUPABASE_URL: "https://tatwbjuwufeqynpufodq.supabase.co",
    SUPABASE_ANON_KEY: "anon",
    CRAWL_ID: "puy-coffee"
  };
  vm.runInNewContext(crawlJs, sandbox, { filename: "assets/crawl.js" });
  return sandbox.window.HCCrawl;
}

test("shop image urls use the render endpoint and leave other hosts alone", () => {
  const { shopImageUrl } = loadCrawl();
  const origin = "https://tatwbjuwufeqynpufodq.supabase.co";
  const photo = origin + "/storage/v1/object/public/shop-images/shop/gallery/a.jpg?download=1";
  assert.equal(
    shopImageUrl(photo, "photo"),
    origin + "/storage/v1/render/image/public/shop-images/shop/gallery/a.jpg?width=800&height=450&quality=70"
  );
  assert.equal(
    shopImageUrl(origin + "/storage/v1/object/public/shop-images/shop/logo/b.jpg", "logo"),
    origin + "/storage/v1/render/image/public/shop-images/shop/logo/b.jpg?width=400&quality=70"
  );
  assert.equal(
    shopImageUrl(origin + "/storage/v1/object/public/shop-images/shop/stamp/c.png", "stamp"),
    origin + "/storage/v1/render/image/public/shop-images/shop/stamp/c.png?width=400&quality=70"
  );
  const rendered = origin + "/storage/v1/render/image/public/shop-images/shop/logo/b.jpg?width=400&quality=70";
  assert.equal(shopImageUrl(rendered, "logo"), rendered);
  assert.equal(shopImageUrl("https://cdn.example/woods-logo.png", "logo"), "https://cdn.example/woods-logo.png");
  assert.equal(shopImageUrl("", "photo"), "");
});

test("rendered shop images stay lazy, and crawl pages ask crawl.js to size them", () => {
  const { renderStamps, renderShopList } = loadCrawl();
  const stamps = { innerHTML: "" };
  const origin = "https://tatwbjuwufeqynpufodq.supabase.co";
  renderStamps(stamps, [
    { id: "anthem", name: "Anthem", stamp_image_url: origin + "/storage/v1/object/public/shop-images/a/stamp/s.jpg", logo_url: "" },
    { id: "woods", name: "Woods", stamp_image_url: "", logo_url: "https://cdn.example/woods-logo.png" }
  ], [], "");
  assert.match(stamps.innerHTML, /\/storage\/v1\/render\/image\/public\/shop-images\/a\/stamp\/s\.jpg\?width=400&amp;quality=70/);
  assert.match(stamps.innerHTML, /https:\/\/cdn\.example\/woods-logo\.png/);
  assert.match(stamps.innerHTML, /loading="lazy" decoding="async"/);

  const list = { innerHTML: "" };
  renderShopList(list, [
    { id: "anthem", name: "Anthem", photo_urls: [origin + "/storage/v1/object/public/shop-images/a/gallery/p.jpg"], stamp_image_url: "", logo_url: "" }
  ], []);
  assert.match(list.innerHTML, /width=800&amp;height=450&amp;quality=70/);
  assert.match(list.innerHTML, /loading="lazy" decoding="async"/);

  for (const rel of ["puyallup/holiday-coffee-crawl/index.html", "arlington/holiday-coffee-crawl/index.html"]) {
    const page = read(rel);
    assert.match(page, /function shopPhoto\(value, kind\)/);
    assert.match(page, /HCCrawl\.shopImageUrl\(url, kind\)/);
    assert.match(page, /shopPhoto\(photos\[0\], "photo"\)/);
    assert.match(page, /shopPhoto\(s\.stamp_image_url, "stamp"\)/);
    assert.match(page, /shopPhoto\(s\.logo_url, "logo"\)/);
    assert.match(page, /decoding="async"/);
  }
});

function memoryStorage() {
  const data = new Map();
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); }
  };
}

async function bootGuest(options) {
  const calls = [];
  const storage = options.storage || memoryStorage();
  const gallery = { innerHTML: "" };
  const listeners = {};
  const rows = options.rows || [];
  const sandbox = {
    URLSearchParams,
    console,
    localStorage: storage,
    location: { search: options.search || "", pathname: "/puyallup/holiday-coffee-crawl", origin: "https://www.hometowncrawls.com" },
    document: {
      readyState: "loading",
      addEventListener(type, fn) { listeners[type] = fn; },
      getElementById(id) { return id === "photo-gallery" ? gallery : null; },
      body: { addEventListener(type, fn) { listeners[type] = fn; } }
    }
  };
  sandbox.window = sandbox;
  sandbox.HCCrawl = {
    async getSession() { return null; },
    client() {
      return {
        from() {
          const q = {
            select() { return q; },
            eq() { return q; },
            then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject); }
          };
          return q;
        },
        rpc(name) {
          calls.push(["rpc", name]);
          if (name === "get_public_crawl_photos") return Promise.resolve({ data: rows, error: null });
          return Promise.resolve({ data: [], error: null });
        },
        storage: {
          from() {
            return {
              createSignedUrls: options.createSignedUrls || (async (paths, expires, opts) => {
                calls.push(["batch", paths.slice(), expires, opts]);
                return {
                  data: paths.map((item) => ({
                    path: item,
                    signedUrl: "https://tatwbjuwufeqynpufodq.supabase.co/storage/v1/render/image/sign/guest-photos/" + item + "?token=same"
                  })),
                  error: null
                };
              }),
              createSignedUrl: async (item, expires, opts) => {
                calls.push(["one", item, expires, opts]);
                return { data: { signedUrl: "https://tatwbjuwufeqynpufodq.supabase.co/storage/v1/render/image/sign/guest-photos/" + item + "?token=one" } };
              }
            };
          }
        }
      };
    },
    async myStamps() { return []; },
    async loadShops() { return { shops: [] }; }
  };
  vm.runInNewContext(guestJs, sandbox, { filename: "assets/guest-hub.js" });
  listeners.DOMContentLoaded();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { calls, gallery, listeners, storage };
}

test("guest photos are transformed, cached, lazy, and paged", async () => {
  const rows = Array.from({ length: 15 }, (_, index) => ({ id: "p" + index, path: "guest/" + index + ".jpg" }));
  const first = await bootGuest({ rows });
  const batches = first.calls.filter((row) => row[0] === "batch");
  assert.equal(batches.length, 1);
  assert.equal(batches[0][1].length, 15);
  assert.equal(batches[0][2], 86400);
  assert.equal(JSON.stringify(batches[0][3]), JSON.stringify({ transform: { width: 640, height: 640, quality: 70, resize: "cover" } }));
  assert.equal((first.gallery.innerHTML.match(/<img /g) || []).length, 12);
  assert.match(first.gallery.innerHTML, /loading="lazy" decoding="async"/);
  assert.match(first.gallery.innerHTML, /\/render\/image\/sign\/guest-photos\//);
  assert.match(first.gallery.innerHTML, /data-more-photos="gallery"/);
  assert.match(first.gallery.innerHTML, /Show more/);

  first.listeners.click({
    target: {
      closest(sel) {
        if (sel === "[data-more-photos]") return { getAttribute() { return "gallery"; } };
        return null;
      }
    }
  });
  assert.equal((first.gallery.innerHTML.match(/<img /g) || []).length, 15);
  assert.doesNotMatch(first.gallery.innerHTML, /Show more/);

  const saved = first.storage.getItem("hc-guest-photo-urls");
  assert.ok(saved);
  const again = memoryStorage();
  again.setItem("hc-guest-photo-urls", saved);
  const replay = await bootGuest({
    rows,
    storage: again,
    createSignedUrls: async () => { throw new Error("signed url cache missed"); }
  });
  assert.match(replay.gallery.innerHTML, /token=same/);
  assert.equal(replay.calls.filter((row) => row[0] === "batch" || row[0] === "one").length, 0);
});

test("a batch that skips the resize falls back to transformed urls", async () => {
  const result = await bootGuest({
    rows: [{ id: "1", path: "guest/1.jpg" }],
    createSignedUrls: async (paths) => ({
      data: paths.map((item) => ({
        path: item,
        signedUrl: "https://tatwbjuwufeqynpufodq.supabase.co/storage/v1/object/sign/guest-photos/" + item + "?token=full"
      }))
    })
  });
  assert.equal(result.calls.filter((row) => row[0] === "one").length, 1);
  assert.match(result.gallery.innerHTML, /\/render\/image\/sign\/guest-photos\//);
  assert.doesNotMatch(result.gallery.innerHTML, /\/object\/sign\//);
});

test("a failed batch falls back to one signed url at a time", async () => {
  const result = await bootGuest({
    rows: [{ id: "1", path: "guest/1.jpg" }],
    createSignedUrls: async () => { throw new Error("no batch"); }
  });
  const singles = result.calls.filter((row) => row[0] === "one");
  assert.equal(singles.length, 1);
  assert.equal(singles[0][2], 86400);
  assert.equal(JSON.stringify(singles[0][3]), JSON.stringify({ transform: { width: 640, height: 640, quality: 70, resize: "cover" } }));
  assert.match(result.gallery.innerHTML, /token=one/);
});

test("guest uploads resize before storage and cache the object for a year", () => {
  assert.match(guestJs, /cacheControl: "31536000"/);
  assert.match(guestJs, /canvas\.toBlob\(function \(blob\) \{ finish\(blob, width, height, revoke\); \}, "image\/jpeg", 0\.8\)/);
  assert.match(guestJs, /1600 \/ longSide/);
  assert.match(guestJs, /createSignedUrls/);
  assert.match(read("assets/stamp-art.js"), /cacheControl: "31536000"/);
  assert.match(read("assets/store-listing.js"), /cacheControl: "31536000"/);
  assert.match(read("assets/organizer-panel.js"), /cacheControl: "31536000"/);
  assert.match(read("puyallup/coffee-crawl/shop/index.html"), /cacheControl: "31536000"/);
});
