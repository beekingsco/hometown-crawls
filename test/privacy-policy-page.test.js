const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const pagePath = path.join(root, "privacy/index.html");
const page = fs.readFileSync(pagePath, "utf8");
const sourcePath = "/home/ubuntu/.cursor/projects/workspace/uploads/HC-PRIVACY-POLICY-PUBLIC_a350.md";

function normMd(md) {
  return md
    .replaceAll("privacy@hometowncrawls.com", "chris@beekings.com")
    .replace(/^#{1,3} /gm, "")
    .replace(/^\s*- /gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normHtml(article) {
  return article
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|h1|h2|h3|li|ul|article)>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

test("privacy policy page uses the approved wording with the owner contact", () => {
  const article = page.match(/<article[\s\S]*<\/article>/);
  assert.ok(article, "missing article");
  const wording = normHtml(article[0]);
  assert.equal(
    crypto.createHash("sha256").update(wording).digest("hex"),
    "ac7393c3dd9a3b194a72ae3e1b176a23aa8f92d0247473883071823dce4b4a24"
  );
  if (fs.existsSync(sourcePath)) {
    assert.equal(wording, normMd(fs.readFileSync(sourcePath, "utf8")));
  }
  assert.equal((page.match(/href="mailto:chris@beekings\.com"/g) || []).length, 5);
  assert.match(page, /Effective date:<\/strong> October 6, 2026/);
  assert.match(page, /Miracle Studios Inc\./);
  assert.match(page, /href="https:\/\/stripe\.com\/privacy"/);
  assert.match(page, /Stripe's privacy policy/);
});

test("privacy policy page is indexable, linked, and has no trackers or old addresses", () => {
  const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
  const vercel = fs.readFileSync(path.join(root, "vercel.json"), "utf8");
  const siteJs = fs.readFileSync(path.join(root, "assets/site.js"), "utf8");
  const rules = fs.readFileSync(path.join(root, "puyallup/holiday-coffee-crawl/rules/index.html"), "utf8");
  assert.doesNotMatch(page, /noindex/i);
  assert.match(page, /content="index, follow"/);
  assert.match(page, /rel="canonical" href="https:\/\/www\.hometowncrawls\.com\/privacy"/);
  assert.match(sitemap, /https:\/\/www\.hometowncrawls\.com\/privacy/);
  assert.match(vercel, /"source": "\/privacy"/);
  assert.match(vercel, /"destination": "\/privacy\/index.html"/);
  assert.match(siteJs, /link\("privacy", "Privacy"\)/);
  assert.match(rules, /<a href="\/privacy">Hometown Crawls Privacy Policy<\/a>/);
  assert.match(page, /aria-label="Table of contents"/);
  assert.equal((page.match(/<h2 /g) || []).length, 14);
  for (const file of [page, rules, siteJs]) {
    assert.doesNotMatch(file, /hello@|privacy@hometowncrawls\.com/i);
  }
  assert.doesNotMatch(page, /revenue share|splits each shop/i);
  assert.doesNotMatch(page, /gtag|googletagmanager|google-analytics|plausible|facebook\.net|hotjar|segment\.com|mixpanel/i);
  assert.doesNotMatch(page, /application\/ld\+json/);
});
