/**
 * Send shop-invite email for a crawl the caller owns or organizes.
 * Vercel Node serverless function. The browser posts JSON to /api/crawl-invites
 * with the signed-in user's access token.
 *
 * Server env only (never put these in assets/config.js or a page):
 *   RESEND_API_KEY      Required to send.
 *   SUPABASE_URL        Staging or the project this deploy should use.
 *   SUPABASE_ANON_KEY   Public anon key for that same project.
 *   HC_APP_URL          Optional origin for the join link. Preview uses
 *                       VERCEL_URL when this is unset.
 *
 * This function does not read SUPABASE_SERVICE_ROLE_KEY. Invite rows are
 * written by the signed-in user through security definer RPCs.
 */
const { createClient } = require("@supabase/supabase-js");

const FROM_ADDRESS = "Hometown Crawls <hello@hometowncrawls.com>";
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 8;
const CRAWL_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const hits = new Map();

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function appOrigin(raw) {
  const value = String(raw || "").trim().replace(/\/$/, "");
  if (/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(value)) return value;
  return "https://www.hometowncrawls.com";
}

function joinLink(origin, token) {
  return `${origin}/crawls/join?invite=${encodeURIComponent(token)}`;
}

function bearer(req) {
  const headers = (req && req.headers) || {};
  const raw = headers.authorization || headers.Authorization || "";
  const match = String(raw).match(/^Bearer\s+([A-Za-z0-9._~+/-]+=*)$/);
  return match ? match[1] : "";
}

function readBody(req) {
  const body = req && req.body;
  if (body && typeof body === "object" && !Buffer.isBuffer(body) && !Array.isArray(body)) return body;
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch (err) {
      return null;
    }
  }
  return null;
}

function clientIp(req) {
  const headers = (req && req.headers) || {};
  const forwarded = headers["x-forwarded-for"] || headers["X-Forwarded-For"] || "";
  const first = String(forwarded).split(",")[0].trim();
  if (first) return first.slice(0, 80);
  return "unknown";
}

function limited(store, key, now) {
  if (store.size > 500) store.clear();
  const recent = (store.get(key) || []).filter((stamp) => stamp > now - WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    store.set(key, recent);
    return true;
  }
  recent.push(now);
  store.set(key, recent);
  return false;
}

function money(cents) {
  const amount = Number.isFinite(Number(cents)) ? Number(cents) : 4999;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount / 100);
}

