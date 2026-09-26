# Stripe webhook

The Hometown Crawls site is static. Paid shop signups are confirmed by a Vercel Node serverless function:

`https://www.hometowncrawls.com/api/stripe-webhook`

The Stripe account (BuzzPro.io Marketing) is shared with other businesses. The handler returns 200 and ignores any Checkout Session that is not a Hometown Crawls signup. Register **only** this endpoint for these events:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`

In Stripe: Developers → Webhooks → Add endpoint → that URL → select those two events → copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

A session is treated as ours only when all of the following are true:

1. `client_reference_id` is a UUID that exists in `crawl_signups` (the signup page sends the signup id).
2. The session’s Payment Link URL matches a `crawls.payment_link` value, **or** the Payment Link id (or URL) is listed in `HC_PAYMENT_LINK_IDS`.
3. `payment_status` is `paid`.

The first transition to paid updates `crawl_signups` and the linked `shop_listings` row (creating the listing the same way the signup trigger does, if it is missing) and emails the customer. Stripe retries are safe: the session id is unique, and the confirmation email is sent only on the first unpaid → paid transition.

## Apply the database migration first

Run `migrations/20260926040000_stripe_webhook_paid_columns.sql` on the Hometown Crawls Supabase project before the webhook is used. It adds `crawl_signups.paid_at`, `crawl_signups.amount_paid_cents`, a unique constraint on `crawl_signups.stripe_session_id`, and `shop_listings.stripe_session_id`.

## Environment variables

Set these on the Vercel project **hometown-crawls** (Production, and Preview if you send test webhooks there). They are server-side only. Do not put them in `assets/config.js` or any page.

| Variable | Required | Purpose |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | Yes | Secret API key for the shared Stripe account. Used to verify nothing else and to expand `payment_link`. |
| `STRIPE_WEBHOOK_SECRET` | Yes | Signing secret (`whsec_...`) for this endpoint only. |
| `SUPABASE_URL` | Yes | `https://tatwbjuwufeqynpufodq.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role key. Bypasses RLS to mark signups and listings paid. Never expose it to the browser. |
| `RESEND_API_KEY` | Yes | Sends the confirmation from `Hometown Crawls <hello@hometowncrawls.com>`. |
| `HC_PAYMENT_LINK_IDS` | No | Comma-separated Payment Link ids (`plink_...`) and/or Payment Link URLs. Use this when a link should count even if its URL is not stored on `crawls.payment_link`. The signup UUID check still applies. |

Existing `vercel.json` rewrites are unchanged. `/api/stripe-webhook` is the serverless function at `api/stripe-webhook.js` (plain Node, body parsing disabled so the Stripe signature can be checked against the raw body).
