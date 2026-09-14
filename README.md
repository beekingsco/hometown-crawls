# Hometown Crawls static site

Elegant multi-page static site (cream / forest green, Fraunces + Outfit). **No Bend orange.**

## Local preview

```bash
cd /workspace/hometown-crawls-site
python3 -m http.server 8080
```

Open http://localhost:8080

## Current blockers

1. **Stripe Payment Link** — paste the live Payment Link into `#stripe-seat-link` `href` on `shops/join.html` (coffee $49 default; pub `$59` when `?crawl=puy-pub`). `data-crawl` / `data-price` are set from the query.
2. **Vercel deploy** — publish this folder to the **hometown-crawls** Vercel project (`npx vercel --prod` from site root, or connect in the dashboard). Do not deploy from agents unless asked.

## Organizer apps

- Form: `organize.html` → persists to `localStorage` key **`hc-organizer-apps-v1`**
- Dashboard stub: `organizer.html` (passwordless, local-only read)
- `data/organizer-apps.jsonl` is a placeholder only — browsers cannot append to disk

## Crawls

| Path | Crawl id | Shop seat |
|------|----------|-----------|
| `/puyallupwa/coffee/` | `puy-coffee` | $49/mo |
| `/puyallupwa/pub/` | `puy-pub` | $59/mo (21+) |

## Supabase

Public config in `assets/config.js`. RPCs: `join_crawl`, `claim_stamp`. Shops from `business_public` + `memberships`.

## SEO / GEO

- Unique title, description, canonical, and Open Graph on public pages
- JSON-LD: Organization + WebSite (home), TouristTrip (coffee/pub), FAQPage (`faqs.html`), Article (guides)
- `robots.txt` + `sitemap.xml` → `https://hometowncrawls.com/`
- Evergreen guides under `guides/`
