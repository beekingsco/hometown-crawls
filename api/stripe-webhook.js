/**
 * Stripe webhook for Hometown Crawls shop payments.
 * Vercel Node serverless function (no framework). Body parsing is disabled so
 * the Stripe signature is verified against the raw request body.
 *
 * Server env only: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, optional HC_PAYMENT_LINK_IDS.
 */
const { createClient } = require("@supabase/supabase-js");
const Stripe = require("stripe");

const HANDLED_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SHOP_PORTAL_URL = "https://www.hometowncrawls.com/puyallup/coffee-crawl/shop";
const MAP_URL = "https://www.hometowncrawls.com/puyallup/holiday-coffee-crawl";
const FROM_ADDRESS = "Hometown Crawls <hello@hometowncrawls.com>";

const LISTING_COLUMNS = "id,is_paid,paid_at,stripe_session_id,amount_paid_cents,payment_source";

const config = {
  api: {
    bodyParser: false,
  },
};

function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

function canonicalUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hash = "";
    url.search = "";
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.protocol}//${url.host}${path}`.toLowerCase();
  } catch (err) {
    return raw.split("?")[0].replace(/\/+$/, "").toLowerCase();
  }
}

function urlSlug(value) {
  const canon = canonicalUrl(value);
  if (!canon) return "";
  try {
    const parts = new URL(canon).pathname.split("/").filter(Boolean);
    return (parts[parts.length - 1] || "").toLowerCase();
  } catch (err) {
    const parts = canon.split("/").filter(Boolean);
    return (parts[parts.length - 1] || "").toLowerCase();
  }
}

function parseAllowlist(raw) {
  return String(raw || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function paymentLinkMatches({ linkId, linkUrl, crawlPaymentLinks, allowlist }) {
  const allowed = Array.isArray(allowlist) ? allowlist : parseAllowlist(allowlist);
  if (linkId && allowed.some((item) => item === linkId)) return true;

  const linkCanon = canonicalUrl(linkUrl);
  const linkSlug = urlSlug(linkUrl);
  const candidates = []
    .concat(crawlPaymentLinks || [])
    .concat(allowed);

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (linkId && candidate === linkId) return true;
    const canon = canonicalUrl(candidate);
    if (linkCanon && canon && linkCanon === canon) return true;
    const slug = urlSlug(candidate);
    if (linkSlug && slug && linkSlug === slug && linkSlug.length >= 8) return true;
  }
  return false;
}

const ZERO_DECIMAL = new Set([
  "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga",
  "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
]);

function formatAmount(amountTotal, currency) {
  const cur = String(currency || "usd").toLowerCase();
  const amount = ZERO_DECIMAL.has(cur) ? Number(amountTotal) : Number(amountTotal) / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: cur.toUpperCase(),
  }).format(amount);
}

