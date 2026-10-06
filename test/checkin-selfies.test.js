const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const image = require("../assets/checkin-image.js");
const consent = require("../assets/photo-consent.js");
const { classifyStorageDelete } = require("../api/lib/visit-photo-delete.js");
const visitPhotoFiles = require("../api/visit-photo-files.js");

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

test("coffee consent strings are the live check-in copy", () => {
  assert.equal(consent.age18, "I'm 18 or older");
  assert.equal(consent.ageLabel(18), consent.age18);
  assert.equal(
    consent.publicOptIn("Anthem Coffee"),
    "OK to show this photo on the Hometown Crawls site and Anthem Coffee's page? You can remove it anytime from your passport."
  );
  assert.equal(
    consent.socialOptIn("Anthem Coffee"),
    "OK for Hometown Crawls and Anthem Coffee to repost this photo on Instagram/Facebook."
  );
  assert.equal(
    consent.cameraLine,
    "Your selfie confirms your visit. Hometown Crawls staff can see it; it's only public if you check the box."
  );
  assert.equal(consent.cameraHelp, "Ask the barista for help / enable camera");
  assert.equal(
    consent.coffeeCheckinNotice,
    "The 18+ tick is only for showing this photo publicly. Your stamp does not depend on that box or the public opt-in."
  );
  assert.equal(
    consent.ageNeededNote,
    "This photo stays with Hometown Crawls staff until you also confirm your age. Your stamp still counts."
  );
  assert.equal(consent.isPub("coffee", 18), false);
  const privacy = consent.privacyHtml();
  assert.match(privacy, /DRAFT/);
  assert.match(privacy, /18 or older/);
  assert.equal(privacy.includes(consent.coffeeCheckinNotice), true);
});

test("pub consent strings stay separate from the coffee copy", () => {
  assert.equal(consent.age21, "I'm 21 or older");
  assert.equal(consent.ageLabel(21), consent.age21);
  assert.equal(consent.publicOptInPub, "OK to show this photo on our site?");
  assert.equal(
    consent.publicOptInPubLong("The Club"),
    "OK to show this photo on the Hometown Crawls site and The Club's page? You can remove it anytime from your passport."
  );
  assert.equal(
    consent.pubCameraLine,
    "Your selfie confirms your visit. Hometown Crawls staff can see it. It is public only if you opt in and confirm you are 21 or older."
  );
  assert.equal(consent.pubCameraHelp, "Ask the bartender for help / enable camera");
  assert.equal(consent.pubJoinNotice, "This pub crawl is 21+. You must be 21 or older to join and to check in.");
  assert.equal(
    consent.pubCheckinNotice,
    "Pub check-in is 21+. Confirm you're 21 or older before your photo can be shown publicly. The stamp does not depend on that box."
  );
  assert.equal(consent.isPub("pub", 18), true);
  assert.match(consent.privacyHtml(), /21 or older/);
  assert.match(consent.privacyHtml(), /90 days/);
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
    "assets/visit-photo-files-client.js",
    "api/visit-photo-files.js",
    "api/lib/visit-photo-delete.js",
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
  assert.doesNotMatch(migration, /delete from storage\.objects/i);
  assert.match(migration, /photo_file_deletions/);
  assert.match(migration, /enqueue_photo_file_deletion/);
  assert.doesNotMatch(migration, /create policy checkin_display_select/);
  assert.match(body(migration, "public.enqueue_expired_visit_photo_files"), /enqueue_photo_file_deletion/);
  assert.match(body(migration, "public.purge_expired_checkin_selfies"), /enqueue_expired_visit_photo_files/);
  assert.doesNotMatch(body(migration, "public.purge_expired_checkin_selfies"), /delete from storage/i);
  const selfieRead = body(migration, "private.can_read_checkin_selfie");
  assert.match(selfieRead, /can_moderate_visit_photos/);
  assert.doesNotMatch(selfieRead, /owns_business/);
  assert.match(body(migration, "public.visit_photo_access"), /v_kind = 'chamber'/);
  assert.match(body(migration, "public.visit_photo_access"), /'allowed', false/);
  assert.doesNotMatch(body(migration, "public.shop_visit_photos"), /selfie_path/);
  const moderatePhoto = body(migration, "public.moderate_visit_photo");
  assert.match(moderatePhoto, /moderation_delete/);
  assert.match(moderatePhoto, /file_deletions/);
  assert.match(body(migration, "public.claim_photo_file_deletions"), /service_role/);
  assert.match(body(migration, "public.fail_photo_file_deletion"), /claimed_at = null/);
  assert.doesNotMatch(body(migration, "public.fail_photo_file_deletion"), /deleted_at = now/);
});

