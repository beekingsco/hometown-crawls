# Hometown Crawls static site

Elegant multi-page static site (cream / forest green, Fraunces + Outfit). **No Bend orange.**

## Local preview

```bash
cd /workspace/hometown-crawls-site
python3 -m http.server 8080
```

Open http://localhost:8080

## Current blockers

1. **Stripe Payment Link** — the live shop signup is `/puyallup/coffee-crawl` (holiday season, $49.99 one-time). `/shops/join` redirects there. Do not point shops at the old monthly seat link.
2. **Vercel deploy** — publish this folder to the **hometown-crawls** Vercel project (`npx vercel --prod` from site root, or connect in the dashboard). Do not deploy from agents unless asked.

## Organizer self-serve

Signed-in organizers start a crawl at `/organize`, then paste shop emails on the Organizer tab in `/account`. Send invites uses Resend. Each shop gets a unique link at `/crawls/join?invite=…`. A seat is $49.99. There is no free shop. Stripe Checkout is not built: save a Payment Link on the crawl, or share the signup URL.

Preview deploys must point `SUPABASE_URL` and `SUPABASE_ANON_KEY` at a staging project. They must not use the live Puyallup database. Apply `migrations/20261030160000_organizer_self_serve.sql` on that staging database before testing. The full checklist is `docs/organizer-self-serve.md`.

`organizer.html` is the old local-only application stub. It does not create a crawl.

## Organizer apps

- Live form: `/organize` writes the crawl and an owner membership through Supabase
- Dashboard: `/account` Organizer tab
- `data/organizer-apps.jsonl` is a placeholder only — browsers cannot append to disk

## Crawls

| Path | Crawl id | Shop seat |
|------|----------|-----------|
| `/crawls/join?crawl=<id>` or `?invite=<token>` | that crawl | $49.99 one-time; Payment Link when one is saved |
| `/organize` | new crawl | creator becomes owner |
| `/puyallup/holiday-coffee-crawl` | `puy-coffee` | $49.99 for the 2026 holiday season, one-time |
| `/puyallup/coffee-crawl` | shop signup | same fee; inserts `crawl_signups` |
| `/puyallupwa/pub/` | `puy-pub` | hidden until 2027; redirects to the holiday coffee trail; noindex; not in the sitemap |

## Supabase

Public config in `assets/config.js`. RPCs: `join_crawl`, `claim_stamp`. Shops from `business_public` + `memberships`.

## Support and testing checklists

- Hosts: `/account/store/help` (Instructions on the Store tab)
- Organizers: `/account/organizer/help` (Instructions on the Organizer tab)
- Anyone: `/support` posts to `/api/support` and emails `SUPPORT_TO_EMAIL` (default `hello@hometowncrawls.com`) through Resend. See `docs/support.md`.

## SEO / GEO

- Unique title, description, canonical, and Open Graph on public pages
- JSON-LD: Organization + WebSite (home), TouristTrip (coffee), FAQPage (`faqs.html`), Article (guides)
- `robots.txt` + `sitemap.xml` → `https://www.hometowncrawls.com/`
- Evergreen guides under `guides/`
