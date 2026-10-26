/**
 * Public support form for Hometown Crawls.
 * Vercel Node serverless function. The browser posts JSON to /api/support.
 *
 * Server env only (never put these in assets/config.js or a page):
 *   RESEND_API_KEY     Required. Same key the shop receipt uses.
 *   SUPPORT_TO_EMAIL   Optional. Inbox that receives the note.
 *                      Falls back to hello@hometowncrawls.com when unset.
 *
 * From address is the verified sender already used for shop mail:
 *   Hometown Crawls <hello@hometowncrawls.com>
 * Reply-To is the address the person typed, so a reply reaches them.
 */
const FROM_ADDRESS = "Hometown Crawls <hello@hometowncrawls.com>";
const DEFAULT_TO = "hello@hometowncrawls.com";
const ROLES = ["Guest", "Shop host", "Organizer", "Other"];
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const MIN_FILL_MS = 1000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PREVIEW_LEN = 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const hits = new Map();

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function destination(raw) {
  const value = String(raw || "").trim();
  if (value && EMAIL_RE.test(value) && value.length <= 320) return value;
  return DEFAULT_TO;
}

function subjectLine(role, message) {
  const flat = String(message || "").replace(/\s+/g, " ").trim();
  const short = flat.length > PREVIEW_LEN ? `${flat.slice(0, PREVIEW_LEN - 1).trimEnd()}…` : flat;
  return `[Hometown Crawls Support] ${role} — ${short}`;
}

function clientIp(req) {
  const headers = (req && req.headers) || {};
  const forwarded = headers["x-forwarded-for"] || headers["X-Forwarded-For"] || "";
  const first = String(forwarded).split(",")[0].trim();
  if (first) return first.slice(0, 80);
  const socketIp = req && req.socket && req.socket.remoteAddress;
  return socketIp ? String(socketIp).slice(0, 80) : "unknown";
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

function cleanLine(value, max) {
  return String(value == null ? "" : value).replace(/[\r\n]+/g, " ").trim().slice(0, max);
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

function validate(body, now) {
  if (!body || typeof body !== "object") return { error: "Send a note with your name, email, and what happened." };
  if (String(body.company || "").trim()) return { honeypot: true };

  const name = cleanLine(body.name, 80);
  const email = cleanLine(body.email, 320).toLowerCase();
  const role = cleanLine(body.role, 40);
  const crawl = cleanLine(body.crawl, 120);
  const shop = cleanLine(body.shop, 120);
  const message = String(body.message == null ? "" : body.message).trim().slice(0, 4000);
  const started = Number(body.started);

  if (!name) return { error: "Add your name." };
  if (!EMAIL_RE.test(email)) return { error: "Add an email we can reply to." };
  if (!ROLES.includes(role)) return { error: "Choose Guest, Shop host, Organizer, or Other." };
  if (message.length < 2) return { error: "Tell us what you need help with." };
  if (!Number.isFinite(started) || started > now + 15000 || now - started < MIN_FILL_MS || now - started > MAX_AGE_MS) {
    return { error: "Take a moment and send it again." };
  }

  return { value: { name, email, role, crawl, shop, message } };
}

function textBody(fields) {
  return [
    "Hometown Crawls support",
    "",
    `Role: ${fields.role}`,
    `Name: ${fields.name}`,
    `Email: ${fields.email}`,
    `Shop: ${fields.shop || "(not specified)"}`,
    `Crawl: ${fields.crawl || "(not specified)"}`,
    "",
    fields.message,
  ].join("\n");
}

function htmlBody(fields) {
  const row = (label, value) =>
    `<p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#302119;"><strong>${label}:</strong> ${escapeHtml(value)}</p>`;
  return `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background:#f8f2e7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f2e7;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffaf1;border:1px solid #d8cbb8;border-radius:9px;">
          <tr>
            <td style="padding:28px 24px;font-family:Georgia,'Times New Roman',serif;color:#302119;">
              <p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#75685b;font-weight:700;">Hometown Crawls</p>
              <h1 style="margin:0 0 16px;font-size:28px;line-height:1.15;">Support note</h1>
              ${row("Role", fields.role)}
              ${row("Name", fields.name)}
              ${row("Email", fields.email)}
              ${row("Shop", fields.shop || "(not specified)")}
              ${row("Crawl", fields.crawl || "(not specified)")}
              <div style="margin-top:16px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(fields.message)}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function handleRequest(req, deps) {
  if (!req || req.method !== "POST") {
    return { status: 405, body: { error: "method not allowed" } };
  }

  const body = readBody(req);
  if (!body) return { status: 400, body: { error: "Send a note with your name, email, and what happened." } };

  const now = typeof deps.now === "function" ? deps.now() : Date.now();
  const store = deps.hits || hits;
  if (limited(store, clientIp(req), now)) {
    return { status: 429, body: { error: "Please wait a few minutes and try again." } };
  }

  const parsed = validate(body, now);
  if (parsed.honeypot) return { status: 200, body: { ok: true } };
  if (parsed.error) return { status: 400, body: { error: parsed.error } };

  if (!deps.resendKey) {
    return {
      status: 503,
      body: { error: "Support email is not set up yet. Email hello@hometowncrawls.com and we will help." },
    };
  }

  const fields = parsed.value;
  const to = destination(deps.to);
  const fetchImpl = deps.fetch || fetch;
  let response;
  try {
    response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${deps.resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [to],
        reply_to: fields.email,
        subject: subjectLine(fields.role, fields.message),
        html: htmlBody(fields),
        text: textBody(fields),
      }),
    });
  } catch (err) {
    console.error("[hc-support] send", err && err.message);
    return { status: 502, body: { error: "We couldn't send that. Email hello@hometowncrawls.com and we will help." } };
  }

  if (!response.ok) {
    console.error("[hc-support] resend", response.status);
    return { status: 502, body: { error: "We couldn't send that. Email hello@hometowncrawls.com and we will help." } };
  }

  return { status: 200, body: { ok: true } };
}

function envDeps() {
  return {
    resendKey: process.env.RESEND_API_KEY || "",
    to: process.env.SUPPORT_TO_EMAIL || "",
    fetch,
    now: () => Date.now(),
    hits,
  };
}

async function handler(req, res) {
  const result = await handleRequest(req, envDeps());
  res.status(result.status).json(result.body);
}

module.exports = handler;
module.exports.handleRequest = handleRequest;
module.exports._test = {
  subjectLine,
  escapeHtml,
  destination,
  DEFAULT_TO,
  FROM_ADDRESS,
  validate,
};
