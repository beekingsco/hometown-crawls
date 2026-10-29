# Ashley Cox (Messy Mama Co) — Proxi features as Hometown organizer toggles

Design only. This document does not change production behavior, the Puyallup shop-seat charge, stamp rules, or prize copy.

Audience: Chris, then a later implementation branch that can deploy as a Vercel preview.

Sources checked on 29 Oct 2026:

- Repo: crawl client, Organizer tab, Puyallup organizer dashboard, stamp RPC migrations, paper cards, bonus actions, guest photos, Stripe webhook, holiday trail page, official-rules config.
- Live Hometown Supabase project `tatwbjuwufeqynpufodq` (read-only): public tables, `crawls` columns, RLS, `list_public_crawls`.
- Vercel project `hometown-crawls` (`prj_2Z18AGyTRPwzi8ZxAoaMVfoAC68J`, team `team_iUdfm65nWOIzjNO7i2Ydu9HV`).
- Public Proxi HTML for `https://app.proxi.co/c/olympia-coffee-crawl` (client app; body is “Loading…”). Meta title and description were visible. The feature list below uses Ashley’s reported usage plus that meta. Anything not confirmed in Hometown code or in that HTML is marked as a hypothesis.

## What she does on Proxi, and what Hometown already is

Ashley runs Olympia Coffee Crawl on Proxi. Join code `COFFEE` opens `https://app.proxi.co/c/olympia-coffee-crawl`. October was about 19 stops and 435 people joined. She expects Nov–Dec to be about 32 shops, free to the shops, with a sponsor or donate option. She called out shops-free plus sponsor/donate, voting, and reviews. The landing also uses pay-what-you-want support for passports and marketing, a paper passport plus digital check-in, and a completion badge plus raffle entry.

Public Proxi meta (observed, not for Hometown copy): description says guests can win “the ULTIMATE coffee bundle.” Do not reuse that sentence. Prize-entry marketing stays held until Chris writes it.

Hometown today:

| Piece | Where it lives | Ashley gap |
| --- | --- | --- |
| Crawl row | `public.crawls`. Live ids: `puy-coffee` (listed, `price_cents` 4999, payment link set, Nov 1–Dec 31 2026) and `puy-pub` (`is_listed` false). | No Olympia or Lacey crawl. No per-crawl feature bag. |
| Organizer UI | Shared tab: `account.html` `#panel-organizer`, saved by `assets/organizer-panel.js` through `organizer_update_crawl`. Puyallup stats dashboard: `puyallup/coffee-crawl/organizer/index.html` (fees, trends, co-organizers). | No on/off feature switches. |
| Shops | `shop_listings` plus `crawl_signups`. Map and stamps require `is_paid`, `is_approved`, and `is_visible` (`get_public_crawl_shops`, `claim_stamp` in `migrations/20261014210000_per_crawl_codes_no_bypass.sql` and later video migration). | A free shop never appears and cannot be stamped. |
| Guest passport | Hardcoded page `puyallup/holiday-coffee-crawl/index.html` for crawl id `puy-coffee`. Email magic link. `HCCrawl.ensureAuth` rejects anonymous sessions. | No second trail page. |
| Stamps | `claim_stamp`: email user, code, location required, 50 m if the shop has a pin. One stamp per person per shop. Paper path: `guest_crawls.play_mode` `digital` or `paper`, staff manual stamps (`stamps.source`). | Geofence is a constant, not a toggle. Keep it that way. |
| Paper card | `card.html`, `assets/card-print.js`, `assets/paper-card.js`. Print copy notes continuation pages past 30 shops. | 32 stops already hits that edge. |
| Reviews-shaped data | `bonus_actions.kind` may be `tag`, `follow`, or `review`. That is an external link plus prize-entry proof (`guest_submit_bonus`), not a review guests read on the shop. | In-app shop reviews do not exist. |
| Prize entries | Guest hub math in `assets/guest-hub.js` is client-only (`1` per stop, `3` completion, shop bonus) and hardcoded to `puy-coffee`. No `raffle_entries` table. Holiday page says prizes are TBA. `puyallup/holiday-coffee-crawl/rules/config.json` has `prize_description: null` and `num_winners: null`. | No persisted completer list. Do not invent the prize. |
| Money | Stripe Payment Link → `api/stripe-webhook.js` marks `crawl_signups` and `shop_listings` paid. Webhook docs: production URL `https://www.hometowncrawls.com/api/stripe-webhook`. | No donation Checkout. Reusing this webhook would mark a shop paid. |
| Flags | No `feature_flags` table. No `crawls.settings`. `assets/config.js` is a deploy-time file, not an organizer switch. | Toggles need a row the organizer can update. |

