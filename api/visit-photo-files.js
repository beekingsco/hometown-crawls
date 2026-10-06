/**
 * Removes visit-photo bytes through the Supabase Storage API.
 *
 * GET  /api/visit-photo-files
 *   Vercel Cron, daily at 08:15 UTC (vercel.json). Vercel sends
 *   Authorization: Bearer <CRON_SECRET>. Set CRON_SECRET in the Vercel
 *   project. If it is missing or wrong, this returns 401 and deletes
 *   nothing. The job enqueues paths that are 90 days past crawls.ends_at
 *   (and abandoned uploads older than 2 days), releases queued publish
 *   slots (status only), then calls the Storage API for each pending row.
 *
 * POST /api/visit-photo-files
 *   Body: { "ids": ["<photo_file_deletions uuid>", ...] }
 *   Authorization: Bearer <user access token>
 *   Called right after a guest saves photo choices or a moderator hides,
 *   rejects, unpublishes, or deletes. The token is checked with the Auth
 *   API. The service role then claims only rows that person may flush.
 *
 * Failure: 401, 429, 5xx, and network errors call fail_photo_file_deletion.
 * That increments attempts, stores last_error, clears claimed_at, and
 * leaves deleted_at null. This route then returns 500 so the cron run is
 * visible as failed. The next day's cron, and any later POST of that id,
 * retries the same row. A pending row is never dropped.
 * HTTP 404, or HTTP 200 with an empty list, means the object is already
 * gone and the row is completed. A claim older than 10 minutes is claimed
 * again, so a crashed invocation is retried too.
 *
 * Env (already on the webhook): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * CRON_SECRET is additional and required for the cron. Do not put the
 * service role key in client code.
 */
const { classifyStorageDelete } = require("./lib/visit-photo-delete");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function adminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    const err = new Error("Storage deletion is not configured");
    err.status = 500;
    throw err;
  }
  const { createClient } = require("@supabase/supabase-js");
  return {
    url: url.replace(/\/$/, ""),
    key: key,
    client: createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  };
}

function readJson(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") return JSON.parse(req.body);
  return req.body;
}

async function deleteStorageObject(url, key, bucket, objectPath) {
  const endpoint = url + "/storage/v1/object/" + encodeURIComponent(bucket);
  let response;
  try {
    response = await fetch(endpoint, {
      method: "DELETE",
      headers: {
        Authorization: "Bearer " + key,
        apikey: key,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ prefixes: [objectPath] })
    });
  } catch (err) {
    return { status: 0, payload: { message: err.message || "network error" } };
  }
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (err) {
      payload = { message: text.slice(0, 300) };
    }
  }
  return { status: response.status, payload: payload };
}

async function processQueue(admin, ids, actor) {
  const closed = await admin.client.rpc("close_live_photo_file_deletions");
  if (closed.error) throw new Error(closed.error.message);

  let deleted = 0;
  let failed = 0;
  const errors = [];
  const claimedIds = [];
  const rounds = ids ? 1 : 25;

  for (let i = 0; i < rounds; i++) {
    const claim = await admin.client.rpc("claim_photo_file_deletions", {
      p_ids: ids,
      p_actor: actor,
      p_limit: 40
    });
    if (claim.error) throw new Error(claim.error.message);
    const rows = claim.data || [];
    if (!rows.length) break;

    for (const row of rows) {
      claimedIds.push(row.id);
      const result = await deleteStorageObject(admin.url, admin.key, row.bucket_id, row.object_path);
      const verdict = classifyStorageDelete(result.status, result.payload);
      if (verdict.complete) {
        const done = await admin.client.rpc("complete_photo_file_deletion", { p_id: row.id });
        if (done.error) {
          failed += 1;
          errors.push(done.error.message);
          await admin.client.rpc("fail_photo_file_deletion", {
            p_id: row.id,
            p_error: done.error.message
          });
        } else {
          deleted += 1;
        }
      } else {
        failed += 1;
        errors.push(verdict.error || "storage delete failed");
        const fail = await admin.client.rpc("fail_photo_file_deletion", {
          p_id: row.id,
          p_error: verdict.error || "storage delete failed"
        });
        if (fail.error) errors.push(fail.error.message);
      }
    }
  }

  return { deleted: deleted, failed: failed, errors: errors, claimedIds: claimedIds };
}

async function unauthorizedIds(admin, requested, claimedIds) {
  const missing = requested.filter(function (id) { return claimedIds.indexOf(id) === -1; });
  if (!missing.length) return [];
  const lookup = await admin.client
    .from("photo_file_deletions")
    .select("id, deleted_at")
    .in("id", missing);
  if (lookup.error) throw new Error(lookup.error.message);
  const byId = {};
  (lookup.data || []).forEach(function (row) { byId[row.id] = row; });
  return missing.filter(function (id) {
    const row = byId[id];
    return row && !row.deleted_at;
  });
}

async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const secret = process.env.CRON_SECRET || "";
      const header = req.headers.authorization || "";
      if (!secret || header !== "Bearer " + secret) {
        res.status(401).json({ error: "Not authorized" });
        return;
      }
      const admin = adminClient();
      const enqueued = await admin.client.rpc("enqueue_expired_visit_photo_files");
      if (enqueued.error) {
        res.status(500).json({ error: enqueued.error.message, deleted: 0, failed: 0 });
        return;
      }
      const released = await admin.client.rpc("release_all_queued_visit_photos");
      const result = await processQueue(admin, null, null);
      const releaseError = released.error ? released.error.message : null;
      const failed = result.failed > 0 || !!releaseError;
      res.status(failed ? 500 : 200).json({
        enqueued: enqueued.data,
        released: released.data,
        deleted: result.deleted,
        failed: result.failed,
        error: releaseError || (result.failed ? "One or more file deletes will be retried" : null),
        errors: result.errors.slice(0, 5)
      });
      return;
    }

    if (req.method === "POST") {
      const header = req.headers.authorization || "";
      const token = header.indexOf("Bearer ") === 0 ? header.slice(7).trim() : "";
      if (!token) {
        res.status(401).json({ error: "Not authorized" });
        return;
      }
      const body = readJson(req);
      const ids = Array.isArray(body.ids) ? body.ids.filter(function (id) { return UUID_RE.test(String(id || "")); }) : [];
      if (!ids.length) {
        res.status(400).json({ error: "No file ids" });
        return;
      }
      const admin = adminClient();
      const userResult = await admin.client.auth.getUser(token);
      const user = userResult.data && userResult.data.user;
      if (userResult.error || !user) {
        res.status(401).json({ error: "Not authorized" });
        return;
      }
      const result = await processQueue(admin, ids, user.id);
      const blocked = await unauthorizedIds(admin, ids, result.claimedIds);
      if (blocked.length) {
        res.status(403).json({
          error: "Not authorized",
          deleted: result.deleted,
          failed: result.failed
        });
        return;
      }
      res.status(result.failed ? 500 : 200).json({
        deleted: result.deleted,
        failed: result.failed,
        error: result.failed ? "File removal will be retried" : null,
        errors: result.errors.slice(0, 5)
      });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    res.status(err.status || 500).json({
      error: err.message || "File removal will be retried",
      deleted: 0,
      failed: 1
    });
  }
}

module.exports = handler;