test("migration 2 closes claim_stamp without inserting a stamp", () => {
  assert.match(closeStamp, /function public\.claim_stamp\(/);
  assert.match(closeStamp, /A selfie is required/);
  assert.match(closeStamp, /Not authenticated/);
  assert.doesNotMatch(closeStamp, /insert into public\.stamps/i);
  assert.match(closeStamp, /search_path to 'public'/);
});

test("coffee check-in shows the 18+ notice and does not require either box for the stamp", () => {
  const checkin = fs.readFileSync(path.join(root, "assets/checkin.js"), "utf8");
  assert.match(checkin, /coffeeCheckinNotice/);
  assert.match(checkin, /notice\.hidden = false/);
  assert.match(checkin, /hc-opt-public"\)\.checked = false/);
  assert.match(checkin, /hc-opt-age"\)\.checked = false/);
  assert.doesNotMatch(checkin, /hc-opt-public"[^"]*required/);
  assert.doesNotMatch(checkin, /hc-opt-age"[^"]*required/);
  const complete = body(migration, "public.complete_checkin");
  assert.match(complete, /The age tick does not grant the stamp/);
  assert.match(complete, /insert into public\.stamps/);
  assert.match(complete, /v_public and v_age/);
});

test("organizer.html no longer falls back to payout notes", () => {
  const page = fs.readFileSync(path.join(root, "organizer.html"), "utf8");
  assert.equal(page.includes("payout"), false);
  assert.match(page, /const notes = a\.notes \|\| "";/);
});

test("storage delete results either finish the row or leave it for a retry", () => {
  assert.deepEqual(classifyStorageDelete(404, { message: "Object not found" }), {
    complete: true,
    alreadyGone: true
  });
  assert.deepEqual(classifyStorageDelete(200, []), {
    complete: true,
    alreadyGone: true
  });
  assert.deepEqual(classifyStorageDelete(200, [{ name: "a.jpg" }]), {
    complete: true,
    alreadyGone: false
  });
  assert.equal(classifyStorageDelete(500, { message: "unavailable" }).complete, false);
  assert.equal(classifyStorageDelete(500, { message: "unavailable" }).retry, true);
  assert.equal(classifyStorageDelete(401, { message: "unauthorized" }).complete, false);
  assert.equal(classifyStorageDelete(429, { message: "slow down" }).complete, false);
  assert.equal(classifyStorageDelete(0, { message: "network error" }).complete, false);
  assert.equal(classifyStorageDelete(400, { message: "Object not found" }).complete, true);
  assert.equal(classifyStorageDelete(200, [{ error: "busy" }]).complete, false);
  assert.equal(classifyStorageDelete(200, [{ error: "busy" }]).retry, true);
});

test("the file route refuses a cron call when CRON_SECRET is missing", async () => {
  const previous = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  const res = {
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
  await visitPhotoFiles({ method: "GET", headers: { authorization: "Bearer secret" } }, res);
  assert.equal(res.statusCode, 401);
  if (previous === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previous;
});

test("vercel cron is the daily byte-deletion schedule", () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  assert.deepEqual(vercel.crons, [{ path: "/api/visit-photo-files", schedule: "15 8 * * *" }]);
  assert.match(fs.readFileSync(path.join(root, "api/visit-photo-files.js"), "utf8"), /CRON_SECRET/);
  assert.match(fs.readFileSync(path.join(root, "api/visit-photo-files.js"), "utf8"), /fail_photo_file_deletion/);
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