function formatCrawlDates(startsAt, endsAt) {
  if (!startsAt || !endsAt) return "Nov 1 – Dec 31, 2026";
  const tz = "America/Los_Angeles";
  function parts(iso) {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const map = {};
    fmt.formatToParts(new Date(iso)).forEach((part) => {
      map[part.type] = part.value;
    });
    return map;
  }
  const start = parts(startsAt);
  const end = parts(endsAt);
  if (start.year === end.year) {
    return `${start.month} ${start.day} – ${end.month} ${end.day}, ${start.year}`;
  }
  return `${start.month} ${start.day}, ${start.year} – ${end.month} ${end.day}, ${end.year}`;
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildEmail({ crawlName, dates, amount, businessName }) {
  const name = crawlName || "Puyallup Holiday Coffee Crawl";
  const shop = businessName ? ` for ${escapeHtml(businessName)}` : "";
  const safeName = escapeHtml(name);
  const safeDates = escapeHtml(dates);
  const safeAmount = escapeHtml(amount);
  const subject = `You're in: ${name}`;
  const text = [
    `You're in${businessName ? ` — ${businessName}` : ""}.`,
    ``,
    `Thanks for joining ${name}. We received your payment of ${amount}.`,
    `The crawl runs ${dates}.`,
    ``,
    `Next step: sign in to the shop portal and add a photo and your shop details:`,
    SHOP_PORTAL_URL,
    ``,
    `Your shop will appear on the map at ${MAP_URL}.`,
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background:#f4efe6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4efe6;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffdf8;border:1px solid #e4dccb;border-radius:16px;">
          <tr>
            <td style="padding:32px 28px;font-family:Georgia,'Times New Roman',serif;color:#1a1a17;">
              <p style="margin:0 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#1f3a24;font-weight:700;">Hometown Crawls</p>
              <h1 style="margin:0 0 16px;font-size:32px;line-height:1.15;font-weight:700;color:#1a1a17;">You're in.</h1>
              <p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#2c2a24;">Thanks for joining <strong>${safeName}</strong>${shop}. We received your payment of <strong>${safeAmount}</strong>.</p>
              <p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#2c2a24;">The crawl runs <strong>${safeDates}</strong>. Crawlers can stop in during your normal business hours.</p>
              <p style="margin:0 0 18px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#2c2a24;">Next step: sign in to the shop portal and add a photo and your shop details.</p>
              <p style="margin:0 0 22px;">
                <a href="${SHOP_PORTAL_URL}" style="display:inline-block;background:#1f3a24;color:#f4efe6;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-weight:700;padding:12px 18px;border-radius:999px;">Open the shop portal</a>
              </p>
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#2c2a24;">Your shop will appear on the map at <a href="${MAP_URL}" style="color:#1f3a24;">${MAP_URL.replace("https://", "")}</a>.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}

function dbError(error, label) {
  const err = new Error((error && error.message) || label || "database error");
  err.code = error && error.code;
  err.transient = true;
  return err;
}

function assertOk(result, label) {
  if (result && result.error) throw dbError(result.error, label);
  return result ? result.data : null;
}

async function readRawBody(req) {
  if (req && Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (req && Buffer.isBuffer(req.body)) return req.body;
  if (req && typeof req.body === "string") return Buffer.from(req.body);
  if (req && req.body && typeof req.body === "object") {
    const err = new Error("Request body was parsed before signature verification");
    err.code = "RAW_BODY";
    throw err;
  }
  if (req && typeof req.text === "function" && typeof req.on !== "function") {
    return Buffer.from(await req.text());
  }
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function ignoreForeign(sessionId) {
  console.log(`[hc-webhook] ignoring foreign session ${sessionId || "unknown"}`);
  return { status: 200, body: { received: true } };
}

async function expandPaymentLink(stripe, session) {
  const raw = session.payment_link;
  if (!raw) return { id: null, url: null };
  if (typeof raw === "object") {
    return { id: raw.id || null, url: raw.url || null };
  }
  const link = await stripe.paymentLinks.retrieve(raw);
  return { id: link.id || raw, url: link.url || null };
}

function customerEmail(session, signup) {
  const fromSession =
    (session.customer_details && session.customer_details.email) || session.customer_email;
  return String(fromSession || signup.email || "").trim().toLowerCase();
}

function wasUnpaid(signup, listing) {
  const signupPaid = signup.status === "paid" || !!signup.paid_at;
  const listingPaid = !!(listing && listing.is_paid);
  return !signupPaid && !listingPaid;
}

async function ensureListing(supabase, signup) {
  const existing = await supabase
    .from("shop_listings")
    .select(LISTING_COLUMNS)
    .eq("signup_id", signup.id)
    .maybeSingle();
  const row = assertOk(existing, "load listing");
  if (row) return row;
  if (!signup.crawl_id) {
    throw dbError({ message: "signup has no crawl_id", code: "NO_CRAWL" }, "ensure listing");
  }

  const ownerEmail = String(signup.email || "").trim().toLowerCase();
  const displayName = String(signup.business_name || "").trim().slice(0, 200);
  if (!ownerEmail || !displayName) {
    throw dbError({ message: "signup is missing listing fields", code: "BAD_SIGNUP" }, "ensure listing");
  }

  const inserted = await supabase
    .from("shop_listings")
    .insert({
      crawl_id: signup.crawl_id,
      signup_id: signup.id,
      owner_email: ownerEmail,
      display_name: displayName,
      contact_name: signup.contact_name || null,
      phone: signup.phone || null,
    })
    .select(LISTING_COLUMNS)
    .single();

  if (inserted.error && inserted.error.code === "23505") {
    const again = await supabase
      .from("shop_listings")
      .select(LISTING_COLUMNS)
      .eq("signup_id", signup.id)
      .maybeSingle();
    const raced = assertOk(again, "reload listing");
    if (raced) return raced;
  }
  return assertOk(inserted, "create listing");
}

async function markPaid(supabase, { signup, listing, session, amountCents }) {
  const paidAt = signup.paid_at || new Date().toISOString();
  const signupPatch = {
    status: "paid",
    paid_at: paidAt,
    amount_paid_cents: amountCents,
    amount_cents: amountCents,
  };
  if (!signup.stripe_session_id || signup.stripe_session_id === session.id) {
    signupPatch.stripe_session_id = session.id;
  }

  // Status update runs crawl_signups_status_sync, which marks the listing paid
  // and calls sync_listing_business (map membership + counter code).
  const signupResult = await supabase.from("crawl_signups").update(signupPatch).eq("id", signup.id);
  assertOk(signupResult, "mark signup paid");

  const listingPatch = {
    is_paid: true,
    payment_source: "stripe",
    amount_paid_cents: amountCents,
  };
  if (!listing.paid_at) listingPatch.paid_at = paidAt;
  if (!listing.stripe_session_id || listing.stripe_session_id === session.id) {
    listingPatch.stripe_session_id = session.id;
  }
  const listingResult = await supabase.from("shop_listings").update(listingPatch).eq("id", listing.id);
  assertOk(listingResult, "mark listing paid");
}

async function sendConfirmation(deps, { to, email, sessionId }) {
  if (!deps.resendKey) {
    throw dbError({ message: "RESEND_API_KEY is not set", code: "NO_RESEND" }, "send email");
  }
  const fetchImpl = deps.fetch || fetch;
  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${deps.resendKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `hometown-crawls-paid-${sessionId}`,
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [to],
      subject: email.subject,
      html: email.html,
      text: email.text,
    }),
  });
  if (!response.ok && response.status !== 409) {
    const detail = typeof response.text === "function" ? await response.text() : "";
    const err = new Error(`Resend failed (${response.status})`);
    err.transient = true;
    err.detail = String(detail || "").slice(0, 300);
    throw err;
  }
}

async function handleEvent(event, deps) {
  if (!event || !HANDLED_EVENTS.has(event.type)) {
    return { status: 200, body: { received: true } };
  }

  const session = event.data && event.data.object;
  if (!session || !session.id) return ignoreForeign("unknown");
  if (!isUuid(session.client_reference_id)) return ignoreForeign(session.id);

  const signupResult = await deps.supabase
    .from("crawl_signups")
    .select("id,crawl,crawl_id,business_name,contact_name,email,phone,status,stripe_session_id,paid_at,amount_cents,amount_paid_cents")
    .eq("id", session.client_reference_id)
    .maybeSingle();
  const signup = assertOk(signupResult, "load signup");
  if (!signup) return ignoreForeign(session.id);

  const link = await expandPaymentLink(deps.stripe, session);
  const crawlsResult = await deps.supabase
    .from("crawls")
    .select("id,name,starts_at,ends_at,payment_link,price_cents,signup_key");
  const crawls = assertOk(crawlsResult, "load crawls") || [];
  const ours = paymentLinkMatches({
    linkId: link.id,
    linkUrl: link.url,
    crawlPaymentLinks: crawls.map((crawl) => crawl.payment_link),
    allowlist: deps.allowlist,
  });
  if (!ours) return ignoreForeign(session.id);

  if (session.payment_status !== "paid") {
    console.log(`[hc-webhook] session ${session.id} not paid (${session.payment_status || "unknown"})`);
    return { status: 200, body: { received: true } };
  }

  if (signup.stripe_session_id && signup.stripe_session_id !== session.id) {
    console.log(`[hc-webhook] signup ${signup.id} already recorded ${signup.stripe_session_id}`);
    return { status: 200, body: { received: true } };
  }

  const crawl =
    crawls.find((row) => row.id === signup.crawl_id) ||
    crawls.find((row) => row.signup_key && row.signup_key === signup.crawl) ||
    null;
  if (!signup.crawl_id && crawl) signup.crawl_id = crawl.id;

  const listing = await ensureListing(deps.supabase, signup);
  const amountCents = typeof session.amount_total === "number"
    ? session.amount_total
    : (signup.amount_paid_cents || signup.amount_cents || (crawl && crawl.price_cents) || 0);

  if (wasUnpaid(signup, listing)) {
    const to = customerEmail(session, signup);
    if (to) {
      const email = buildEmail({
        crawlName: crawl && crawl.name,
        dates: formatCrawlDates(crawl && crawl.starts_at, crawl && crawl.ends_at),
        amount: formatAmount(amountCents, session.currency),
        businessName: signup.business_name,
      });
      await sendConfirmation(deps, { to, email, sessionId: session.id });
    } else {
      console.error(`[hc-webhook] no customer email for session ${session.id}`);
    }
  }

  await markPaid(deps.supabase, { signup, listing, session, amountCents });
  return { status: 200, body: { received: true } };
}

function envDeps() {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    const err = new Error("Stripe environment is not configured");
    err.transient = true;
    throw err;
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const err = new Error("Supabase service role environment is not configured");
    err.transient = true;
    throw err;
  }
  return {
    stripe: new Stripe(process.env.STRIPE_SECRET_KEY),
    supabase: createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    allowlist: process.env.HC_PAYMENT_LINK_IDS || "",
    resendKey: process.env.RESEND_API_KEY,
    fetch,
  };
}

async function handleRequest(req, deps) {
  if (!req || req.method !== "POST") {
    return { status: 405, body: { error: "method not allowed" } };
  }

  let event;
  try {
    const secret = deps.webhookSecret || process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      console.error("[hc-webhook] missing STRIPE_WEBHOOK_SECRET");
      return { status: 500, body: { error: "temporary failure" } };
    }
    const raw = await readRawBody(req);
    const signature = req.headers && (req.headers["stripe-signature"] || req.headers["Stripe-Signature"]);
    event = deps.stripe.webhooks.constructEvent(raw, signature, secret);
  } catch (err) {
    console.error("[hc-webhook] signature", err && err.message);
    return { status: 400, body: { error: "invalid signature" } };
  }

  try {
    return await handleEvent(event, deps);
  } catch (err) {
    console.error("[hc-webhook]", err && err.message, err && err.detail ? err.detail : "");
    return { status: 500, body: { error: "temporary failure" } };
  }
}

async function handler(req, res) {
  let deps;
  try {
    deps = envDeps();
  } catch (err) {
    console.error("[hc-webhook]", err && err.message);
    res.status(500).json({ error: "temporary failure" });
    return;
  }
  const result = await handleRequest(req, deps);
  res.status(result.status).json(result.body);
}

module.exports = handler;
module.exports.config = config;
module.exports.handleRequest = handleRequest;
module.exports.handleEvent = handleEvent;
module.exports._test = {
  isUuid,
  paymentLinkMatches,
  formatAmount,
  formatCrawlDates,
  escapeHtml,
  buildEmail,
  wasUnpaid,
  readRawBody,
  canonicalUrl,
};