function inviteMail({ crawlName, city, price, link }) {
  const name = crawlName || "a hometown crawl";
  const where = city ? ` in ${city}` : "";
  const seat = price || "$49.99";
  const subject = `You've been invited to ${name}`;
  const text = [
    `You've been invited to a crawl.`,
    ``,
    `${name}${where} has a seat for your shop.`,
    `Each shop seat is ${seat}.`,
    ``,
    `Open your join link:`,
    link,
    ``,
    `The link is only for this invite. A shop shows on the crawl after the seat is paid and the crawl owner saves a map pin.`,
    `Stripe Checkout is not part of this step. Use the payment link on the join page when the organizer has added one.`,
  ].join("\n");
  const safeName = escapeHtml(name);
  const safeWhere = escapeHtml(where);
  const safeSeat = escapeHtml(seat);
  const safeLink = escapeHtml(link);
  const html = `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background:#f8f2e7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f2e7;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffaf1;border:1px solid #d8cbb8;border-radius:9px;">
          <tr>
            <td style="padding:28px 24px;font-family:Georgia,'Times New Roman',serif;color:#302119;">
              <p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#1f3a24;font-weight:700;">Hometown Crawls</p>
              <h1 style="margin:0 0 16px;font-size:28px;line-height:1.15;">You've been invited to a crawl.</h1>
              <p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;">${safeName}${safeWhere} has a seat for your shop. Each shop seat is <strong>${safeSeat}</strong>.</p>
              <p style="margin:0 0 18px;">
                <a href="${safeLink}" style="display:inline-block;background:#1f3a24;color:#fffdf8;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-weight:700;padding:12px 18px;border-radius:999px;">Open your join link</a>
              </p>
              <p style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;word-break:break-all;"><a href="${safeLink}" style="color:#1f3a24;">${safeLink}</a></p>
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#75685b;">A shop shows on the crawl after the seat is paid and the crawl owner saves a map pin. Use the payment link on the join page when the organizer has added one.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  return { subject, text, html };
}

function userClient(deps, jwt) {
  return createClient(deps.supabaseUrl, deps.anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function defaultGetUser(deps, jwt) {
  const supabase = createClient(deps.supabaseUrl, deps.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await supabase.auth.getUser(jwt);
  if (result.error || !result.data || !result.data.user) return null;
  return result.data.user;
}

async function defaultListInvites(deps, jwt, crawlId) {
  const result = await userClient(deps, jwt).rpc("organizer_list_shop_invites", { p_crawl: crawlId });
  return result;
}

async function defaultMarkInvites(deps, jwt, crawlId, results) {
  return userClient(deps, jwt).rpc("organizer_mark_shop_invites", {
    p_crawl: crawlId,
    p_results: results,
  });
}

async function sendOne(deps, { to, replyTo, mail, token }) {
  const fetchImpl = deps.fetch || fetch;
  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${deps.resendKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `hc-shop-invite-${token}`,
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [to],
      reply_to: replyTo,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    }),
  });
  return response.ok || response.status === 409;
}

async function handleRequest(req, deps) {
  if (!req || req.method !== "POST") {
    return { status: 405, body: { error: "method not allowed" } };
  }
  const body = readBody(req);
  const crawlId = body ? String(body.crawlId || body.crawl_id || "").trim() : "";
  if (!CRAWL_RE.test(crawlId)) {
    return { status: 400, body: { error: "Choose a crawl first." } };
  }

  const now = typeof deps.now === "function" ? deps.now() : Date.now();
  const store = deps.hits || hits;
  const jwt = bearer(req);
  if (!jwt) return { status: 401, body: { error: "Sign in again, then send the invites." } };
  if (limited(store, `${clientIp(req)}:${crawlId}`, now)) {
    return { status: 429, body: { error: "Please wait a few minutes and try again." } };
  }
  if (!deps.resendKey) {
    return { status: 503, body: { error: "Invite email is not set up yet. Add RESEND_API_KEY on this deploy." } };
  }
  if (!deps.supabaseUrl || !deps.anonKey) {
    return { status: 503, body: { error: "We couldn't send those invites just yet. Email hello@hometowncrawls.com and we'll help." } };
  }

  const getUser = deps.getUser || ((token) => defaultGetUser(deps, token));
  let user;
  try {
    user = await getUser(jwt);
  } catch (err) {
    console.error("[hc-invite] auth", err && err.message);
    return { status: 401, body: { error: "Sign in again, then send the invites." } };
  }
  if (!user || !user.id) return { status: 401, body: { error: "Sign in again, then send the invites." } };

  const listInvites = deps.listInvites || ((token, id) => defaultListInvites(deps, token, id));
  let listed;
  try {
    listed = await listInvites(jwt, crawlId);
  } catch (err) {
    console.error("[hc-invite] list", err && err.message);
    return { status: 502, body: { error: "Could not load the invite list." } };
  }
  if (listed && listed.error) {
    const message = listed.error.message || "Could not load the invite list.";
    const missing = /does not exist|could not find the function|PGRST202|42883/i.test(message);
    if (missing) {
      return { status: 503, body: { error: "Apply the organizer self-serve migration on this Supabase project first." } };
    }
    const denied = /not authenticated|only the crawl owner|42501/i.test(message);
    return { status: denied ? 403 : 400, body: { error: message } };
  }

  const rows = Array.isArray(listed && listed.data) ? listed.data : [];
  const pending = rows.filter((row) => row && (row.status === "pending" || row.status === "failed") && row.token && row.email);
  if (!pending.length) {
    return { status: 200, body: { ok: true, sent: 0, failed: 0, message: "No unsent invites." } };
  }

  const origin = appOrigin(deps.appUrl);
  const replyTo = user.email || "hello@hometowncrawls.com";
  const sample = pending[0];
  const price = money(sample.price_cents);
  const results = [];
  for (const row of pending) {
    const link = joinLink(origin, row.token);
    const mail = inviteMail({
      crawlName: row.crawl_name || sample.crawl_name,
      city: row.city || sample.city,
      price,
      link,
    });
    let ok = false;
    try {
      ok = await sendOne(deps, { to: row.email, replyTo, mail, token: row.token });
    } catch (err) {
      console.error("[hc-invite] send", err && err.message);
      ok = false;
    }
    results.push({ email: row.email, status: ok ? "sent" : "failed" });
  }

  const markInvites = deps.markInvites || ((token, id, marked) => defaultMarkInvites(deps, token, id, marked));
  try {
    const marked = await markInvites(jwt, crawlId, results);
    if (marked && marked.error) {
      console.error("[hc-invite] mark", marked.error.message);
    }
  } catch (err) {
    console.error("[hc-invite] mark", err && err.message);
  }

  const sent = results.filter((row) => row.status === "sent").length;
  return {
    status: sent ? 200 : 502,
    body: {
      ok: sent > 0,
      sent,
      failed: results.length - sent,
      error: sent ? undefined : "We couldn't send those invites.",
    },
  };
}

function envDeps() {
  return {
    resendKey: process.env.RESEND_API_KEY || "",
    supabaseUrl: process.env.SUPABASE_URL || "",
    anonKey: process.env.SUPABASE_ANON_KEY || "",
    appUrl: process.env.HC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : ""),
    fetch,
    now: () => Date.now(),
    hits,
  };
}

async function handler(req, res) {
  const result = await handleRequest(req, envDeps());
  const body = Object.assign({}, result.body);
  if (body.error === undefined) delete body.error;
  res.status(result.status).json(body);
}

module.exports = handler;
module.exports.handleRequest = handleRequest;
module.exports._test = {
  escapeHtml,
  appOrigin,
  joinLink,
  inviteMail,
  bearer,
  CRAWL_RE,
  FROM_ADDRESS,
};
