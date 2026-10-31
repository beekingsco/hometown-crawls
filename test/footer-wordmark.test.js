const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

function decodePng(file) {
  const data = fs.readFileSync(file);
  assert.equal(data.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  let pos = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (pos < data.length) {
    const len = data.readUInt32BE(pos);
    const type = data.subarray(pos + 4, pos + 8).toString("ascii");
    const chunk = data.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      assert.equal(chunk[8], 8);
      assert.equal(chunk[9], 6);
    } else if (type === "IDAT") {
      idat.push(chunk);
    } else if (type === "IEND") {
      break;
    }
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const rows = [];
  let i = 0;
  let prev = Buffer.alloc(stride);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[i++];
    const row = Buffer.from(raw.subarray(i, i + stride));
    i += stride;
    if (filter === 1) {
      for (let x = 0; x < stride; x++) row[x] = (row[x] + (x >= bpp ? row[x - bpp] : 0)) & 255;
    } else if (filter === 2) {
      for (let x = 0; x < stride; x++) row[x] = (row[x] + prev[x]) & 255;
    } else if (filter === 3) {
      for (let x = 0; x < stride; x++) {
        const left = x >= bpp ? row[x - bpp] : 0;
        row[x] = (row[x] + ((left + prev[x]) >> 1)) & 255;
      }
    } else if (filter === 4) {
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? row[x - bpp] : 0;
        row[x] = (row[x] + paeth(a, prev[x], x >= bpp ? prev[x - bpp] : 0)) & 255;
      }
    } else if (filter !== 0) {
      throw new Error("unexpected png filter " + filter);
    }
    rows.push(row);
    prev = row;
  }
  return { width, height, rows };
}

function pixel(rows, x, y) {
  const i = x * 4;
  const row = rows[y];
  return [row[i], row[i + 1], row[i + 2], row[i + 3]];
}

test("footer wordmark keeps cream script and a visible passport mark", () => {
  const { width, height, rows } = decodePng(path.join(root, "assets/home/wordmark-footer.png"));
  assert.equal(width, 2048);
  assert.equal(height, 768);

  let ink = 0;
  let creamOnBadge = 0;
  let whiteBadge = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < 530; x += 2) {
      const [r, g, b, a] = pixel(rows, x, y);
      if (a < 200) continue;
      if (r < 80 && g < 70 && b < 60) ink++;
      else if (r > 248 && g > 248 && b > 248) whiteBadge++;
      else if (Math.abs(r - 251) <= 8 && Math.abs(g - 246) <= 8 && Math.abs(b - 237) <= 8) creamOnBadge++;
    }
  }
  // The passport face used to be #fbf6ed on white, which reads as a blank box on the dark footer.
  assert.equal(creamOnBadge, 0);
  assert.ok(ink > 2000, "expected dark passport line art, got " + ink);
  assert.ok(whiteBadge > 5000, "expected the white passport badge to remain");

  let creamScript = 0;
  let darkScript = 0;
  for (let y = 0; y < height; y += 4) {
    for (let x = 600; x < width; x += 4) {
      const [r, g, b, a] = pixel(rows, x, y);
      if (a < 200) continue;
      if (Math.abs(r - 251) <= 8 && Math.abs(g - 246) <= 8 && Math.abs(b - 237) <= 8) creamScript++;
      if (r < 80 && g < 70 && b < 60) darkScript++;
    }
  }
  assert.ok(creamScript > 5000, "wordmark script should stay cream, got " + creamScript);
  assert.equal(darkScript, 0);
});

test("homepage and shared footer both use the footer wordmark", () => {
  const home = read("index.html");
  const site = read("assets/site.js");
  assert.match(home, /home-footer-top[\s\S]*wordmark-footer\.png/);
  assert.match(home, /class="home-wordmark"[\s\S]*wordmark-phone\.png/);
  assert.match(site, /footer-wordmark[\s\S]*wordmark-footer\.png/);
  assert.match(site, /class="wordmark"[\s\S]*wordmark-phone\.png/);
  assert.match(read("faqs.html"), /id="site-footer"/);
  assert.match(read("rules.html"), /id="site-footer"/);
});
