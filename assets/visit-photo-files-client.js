/* Asks /api/visit-photo-files to delete queued selfie bytes.
   The SQL row is already marked. If this call fails, the daily cron retries
   the same photo_file_deletions id. A failed call must not be treated as done.
*/
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.HCVisitPhotoFiles = api;
})(typeof window !== "undefined" ? window : this, function () {
  function idsFrom(result) {
    var raw = result && result.file_deletions;
    if (!Array.isArray(raw)) return [];
    return raw.filter(Boolean);
  }

  async function flush(sb, ids) {
    var list = (ids || []).filter(Boolean);
    if (!list.length) return { ok: true, deleted: 0, failed: 0 };
    var session = await sb.auth.getSession();
    var token = session && session.data && session.data.session && session.data.session.access_token;
    if (!token) {
      return { ok: false, failed: list.length, error: "The photo is off the site. File removal will be retried." };
    }
    var response;
    try {
      response = await fetch("/api/visit-photo-files", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token
        },
        body: JSON.stringify({ ids: list })
      });
    } catch (err) {
      return { ok: false, failed: list.length, error: "The photo is off the site. File removal will be retried." };
    }
    var body = {};
    try { body = await response.json(); } catch (e) { body = {}; }
    if (!response.ok) {
      return {
        ok: false,
        failed: body.failed || list.length,
        deleted: body.deleted || 0,
        error: "The photo is off the site. File removal will be retried."
      };
    }
    return { ok: true, deleted: body.deleted || 0, failed: body.failed || 0 };
  }

  return { idsFrom: idsFrom, flush: flush };
});