Chris rules that stay on for every toggle: stamps require being near the shop, sign-in is email, anonymous users cannot join, stamp, review, vote, or enter a raffle.

## Where toggles and new UI would live

**Settings writes.** Staff already change a crawl only through security-definer RPCs. `crawls` RLS is `crawls_select_all` for `anon` and `authenticated` (`qual = true`). There is no client update policy. A new `organizer_set_crawl_settings(p_crawl text, p_patch jsonb)` should follow `organizer_update_crawl`: signed-in, non-anonymous, role on `crawl_organizers`.

**Hypothesis:** money switches (`shops_free`, `sponsor_donate`) should be limited to `owner` and `organizer`. Title, dates, and video today also allow `co-organizer` and `contributor`. Letting a contributor turn off shop fees on a crawl that charges seats is a larger change than editing a title. Chris should confirm the role split.

**Settings reads for guests.** Do not teach the guest client to `select *` from `crawls` for this. `assets/crawl.js` `loadCrawl` already selects `*`. That is pre-existing. `crawls` is world-readable, so `signup_key` and `payment_link` are already in that table for anyone who queries it. The feature bag must not add secrets. Guests should call a whitelist RPC, `public_crawl_features(p_crawl text)`, that returns only booleans and public numbers (minimum donation cents, whether results are visible).

**Organizer controls.** Add one card, “Features”, on the shared Organizer tab (`account.html` `#panel-organizer`, directly under the title/dates form `#org-details`). Wire the live path in `assets/organizer-panel.js` (the block that calls `organizer_my_crawls`). Demo mode (`?demo=1`) may render the same switches from local storage and must label them DEMO DATA. Do not put the switches only on `puyallup/coffee-crawl/organizer`. That page is the Puyallup fee dashboard. Ashley’s crawl will not be that route.

**Guest surface.** The holiday trail page is one crawl. A later branch should add a generic trail, hypothesis `/c/{crawlId}`, that reads shops, video, and `public_crawl_features`. It should not be a copy of the Puyallup HTML. Puyallup keeps `/puyallup/holiday-coffee-crawl` and crawl id `puy-coffee`.

**Shop creation under free mode.** Listings are born from the Puyallup signup and the Stripe webhook. There is no organizer “add a shop without a seat charge.” `shops_free` needs `organizer_add_shop` (name, address, pin, per-crawl code via `crawl_shop_codes`) that inserts `shop_listings` with `is_paid = false`, `is_approved = true`, `is_visible` chosen by the organizer. Without that RPC the toggle has nothing to show.

**Moderation.** Reviews sit next to the existing “Guest photos” card on the Organizer tab. Votes and completers get their own cards on that same tab. The Puyallup dashboard can stay a stats page.

## Crawl-level settings shape

Add one column. Do not add a global flags table. Organizers flip a crawl without a code deploy. Missing keys mean off, so existing rows stay off when the column appears.

```sql
alter table public.crawls
  add column if not exists settings jsonb not null default '{}'::jsonb;
```

`{}` is the default for `puy-coffee` and `puy-pub`. Do not backfill `true`.

Whitelist inside the RPC. Unknown keys are dropped. Booleans that are absent stay false. The RPC refuses to set any key to true on `puy-coffee` (hard guard, not only a UI hide), so a preview bug cannot turn features on for the live trail.

Guest-safe document:

```json
{
  "guest_reviews": false,
  "peoples_choice": false,
  "peoples_choice_results_visible": false,
  "completion_badge": false,
  "completion_raffle": false,
  "shops_free": false,
  "sponsor_donate": false,
  "donate_mode": "off",
  "donate_min_cents": 500,
  "donate_suggested_cents": [500, 1000, 2500]
}
```

