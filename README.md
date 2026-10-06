# Hometown Crawls static site

Elegant multi-page static site (cream / forest green, Fraunces + Outfit). **No Bend orange.**

## Local preview

```bash
cd /workspace/hometown-crawls-site
python3 -m http.server 8080
```

Open http://localhost:8080

## Current blockers

1. **Stripe Payment Link** — the live coffee Payment Link is on `#stripe-seat-link` in `shops/join.html` ($49.99 one-time for the 2026 holiday season). Pub seats are not sold; the pub crawl stays hidden until 2027.
2. **Vercel deploy** — publish this folder to the **hometown-crawls** Vercel project (`npx vercel --prod` from site root, or connect in the dashboard). Do not deploy from agents unless asked.

## Organizer apps

- Form: `organize.html` → persists to `localStorage` key **`hc-organizer-apps-v1`**
- Dashboard stub: `organizer.html` (passwordless, local-only read)
- `data/organizer-apps.jsonl` is a placeholder only — browsers cannot append to disk

## Crawls

| Path | Crawl id | Shop seat |
|------|----------|-----------|
| `/puyallupwa/coffee/` | `puy-coffee` | $49.99 one-time (2026 holiday season) |
| `/puyallupwa/pub/` | `puy-pub` | Hidden until 2027 — no shop seat for sale |

## Supabase

Public config in `assets/config.js`. RPCs: `join_crawl`, `claim_stamp`. Shops from `business_public` + `memberships`.

## SEO / GEO

- Unique title, description, canonical, and Open Graph on public pages
- JSON-LD: Organization + WebSite (home), TouristTrip (coffee/pub), FAQPage (`faqs.html`), Article (guides)
- `robots.txt` + `sitemap.xml` → `https://hometowncrawls.com/`
- Evergreen guides under `guides/`
