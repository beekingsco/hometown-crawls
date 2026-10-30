# Organizer self-serve crawls

Organizers start a crawl without emailing Chris, then invite shops. This is for the Vercel preview of the pull request. Do not merge it to production, and do not apply the migration to the live Puyallup Supabase project, until Chris has tested it on staging.

A shop seat is **$49.99**. There is no free shop. Stripe Checkout is not part of this version.

## What the preview does

1. `/organize` — a signed-in person enters the crawl name, dates, and city or area, plus an optional shop-name list. The app writes a `crawls` row and an owner membership.
2. `/account` Organizer tab — paste shop emails and save the list.
3. **Send invites** — Resend emails each address. The message says they have been invited to a crawl and includes a unique join link.
4. `/crawls/join?invite=<token>` — that crawl's shop signup. The Puyallup page at `/puyallup/coffee-crawl` stays as it is. New crawls are not hardcoded to Puyallup.
5. If the crawl has a Stripe Payment Link saved, signup continues to that link with the signup id as `client_reference_id`. If it does not, the shop is saved and the organizer shares the Payment Link by hand.

A new shop listing starts hidden. Only the crawl owner or an organizer can show it on the passport, and only after a map pin is saved. Shops that are already visible on Puyallup stay visible.

## Preview environment

Set these on the Vercel project for **Preview** only. Leave Production unchanged.

| Variable | Required | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | Yes | Staging Supabase project. Not `tatwbjuwufeqynpufodq`. |
| `SUPABASE_ANON_KEY` | Yes | That project's public anon key. |
| `RESEND_API_KEY` | Yes, to send mail | Same kind of key Support already uses. |
| `HC_APP_URL` | No | Invite links use this origin. When unset, preview uses `VERCEL_URL`. |

`/api/public-config` returns the URL and anon key to the browser. It does not read or return a service role key.

Do not commit any of these values. Do not put a service role key in the repo.

The self-serve pages refuse to write when the deploy is not the production site and the Supabase URL is missing or is the live Puyallup project.

## Staging database

Use a separate Supabase project, or a Supabase branch, so test crawls never land in the live Puyallup data.

The staging database needs the existing Hometown Crawls schema (the tables and functions already in production). Then run, by hand:

`migrations/20261030160000_organizer_self_serve.sql`

That file is not applied by the site, by CI, or by this pull request. It:

- lets shop signup inserts target any crawl, not only `puy-coffee-nov-2026`
- adds `organizer_create_crawl` and the shop-invite tables
- keeps new shop listings hidden until they have a map pin and an owner or organizer shows them

In the staging project's Auth settings, add the Vercel preview origin to the redirect allow list. Magic links return to `/organize` and `/account`.

## How to test

1. Open the Vercel preview of this pull request. Confirm `/organize` does not show the staging-setup warning.
2. Sign in with a magic link.
3. Start a crawl with a name, a city, dates, and one or two shop names.
4. Open `/account`, Organizer tab. Confirm the crawl is selected and you are the owner.
5. Paste two shop emails. Save the invite list. Copy a join link and open it in a private window. The page should name that crawl and show $49.99.
6. Send invites. Each inbox should get "You've been invited to a crawl" and a different `/crawls/join?invite=` link.
7. Submit the shop form. With no Payment Link, it stops after the save and says the seat is unpaid. With a Payment Link saved on the crawl, it opens Stripe with `client_reference_id` set to the signup id.
8. On the shop editor, save a map pin from the address. Showing the shop on the passport should fail before the pin and succeed after it, and only for an owner or organizer.

## What stays manual

- **Stripe Checkout** is not built. Create a Payment Link in Stripe for $49.99 and paste it on the Organizer tab, or send that link yourself.
- **Paid on staging** does not flip by itself unless the preview `/api/stripe-webhook` is configured with the staging project's `SUPABASE_SERVICE_ROLE_KEY`, plus `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. The live webhook looks at the live database, so a staging signup id is ignored there. You can mark the staging `crawl_signups` row paid in the SQL editor instead. Never commit the service role key, and do not point the preview at the live service role.
- Set the Payment Link success URL to `https://<preview-host>/crawls/join?saved=1&crawl=<id>` if you want shops to land back on the crawl page.
- Soft approval of new crawls is not built. On staging, any signed-in creator can create one, and it is listed.
- Co-organizer invites still do not send email. Shop invites are the emails this change sends.