`donate_mode` is `off`, `pwyw`, `slots`, or `both`. It is ignored when `sponsor_donate` is false.

Keep these out of `settings`:

- Prize name, prize description, winner count, drawing date, ARV. Those stay null until Chris writes them. Puyallup already has a place for that on the holiday rules config, and it is empty.
- Stripe price ids, webhook secrets, `signup_key`.
- The 50 m radius. It stays the constant in `claim_stamp`.

Vote category names are rows, not JSON, so votes can reference them.

Child tables hold the actual reviews, votes, badges, raffle rows, and payments. Settings only answers “is this feature on for this crawl?”

`shops_free` and the seat charge are mutually exclusive in the RPC. Turning `shops_free` on does not delete `price_cents` or `payment_link` (Puyallup keeps both). It changes shop visibility and `claim_stamp` only when the flag is true. The default seat path stays: unpaid listings stay off the map.

Proposed gate inside `claim_stamp` and `get_public_crawl_shops` (sketch, not a migration in this PR):

```text
listing is on the crawl when
  is_approved and is_visible
  and (
    is_paid
    or crawls.settings ->> 'shops_free' = 'true'
  )
```

Memberships with `status = active` stay valid. Code match, email session, and the 50 m check do not change. A shop with no pin can still be stamped once location is shared. That exception already exists. For a 32-shop free crawl, the organizer add-shop flow should require a pin before `is_visible` can be true. Hypothesis: require lat/lng to show a free shop, so the “no pin” exception does not become the way a remote stamp works.

## Feature designs

Defaults are off for every existing crawl, including `puy-coffee`.

### (a) Guest reviews on shops

| | |
| --- | --- |
| Toggle | `guest_reviews`. Label on the Organizer tab: **Guest reviews**. |
| Default | Off. |
| Guest UX | After a stamp at that shop, the shop card gets a short form: 1–5 stars and up to 500 characters. Signed-in email only. One review per guest per shop per crawl. They can edit until the organizer hides it or the crawl `ends_at` passes. When the toggle is off, the form is absent. This is not the shop-bonus “review” link. |
| Organizer UX | Queue beside Guest photos: Approve or Hide. Counts per shop. No reply thread in the first version. |
| Data | `shop_reviews (id, crawl_id, listing_id, user_id, rating smallint, body text, status text default 'pending', created_at, updated_at)`. Unique `(crawl_id, listing_id, user_id)`. Status `pending`, `approved`, `hidden`. Public select is `approved` only, and only when the crawl flag is on. Insert goes through `guest_submit_review`, which checks the stamp. |
| Anti-cheat | `auth.uid()` required, anonymous rejected, must have a `stamps` row for that shop on that crawl (digital or manual). Rate: one row, not many accounts’ worth of text from one session without a stamp. Organizer hide does not delete the row. Staff reviews of their own shop: allow, but label the shop email if it matches `shop_listings.owner_email`. Hypothesis: show “shop team” on those rows. |
| Staging | On the unlisted Olympia crawl only. Two test emails. A third email with no stamp cannot post. Puyallup shop cards gain no form. |

`bonus_actions.kind = 'review'` stays the external proof-for-entries path. Do not overload it.

### (b) People’s-choice / Best Of voting

| | |
| --- | --- |
| Toggle | `peoples_choice`. Label: **People’s choice voting**. Second switch, default off: **Show vote totals**, key `peoples_choice_results_visible`. |
| Default | Off. Totals hidden. |
| Guest UX | A “People’s choice” block on the trail. Categories are whatever the organizer typed (do not seed “best latte” or similar). The guest can vote only for a shop they have stamped. One choice per category. They can change it until `ends_at`. No live counts unless the show-totals switch is on. |
| Organizer UX | Add, rename, reorder, or retire categories. Retire does not delete ballots. A table of counts, always visible to staff, plus CSV. |
| Data | `vote_categories (id, crawl_id, label, sort, retired_at)`. `shop_votes (crawl_id, category_id, user_id, listing_id, updated_at)` unique `(category_id, user_id)`. Writes through `guest_cast_vote`. |
| Anti-cheat | Email session, not anonymous. Ballot ignored unless a stamp exists for that listing on that crawl. One row per category. No voting after `ends_at`. Do not show running tallies by default (that is how a public ballot gets piled onto the current leader). |
| Staging | Two categories on the Olympia test crawl. Confirm a guest cannot vote for an unstamped shop. Confirm `puy-coffee` has no ballot. Confirm totals stay hidden when the second switch is off. |

