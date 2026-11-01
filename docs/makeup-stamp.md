# Makeup stamp links

Launch-day GPS misses get one free stamp per guest per crawl. The guest opens a link, taps the shop they were trying to stamp, and that claim is closed for their account on that crawl.

The guest does not sign in. The token in the URL is the secret and it is stored against their `user_id`. A magic-link session would add a second tap and still would not, by itself, say which makeup grant was sent. Device location is not read and is not stored.

Apply `migrations/20261101190000_makeup_claim_tokens.sql` by hand on the Hometown Crawls Supabase project (`tatwbjuwufeqynpufodq`) after Chris OKs the merge. A Vercel deploy does not run it.

## URL

```text
https://www.hometowncrawls.com/makeup?t=<token uuid>
```

`/makeup` rewrites to `makeup/index.html`. The page is `noindex` and `robots.txt` disallows `/makeup`.

The page calls the anon RPCs `get_makeup_claim(p_token)` and `claim_makeup_stamp(p_token, p_business)`. A ready link lists paid, approved, visible shops on that crawl that have a map pin (the same shops the passport map can draw). Other states show a short closed message and no shop buttons.

Stamp rows use `source = 'makeup'`. `lat` and `lng` stay null.

## One stamp per account per crawl

Enforced in the database, not in the browser:

- Partial unique index `makeup_claim_tokens_one_open_idx`: at most one unused token per `(user_id, crawl_id)`.
- Partial unique index `makeup_claim_tokens_one_used_idx`: at most one used token per `(user_id, crawl_id)`.
- Trigger `makeup_claim_tokens_one_allowance`: a new or updated token is rejected when another token for that guest and crawl is already used.
- `claim_makeup_stamp` stamps only the token's `crawl_id`, only a shop returned for that crawl, and only when that guest has a `crawl_joins` row. It also refuses when any `stamps` row for that guest and crawl already has `source = 'makeup'`.
- The token row is marked used in the same transaction as the stamp insert. A second tap of the same shop returns `claimed` and does not insert again. A different shop, a second link, or a refresh returns `used` or `expired` and does not insert.
- Another guest's unused token is a different `(user_id, crawl_id)` pair and still works.
- Anon has no table privileges. Signed-in guests can select only their own token rows. Inserts and updates go through the definer RPCs.

Shops already on the passport (any source) are not double stamped. The link stays open so the guest can tap a different stop.

## Mint tokens

Confirm the migration is applied, then confirm each guest has a `crawl_joins` row for that crawl. From the Supabase SQL editor:

```sql
insert into public.makeup_claim_tokens (crawl_id, user_id, expires_at)
select 'puy-coffee', u.id, now() + interval '72 hours'
from auth.users u
where u.email in (
  'guest.one@example.com',
  'guest.two@example.com'
)
  and exists (
    select 1 from public.crawl_joins j
    where j.user_id = u.id and j.crawl_id = 'puy-coffee'
  )
returning user_id,
  token,
  'https://www.hometowncrawls.com/makeup?t=' || token as claim_url,
  expires_at;
```

Replace the crawl id and the email list. Seventy-two hours is the default. The insert fails if that guest already has an unused token, or if they already used a makeup stamp on that crawl.

To refresh an open link without creating a second token, run the same insert only when no row exists, or call the RPC below. A second insert while an unused token is still open hits `makeup_claim_tokens_one_open_idx`.

### Owner or service role RPC

`issue_makeup_claim(p_crawl text, p_user uuid, p_ttl_hours integer default 72)` is granted to `authenticated` and `service_role`, not anon. The body allows the service role, or a signed-in crawl owner (`crawl_organizers.role = 'owner'`). Co-organizers are refused.

It requires the guest to have joined that crawl. TTL is 1 to 336 hours. If an unused token already exists, it extends `expires_at` and returns the same token. If a makeup stamp was already used, it raises `Makeup stamp already used for this crawl`.

```sql
select public.issue_makeup_claim('puy-coffee', '<user uuid>'::uuid, 72);
```

The JSON includes `token`, `expires_at`, and `path` (`/makeup?t=...`). Prefix the path with `https://www.hometowncrawls.com` in the email.

Call this with the service role key, or while signed in as the crawl owner. The SQL editor's postgres session does not carry that JWT, so the editor path is the `insert` above.

## What the guest sees

| State | Shop buttons |
| --- | --- |
| Token open, guest joined, shops on the map | Yes. One tap stamps that shop. |
| Just stamped | No. Success copy, then a link to the passport. |
| Link opened again, or any other makeup link for that account and crawl | No. Closed copy. |
| Past `expires_at`, unknown token, or a bad `t` value | No. Closed copy. |
| Shop already on the passport | Buttons stay. They can pick a different shop. |

Known passport paths: `puy-coffee` → `/puyallup/holiday-coffee-crawl`, `arl-coffee` → `/arlington/holiday-coffee-crawl`. Anything else links to `/account`.
