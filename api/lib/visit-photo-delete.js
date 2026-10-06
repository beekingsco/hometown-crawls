/**
 * Decides whether a Storage API delete is finished.
 * 404, or 200/204 with an empty list, means the bytes are already gone.
 * A 200/204 list of objects means this call removed them.
 * 401, 429, 5xx, and anything else stay queued for a retry.
 * A 400 whose message says the object was not found is treated as already
 * gone, because the Storage API uses that for a missing object.
 */
function messageOf(payload) {
  if (!payload) return "";
  if (typeof payload === "string") return payload;
  return String(payload.message || payload.error || "");
}

function notFound(status, payload) {
  if (status === 404) return true;
  return (status === 400 || status === 404) && /not found|does not exist/i.test(messageOf(payload));
}

function classifyStorageDelete(status, payload) {
  if (notFound(status, payload)) {
    return { complete: true, alreadyGone: true };
  }

  if (status === 200 || status === 204) {
    if (payload && !Array.isArray(payload) && (payload.error || payload.statusCode)) {
      const code = Number(payload.statusCode || payload.status || 0);
      const message = messageOf(payload);
      if (code === 404 || /not found|does not exist/i.test(message)) {
        return { complete: true, alreadyGone: true };
      }
      return { complete: false, retry: true, error: message || "storage delete failed" };
    }
    if (Array.isArray(payload)) {
      const bad = payload.find(function (item) {
        return item && (item.error || Number(item.statusCode || 0) >= 400);
      });
      if (bad) {
        return { complete: false, retry: true, error: messageOf(bad) || "storage delete failed" };
      }
    }
    const gone = payload == null || (Array.isArray(payload) && payload.length === 0);
    return { complete: true, alreadyGone: gone };
  }

  return {
    complete: false,
    retry: true,
    error: messageOf(payload) || "storage delete failed (" + status + ")"
  };
}

module.exports = { classifyStorageDelete };