Hypothesis Chris may want “any joiner can vote” instead of “only shops you stamped.” The stamped-shop rule matches the geofence rule. Change it only if he says so.

### (c) Completion badge

| | |
| --- | --- |
| Toggle | `completion_badge`. Label: **Completion badge**. |
| Default | Off. |
| Guest UX | When every shop that counts is stamped, the passport shows a badge mark and the date. No prize sentence. If the toggle is off, the passport stays “n / n stamped,” which it already does. |
| Organizer UX | Count of guests who hold the badge. CSV of consented emails only (`profiles.contact_consent`), same idea as the current guest export. |
| Data | `completion_awards (user_id, crawl_id, awarded_at, stamp_count)` primary key `(user_id, crawl_id)`. Freeze the first time they complete, via `record_completion` (security definer, called after a successful stamp or from the passport load). A shop added later does not erase the badge. |
| What counts | Visible shops on the crawl under the same gate as the map (paid, or free when `shops_free`). Digital and manual stamps both count. Hypothesis: paper and digital are one passport, which matches `stamps` plus `guest_crawls.play_mode`. |
| Anti-cheat | Award only from stamps that `claim_stamp` or the staff manual-stamp RPC already wrote. Guests cannot insert `completion_awards`. Anonymous cannot. One row per person per crawl. |
| Staging | Complete a 2-shop test crawl with one account. Badge appears. Add a third shop. Badge remains. A partial passport shows no badge. |

### (d) Raffle / prize entry on completion

Prize-entry copy is **held** until Chris confirms. This design records completers. It does not name a prize, a winner count, or a drawing.

| | |
| --- | --- |
| Toggle | `completion_raffle`. Label: **Completion list**. Not “raffle” in guest-facing copy until Chris writes the rules. |
| Default | Off. |
| Guest UX | When the badge would be earned and this toggle is on, show a status line and nothing else: “You’re on the completion list.” No bundle, no odds, no “enter to win.” If Chris later fills prize fields, that is a separate copy change on that crawl only. Puyallup’s existing “Prizes are TBA” and the guest-hub entry counter stay as they are. Do not point Olympia at that counter (`guest-hub.js` is hardcoded to `puy-coffee` and invents a `+3` completion bonus in the browser). |
| Organizer UX | A completer count and a consented-email CSV. No draw button in the first version. Drawing stays a manual step after rules exist. |
| Data | `raffle_entries (user_id, crawl_id, created_at, voided_at, void_reason)`. Unique `(user_id, crawl_id)`. Insert only from the same completion check as the badge. `voided_at` lets staff remove a row without deleting history. No `prize_description` column. |
| Anti-cheat | Same stamp proof as the badge. One entry per person per crawl, not one per stamp (the Puyallup client’s per-stop entries are a different, unpersisted model — do not silently copy them onto Olympia). Staff void is audited. Shared codes and remote stamps never create a stamp, so they never create an entry. |
| Staging | Toggle on for Olympia test. Completing writes one row. Guest UI has no prize noun. `puy-coffee` `settings` stays `{}`. `config.json` `prize_description` stays null. |

### (e) Sponsor / donate, and optional free-shop mode

These are two switches. Free shops are how she runs 32 cafes. Donate is how the crawl is funded. Guests stay free either way.

