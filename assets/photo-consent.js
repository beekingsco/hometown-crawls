/* DRAFT — owner and Chris sign-off.
   Every selfie consent and privacy sentence lives in this file.
   Do not copy these strings into pages. Render them from here.

   Coffee age tick: "I'm 18 or older".
   Pub age tick: "I'm 21 or older".
   The public opt-in is unchecked by default and never grants or blocks a stamp.
   Social opt-in is stored only. Nothing posts it.
*/
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.HCPhotoConsent = api;
})(typeof window !== "undefined" ? window : this, function () {
  var DRAFT = "DRAFT — owner sign-off";

  function shopName(name) {
    var shop = String(name || "").trim();
    return shop || "the shop";
  }

  // Coffee public opt-in. Owner draft. Unchecked by default.
  function publicOptIn(name) {
    return "OK to show this photo on the Hometown Crawls site and " + shopName(name) + "'s page? You can remove it anytime from your passport.";
  }

  // Pub public opt-in. Chris's label. Same checkbox: unchecked, does not affect the stamp.
  var publicOptInPub = "OK to show this photo on our site?";

  // Alternate pub sentence if Chris wants the shop name. Not shown unless wired up.
  function publicOptInPubLong(name) {
    return publicOptIn(name);
  }

  function socialOptIn(name) {
    return "OK for Hometown Crawls and " + shopName(name) + " to repost this photo on Instagram/Facebook.";
  }

  var age18 = "I'm 18 or older";
  var age21 = "I'm 21 or older";

  var cameraLine = "Your selfie confirms your visit. Hometown Crawls staff can see it; it's only public if you check the box.";
  var cameraHelp = "Ask the barista for help / enable camera";

  // Pub-only sentences for Chris.
  var pubCameraLine = "Your selfie confirms your visit. Hometown Crawls staff can see it. It is public only if you opt in and confirm you are 21 or older.";
  var pubCameraHelp = "Ask the bartender for help / enable camera";
  var pubJoinNotice = "This pub crawl is 21+. You must be 21 or older to join and to check in.";
  var pubCheckinNotice = "Pub check-in is 21+. Confirm you're 21 or older before your photo can be shown publicly. The stamp does not depend on that box.";
  var ageNeededNote = "This photo stays with Hometown Crawls staff until you also confirm your age. Your stamp still counts.";

  function ageLabel(minAge) {
    return Number(minAge) >= 21 ? age21 : age18;
  }

  function isPub(crawlType, minAge) {
    return String(crawlType || "") === "pub" || Number(minAge) >= 21;
  }

  function privacyHtml() {
    return (
      '<p class="eyebrow">' + DRAFT + "</p>" +
      "<h3>Visit photos</h3>" +
      "<p>A live selfie confirms that you visited the shop. Hometown Crawls staff can see that photo. It is not shown to the shop or to the crawl organizer unless you opt in, confirm your age, and the photo is approved.</p>" +
      "<ul>" +
      "<li>Coffee crawls ask you to confirm you are 18 or older before a photo can be public.</li>" +
      "<li>Pub crawls ask you to confirm you are 21 or older. Without that tick, a pub photo is not eligible for the public site.</li>" +
      "<li>The public opt-in box starts unchecked. Leaving it unchecked does not affect your stamp. The photo stays with you and Hometown Crawls staff.</li>" +
      "<li>Coffee photos that are opted in and 18+ are approved by a person or business organizer. If the only organizer is a chamber, Hometown Crawls staff approve them.</li>" +
      "<li>Every pub photo is approved by Hometown Crawls staff. Organizers and shops do not review pub photos. Nothing is published automatically.</li>" +
      "<li>You can change your mind or remove a photo from your passport. Taking it off the site is immediate.</li>" +
      "<li>Selfies are deleted 90 days after the crawl ends, unless the photo is still approved, still opted in, and still meets the age bar.</li>" +
      "<li>A separate box covers Instagram or Facebook reposts by Hometown Crawls and the shop. That choice is stored only. Checking it does not post the photo.</li>" +
      "</ul>"
    );
  }

  return {
    DRAFT: DRAFT,
    publicOptIn: publicOptIn,
    publicOptInPub: publicOptInPub,
    publicOptInPubLong: publicOptInPubLong,
    socialOptIn: socialOptIn,
    age18: age18,
    age21: age21,
    ageLabel: ageLabel,
    isPub: isPub,
    cameraLine: cameraLine,
    cameraHelp: cameraHelp,
    pubCameraLine: pubCameraLine,
    pubCameraHelp: pubCameraHelp,
    pubJoinNotice: pubJoinNotice,
    pubCheckinNotice: pubCheckinNotice,
    ageNeededNote: ageNeededNote,
    privacyHtml: privacyHtml
  };
});
