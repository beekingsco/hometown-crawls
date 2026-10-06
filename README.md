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

## Organizer apps

- Form: `organize.html` → mailto `hello@hometowncrawls.com`, with a silent backup in `localStorage` key **`hc-organizer-apps-v1`**
- Dashboard stub: `organizer.html` (passwordless, local-only read)
- `data/organizer-apps.jsonl` is a placeholder only — browsers cannot append to disk

## Crawls

| Path | Crawl id | Shop seat |
|------|----------|-----------|
| `/puyallup/holiday-coffee-crawl` | `puy-coffee` | $49.99 for the 2026 holiday season, one-time |
| `/puyallup/coffee-crawl` | shop signup | same fee; inserts `crawl_signups` |
| `/puyallupwa/pub/` | `puy-pub` | hidden until 2027; redirects to the holiday coffee trail; noindex; not in the sitemap |

## Supabase

Public config in `assets/config.js`. RPCs: `join_crawl`, `claim_stamp`. Shops from `business_public` + `memberships`.

## SEO / GEO

- Unique title, description, canonical, and Open Graph on public pages
- JSON-LD: Organization + WebSite (home), TouristTrip (coffee), FAQPage (`faqs.html`), Article (guides)
- `robots.txt` + `sitemap.xml` → `https://www.hometowncrawls.com/`
- Evergreen guides under `guides/`