| | |
| --- | --- |
| Toggles | **Shops join free** → `shops_free`. **Sponsor or donate** → `sponsor_donate`, plus `donate_mode`. |
| Default | Both off. Shop seats stay the Stripe path: `crawls.price_cents` (4999 on `puy-coffee`), `crawls.payment_link`, webhook sets `is_paid`. |
| Guest UX | Passport button stays free. If `sponsor_donate` is on and mode is `pwyw`, an optional block: organizer-written one-liner, otherwise the fixed line “Optional. The passport stays free.” Suggested amounts and a custom amount at or above `donate_min_cents`. Paying does not stamp, vote, or complete anything. If the switch is off, the block is absent. |
| Organizer UX | The two switches. When shops are free, “Add shop” (no Payment Link). Paid / unpaid pills remain for crawls that still charge. Donation list: amount, when, payer email. Sponsor slots, if mode includes `slots`: name, amount cents, quantity. |
| Data | `crawl_contributions (id, crawl_id, user_id, email, amount_cents, kind text, stripe_session_id unique, status, created_at)`. `kind` is `pwyw` or `slot`. `crawl_sponsor_slots (id, crawl_id, name, amount_cents, quantity, active)`. Do not set `shop_listings.is_paid` from these rows. |
| Stripe | A new Checkout Session with `metadata.purpose = donation` and `metadata.crawl_id`. The webhook must ignore shop-seat logic unless `purpose` is absent or `shop_seat`. Today’s handler marks a listing paid. A donation that hits that path would create a fake paid shop. Preview uses Stripe test keys and the preview’s own `/api/stripe-webhook`. Production webhook stays `https://www.hometowncrawls.com/api/stripe-webhook` and keeps serving the $49.99 seat. |
| Anti-cheat | Donation is not a gameplay advantage. No stamp, badge, or vote for paying. Webhook verifies the Stripe signature, same as seats. Minimum amount enforced server-side. Anonymous cannot attach a contribution to a passport; a payer may still be a guest email on the Checkout Session. |
| Free-shop anti-cheat | Free does not mean remote. `claim_stamp` still requires the code and 50 m. Organizer-created shops get a per-crawl code in `crawl_shop_codes` (legacy business codes are already bypassed once a per-crawl code exists). |
| Staging | Olympia test crawl: `shops_free` true, two unpaid listings visible, stamp works at the pin, unpaid listing still invisible on `puy-coffee`. Donate: one Stripe test payment on the preview URL only. Confirm it does not set `is_paid`. Confirm the live Puyallup Payment Link is unchanged. |

`crawls.organizer_share_pct` exists (default 50) and the Organizer tab copy says shop fees are not split. Do not apply that percent to donations unless Chris says the money is shared. Hypothesis: donations settle in the Hometown Stripe account and are not auto-transferred.

Paper passports stay the free printable card. A donation can support printing and marketing. The first version does not charge for the PDF and does not sell a mailed booklet.

### (f) Other Proxi landing pieces Hometown does not have

| Proxi piece | Hometown today | Proposal |
| --- | --- | --- |
| Pay-what-you-want for passports and marketing | Guests are free. No optional payment. | Covered by `sponsor_donate` / `pwyw`. Passport stays free. |
| Paper passport plus digital check-in | Already there: printable card, `play_mode`, QR or counter code, staff manual stamp. | No new toggle. Test 32 shops against the continuation-page path in `assets/card-print.js`. |
| Completion badge and raffle | Stamp count only. Raffle rows do not exist. Prize copy held. | Toggles (c) and (d). |
| Short join code `COFFEE` | Trails are URL paths. Counter codes are per shop. | Later. Not required for Ashley to try a trail. A crawl-level code is easy to leak and is not a stamp. |
| Add-to-home-screen manifest (“Coffee Crawl”) | No per-crawl manifest. | Later. |
| Interest in Lacey while Olympia is the live crawl | `profiles.area_crawl_opt_in` plus region, and the Organizer tab “New-crawl opt-ins” filter. It does not send mail. | Use region Lacey / Olympia for now. A named waitlist per future crawl is later. |
| Proxi prize sentence in meta | Held on Hometown. | Do not port. |

Hypothesis: the client-rendered Proxi page has more blocks than the public HTML meta. This design covers the features Ashley named and the landing items in the brief. It does not invent extra Proxi modules from an unread screen.

## Staging

Implementation branch, when someone builds this (not this design branch): `cursor/ashley-olympia-staging-78fb`.

Vercel project `hometown-crawls`. Production domains stay `www.hometowncrawls.com` and `hometowncrawls.com`. Do not promote the preview. Do not assign those domains to the branch.

