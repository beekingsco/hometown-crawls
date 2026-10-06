const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const image = require("../assets/checkin-image.js");
const consent = require("../assets/photo-consent.js");

const root = path.join(__dirname, "..");
const migration = fs.readFileSync(path.join(root, "migrations/20261006140000_checkin_selfies.sql"), "utf8");
const closeStamp = fs.readFileSync(path.join(root, "migrations/20261006141000_close_claim_stamp_without_selfie.sql"), "utf8");

function body(sql, name) {
  const start = sql.indexOf("function " + name);
  assert.notEqual(start, -1, name);
  const next = sql.indexOf("create or replace function", start + 10);
  return sql.slice(start, next === -1 ? sql.length : next);
}

test("fitSize keeps the long edge at 1080 and does not upscale", () => {
  assert.deepEqual(image.fitSize(2000, 1000), { width: 1080, height: 540 });
  assert.deepEqual(image.fitSize(400, 200), { width: 400, height: 200 });
  assert.deepEqual(image.fitSize(0, 0), { width: image.LONG_EDGE, height: image.LONG_EDGE });
  assert.equal(image.JPEG_QUALITY, 0.82);
});

test("consent strings keep coffee at 18 and pub at 21, both opt-ins unchecked by design", () => {
  assert.equal(consent.age18, "I'm 18 or older");
  assert.equal(consent.age21, "I'm 21 or older");
  assert.equal(consent.ageLabel(18), consent.age18);
  assert.equal(consent.ageLabel(21), consent.age21);
  assert.equal(consent.publicOptInPub, "OK to show this photo on our site?");
  assert.match(consent.publicOptIn("Anthem Coffee"), /Anthem Coffee's page/);
  assert.match(consent.publicOptInPubLong("The Club"), /The Club's page/);
  assert.match(consent.socialOptIn("The Club"), /Instagram\/Facebook/);
  assert.match(consent.pubJoinNotice, /21\+/);
  assert.match(consent.pubCheckinNotice, /21 or older/);
  assert.match(consent.cameraLine, /only public if you check the box/);
  assert.match(consent.pubCameraLine, /21 or older/);
  const privacy = consent.privacyHtml();
  assert.match(privacy, /DRAFT/);
  assert.match(privacy, /21 or older/);
  assert.match(privacy, /18 or older/);
  assert.match(privacy, /90 days/);
  assert.match(privacy, /Hometown Crawls staff/);
  assert.equal(consent.isPub("pub", 18), true);
  assert.equal(consent.isPub("coffee", 18), false);
});

test("new selfie copy does not mention revenue share", () => {
  const files = [
    "assets/photo-consent.js",
    "assets/checkin.js",
    "assets/checkin-image.js",
    "assets/visit-gallery.js",
    "assets/visit-moderate.js",
    "assets/shop-visitors.js",
    "assets/passport-photos.js",
    "migrations/20261006140000_checkin_selfies.sql",
    "migrations/20261006141000_close_claim_stamp_without_selfie.sql"
  ];
  const banned = /50\/50|revenue share|stripe connect|organizer_share|keep half|earn half|payout/i;
  files.forEach((file) => {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    assert.equal(banned.test(text), false, file);
  });
});

test("migration 1 leaves claim_stamp in place and copies the stamp rules", () => {
  assert.doesNotMatch(migration, /function public\.claim_stamp\s*\(/);
  const validate = body(migration, "private.validate_checkin");
  assert.match(validate, /150/);
  assert.match(validate, /You need to be at the shop/);
  assert.match(validate, /Already stamped/);
  assert.doesNotMatch(validate, /interval/);
  assert.match(migration, /kind text not null default 'person'/);
  assert.match(migration, /'chamber'::text, 'person'::text, 'business'::text/);
});

test("pub photos are staff-only, 21+, capped, and unlisted", () => {
  assert.match(migration, /lower\(btrim\(coalesce\(c\.type, ''\)\)\) = 'pub'/);
  assert.match(body(migration, "private.crawl_min_age"), /then 21 else 18/);
  const moderate = body(migration, "private.can_moderate_visit_photos");
  assert.match(moderate, /not private\.crawl_is_pub/);
  assert.match(moderate, /co\.kind in \('person', 'business'\)/);
  assert.match(moderate, /private\.is_hc_staff\(\)/);
  const read = body(migration, "private.can_read_checkin_selfie");
  assert.match(read, /not private\.crawl_is_pub/);
  assert.match(read, /private\.is_hc_staff\(\)/);
  assert.match(body(migration, "public.shop_visit_photos"), /not private\.crawl_is_pub/);
  assert.match(body(migration, "public.shop_set_photo_hidden"), /crawl_is_pub/);
  assert.match(migration, /photo_publish_per_hour = 6/);
  assert.match(migration, /list_visit_photos = lower\(btrim\(coalesce\(type, ''\)\)\) is distinct from 'pub'/);
  assert.match(migration, /'queued'::text/);
  const release = body(migration, "private.release_queued_visit_photos");
  assert.match(release, /if not coalesce\(v_listed, false\) then/);
  assert.match(release, /order by s\.decided_at nulls last, s\.claimed_at/);
  const place = body(migration, "private.place_approved_visit_photo");
  assert.match(place, /v_status := 'queued'/);
  assert.match(place, /v_status := 'approved'/);
  const complete = body(migration, "public.complete_checkin");
  assert.match(complete, /v_status := 'pending'/);
  assert.match(complete, /v_status := 'staff_only'/);
  assert.doesNotMatch(complete, /approved/);
  const pubRead = body(migration, "public.public_visit_photos");
  assert.match(pubRead, /c\.list_visit_photos/);
  assert.match(pubRead, /visit_photo_eligible/);
  assert.match(pubRead, /moderation_status = 'approved'/);
  assert.match(migration, /interval '90 days'/);
  assert.match(migration, /'checkin-selfies', 'checkin-selfies', false/);
  assert.match(migration, /'checkin-display', 'checkin-display', true/);
  assert.match(migration, /release-queued-visit-photos/);
  assert.match(migration, /staff_set_photo_publish_cap/);
  assert.match(migration, /staff_set_visit_photos_listed/);
});

test("migration 2 closes claim_stamp without inserting a stamp", () => {
  assert.match(closeStamp, /function public\.claim_stamp\(/);
  assert.match(closeStamp, /A selfie is required/);
  assert.match(closeStamp, /Not authenticated/);
  assert.doesNotMatch(closeStamp, /insert into public\.stamps/i);
  assert.match(closeStamp, /search_path to 'public'/);
});

test("the front end never calls claim_stamp and does not publish a pub gallery", () => {
  const crawl = fs.readFileSync(path.join(root, "assets/crawl.js"), "utf8");
  assert.match(crawl, /HCCheckin\.claimWithSelfie/);
  assert.doesNotMatch(crawl, /rpc\(\s*["']claim_stamp["']/);
  const pub = fs.readFileSync(path.join(root, "puyallupwa/pub/index.html"), "utf8");
  assert.match(pub, /photo-consent\.js/);
  assert.match(pub, /pub-checkin-note/);
  assert.doesNotMatch(pub, /visit-gallery\.js/);
  assert.doesNotMatch(pub, /data-visit-wall/);
  const coffee = fs.readFileSync(path.join(root, "puyallupwa/coffee/index.html"), "utf8");
  assert.match(coffee, /visit-gallery\.js/);
  assert.match(coffee, /data-visit-wall/);
});
