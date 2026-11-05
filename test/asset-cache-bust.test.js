const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const CRAWL_VERSION = "autojoin-1";
const GUEST_HUB_VERSION = "guest-photos-1";

function htmlFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) htmlFiles(full, out);
    else if (entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

test("every crawl.js and guest-hub.js script tag is cache-busted", () => {
  const scriptRe = /<script\b[^>]*\bsrc=["']([^"']+)["']/gi;
  const hits = [];
  for (const file of htmlFiles(root)) {
    const html = fs.readFileSync(file, "utf8");
    for (const match of html.matchAll(scriptRe)) {
      const src = match[1].split(/[?#]/)[0];
      if (!/(?:^|\/)(?:crawl|guest-hub)\.js$/.test(src)) continue;
      hits.push({ file: path.relative(root, file), src: match[1] });
    }
  }
  assert.ok(hits.length >= 4, "expected guest pages to load crawl.js or guest-hub.js");
  for (const hit of hits) {
    const fileName = hit.src.split(/[?#]/)[0];
    const version = /guest-hub\.js$/.test(fileName) ? GUEST_HUB_VERSION : CRAWL_VERSION;
    assert.equal(
      hit.src.includes(`?v=${version}`),
      true,
      `${hit.file} still loads ${hit.src}`
    );
  }
  const holiday = hits.filter((hit) => hit.file.includes("holiday-coffee-crawl"));
  assert.ok(holiday.some((hit) => hit.src.includes("crawl.js")));
  assert.ok(holiday.some((hit) => hit.src.includes("guest-hub.js")));
});

test("asset responses revalidate within a minute", () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  const asset = vercel.headers.find((row) => row.source === "/assets/(.*)");
  assert.ok(asset, "missing /assets cache header");
  const cache = asset.headers.find((row) => row.key === "Cache-Control");
  assert.equal(cache.value, "public, max-age=60, must-revalidate");
});