Preview host pattern already used by this project: `hometown-crawls-git-main-robees-projects.vercel.app`. A branch preview should look like `hometown-crawls-git-cursor-ashley-olympia-staging-78fb-robees-projects.vercel.app`. Treat that as the expected name and confirm it on the deployment. This design branch itself has no app change, so its preview should match production.

The preview is not a separate database. `assets/config.js` hardcodes production Supabase `https://tatwbjuwufeqynpufodq.supabase.co`, and the project has no framework build to swap it. Preview JavaScript writes the live database.

Safe staging shape:

1. Apply additive migrations only after review. Defaults off. `claim_stamp` changes are flag-gated. `puy-coffee` settings cannot be turned on.
2. Insert an unlisted crawl, hypothesis id `oly-coffee`, `is_listed = false`, city Olympia. Live `list_public_crawls` already requires `is_listed`, so it stays off the homepage. Direct URL only.
3. Add Ashley as `organizer` on that crawl only. She does not get `puy-coffee`.
4. Exercise the generic trail on the preview URL. Leave `/puyallup/holiday-coffee-crawl` behavior as it is: paid shops only, no review form, no ballot, no donate block, $49.99 seat.
5. Stripe test mode for donations on the preview webhook URL. Leave the production webhook on the shop-seat events.

Supabase branching exists as a product and is not wired to this static site. A separate database is a later project (preview env plus a generated config). Until then, unlisted crawl plus the `puy-coffee` lock is the isolation.

Test pass on the preview:

- Guest email join, stamp inside 50 m, stamp refused outside 50 m, anonymous session refused.
- Review and vote rejected without a stamp. One vote per category.
- Badge freezes. Completion list gets one row. Guest copy has no prize name.
- Free shop visible on Olympia, invisible pattern unchanged on Puyallup.
- Test donation does not set `is_paid`.
- Paper card for more than 30 shops still paginates.
- Homepage search does not show `oly-coffee`.

## MVP rank

Smallest set that lets Ashley try Hometown on a preview, in order:

1. **Settings column, whitelist RPC, Organizer tab card, `puy-coffee` lock.** Nothing guest-visible until a flag is on.
2. **Unlisted Olympia crawl plus `shops_free` plus organizer add-shop.** She can put cafes on a map without the $49.99 seat. Stamps, email sign-in, 50 m, paper card, and QR stay the current product.
3. **`guest_reviews`, `peoples_choice`, `completion_badge`.** The three guest features she can click without new money or prize copy.
4. **`completion_raffle` as a completion list only.** Status line “You’re on the completion list.” No prize marketing.
5. **`sponsor_donate` in Stripe test mode (`pwyw` only).** After Chris answers where the money lands. Until then the switch can save, and the button must not charge.

Later, not needed for a first walkthrough:

- Sponsor slot inventory and public sponsor logos.
- Per-stop raffle math like the Puyallup guest-hub counter.
- Crawl join code, per-crawl PWA manifest, named Lacey waitlist, public results page, mailed paper booklet.
- A real preview database split from production Supabase.
- Showing Olympia on the homepage (`is_listed` true) before she has walked the preview.

## Chris decisions that block build

1. Prize copy stays held. Confirm the guest line “You’re on the completion list.” is acceptable, and that Olympia does not get a prize name in this pass.
2. Confirm Olympia shops are free (`shops_free`) while Puyallup keeps the $49.99 seat.
3. Who receives donations, and whether `organizer_share_pct` applies. It is unused in the shop-fee UI today.
4. May co-organizers and contributors flip toggles, or only owner and organizer?
5. Do manual paper stamps count toward reviews, votes, badge, and the completion list? This design says yes.
6. Votes only for shops the guest stamped? This design says yes.
7. Reviews stay `pending` until the organizer approves? This design says yes, matching guest photos.
8. Ashley’s organizer email, the crawl id (`oly-coffee` is a hypothesis), and whether Lacey is a second crawl or only an opt-in region.
9. A pin required before a free shop is visible? This design says yes.
10. When a real Stripe donation is allowed on a preview. Not before the webhook distinguishes `purpose=donation` from a shop seat.
