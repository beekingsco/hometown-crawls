-- Backfill businesses, counter codes, QR secrets, and map pins for the
-- seven paid and approved puy-coffee listings so guests can check in.
--
-- Apply in the Supabase SQL editor for project tatwbjuwufeqynpufodq after
-- review. A deploy of the static site does not run this file. The script
-- is one transaction: any failed check rolls every change back.
--
-- Why this does not call private.sync_listing_business:
--   * With business_id still null it inserts id 'sl-' || 12 hex chars and a
--     6-character store_code. These shops need the existing anthem/holiday
--     rows, or a clean slug, and an 8-9 letter counter code.
--   * With business_id already set it copies the listing name, address,
--     lat, lng, and logo onto the business. That would rename
--     "Anthem Coffee & Tea" to the listing's "ANTHEM Coffee" and write a
--     null logo (these listings have no photos). It also does not fill a
--     missing store_code or qr_secret on a business that already exists.
--   * shop_listings_after_update calls that helper only when business_id
--     is already set AND display_name, address, lat, lng, or photo_paths
--     changed. shop_listings_touch only stamps updated_at. Neither trigger
--     writes is_paid, paid_at, amounts, is_approved, or crawl_signups, and
--     neither sends mail. The two listing updates below are ordered so the
--     helper is not invoked. Do not merge them into one UPDATE.
--
-- claim_stamp accepts a shop that has an active puy-coffee membership OR a
-- paid and approved listing whose business_id matches. get_public_crawl_shops
-- reads address/lat/lng from the listing and the map drops rows with no
-- business_id. Codes live on businesses (shop_listings has neither
-- store_code nor qr_secret). This script therefore links the listing, copies
-- the pin onto the listing when those columns are empty, and activates the
-- puy-coffee membership. Seed pins for anthem and holiday are corrected on
-- the business even when a value is already stored; listing pins are filled
-- only while empty so a later owner edit is left alone.
--
-- Pins (rooftop / storefront, cross-checked). A wrong pin fails the 150 m
-- geofence, so these were not guessed.
--   anthem  47.190318, -122.295286
--     210 W Pioneer Ave. myanthemcoffee.com/our-locations/downtown-puyallup,
--     Yelp, Apple Maps. OpenStreetMap cafe node 8269052858; US Census
--     interpolation is about 7 m away. The Sep 8 seed (47.19155, -122.29455)
--     is about 148 m off and is corrected.
--   holiday 47.190567, -122.294126
--     103 W Pioneer Ave. holidaycafewa.com/contact, Yelp. OpenStreetMap cafe
--     node; Census and the Esri street address are within about 25 m. The
--     seed (47.19148, -122.29355) is about 111 m off and is corrected.
--   woods-puyallup 47.192097, -122.279039
--     1115 E Main Ave, the only Woods shop in Puyallup (Ryan Spiker /
--     ryan@woodscoffee.com). News Tribune via Hoodline, KIRO 7 (opened
--     2026-09-28 on East Main), Roadtrippers. Esri PointAddress; Roadtrippers
--     is about 3 m away and Census about 22 m.
--   southern-charm 47.192144, -122.259214
--     2615 E Main Ave. The shop Facebook page (same gmail as the listing)
--     and joe.coffee. 1710 E Main is Gravity Coffee, not this stand. The LLC
--     filing in Buckley is the owner's address. Esri PointAddress; Census
--     is about 23 m away.
--   im-juiced 47.190598, -122.286935
--     615 E Pioneer, Unit 107. imjuicedbro.com and the WA SOS record (same
--     gmail). Esri PointAddress for the building; Census is about 11 m away.
--   happy-donuts 47.193238, -122.291804
--     305 2nd St NE. WA SOS record matches the listing phone and email.
--     OpenStreetMap fast_food node; Esri PointAddress is about 1 m away.
--   lick-homemade 47.191482, -122.294922
--     105 2nd St SW. lickhomemadeicecream.com, Apple Maps, The Viking
--     Vanguard. Esri PointAddress; the OpenStreetMap shop node is about 6 m
--     away.

begin;

create temp table backfill_targets (
  listing_id uuid primary key,
  business_id text not null,
  display_name text not null,
  owner_email text not null,
  biz_name text not null,
  address text not null,
  lat double precision not null,
  lng double precision not null,
  store_code text,
  reuse_existing boolean not null
) on commit drop;

insert into backfill_targets (
  listing_id, business_id, display_name, owner_email, biz_name,
  address, lat, lng, store_code, reuse_existing
) values
  (
    '9bf4ca90-be90-421d-8325-752c595c36f7',
    'anthem',
    'ANTHEM Coffee',
    'bryan@myanthemcoffee.com',
    'Anthem Coffee & Tea',
    '210 W Pioneer Ave, Puyallup, WA 98371',
    47.190318, -122.295286,
    null, true
  ),
  (
    'c4a170dc-a876-43f8-aa3a-ca8f91b428a1',
    'holiday',
    'Holiday Cafe',
    'nichole@holidaycafewa.com',
    'Holiday Cafe',
    '103 W Pioneer Ave, Puyallup, WA 98371',
    47.190567, -122.294126,
    null, true
  ),
  (
    'b8570c6e-dfbc-4fd7-af7b-c0bb3e051d3f',
    'woods-puyallup',
    'Woods Coffee',
    'ryan@woodscoffee.com',
    'Woods Coffee',
    '1115 E Main Ave, Puyallup, WA 98372',
    47.192097, -122.279039,
    'WOODSPUY', false
  ),
  (
    'f20c428d-257a-4453-af28-094570b14624',
    'southern-charm',
    'Southern Charm Espresso',
    'southerncharmespresso@gmail.com',
    'Southern Charm Espresso',
    '2615 E Main Ave, Puyallup, WA 98372',
    47.192144, -122.259214,
    'SCHARMES', false
  ),
  (
    'f2565031-9a4e-4436-a474-36d55cfb04c5',
    'im-juiced',
    U&'I\2019m Juiced-Juice bar',
    'imjuicedbro@gmail.com',
    'I''m Juiced',
    '615 E Pioneer, Unit 107, Puyallup, WA 98372',
    47.190598, -122.286935,
    'IMJUICED', false
  ),
  (
    'e6c1af03-dd34-4104-ac33-c67651d99333',
    'happy-donuts',
    'Happy Donuts',
    'jackyam123@comcast.net',
    'Happy Donuts',
    '305 2nd St NE, Puyallup, WA 98372',
    47.193238, -122.291804,
    'HAPPYDON', false
  ),
  (
    'a11e6bea-7c60-4e34-bad2-ddb5b4e622db',
    'lick-homemade',
    'Lick Homemade Ice cream',
    'heidi@lickhomemadeicecream.com',
    'Lick Homemade Ice Cream',
    '105 2nd St SW, Puyallup, WA 98371',
    47.191482, -122.294922,
    'LICKHOME', false
  );

do $checks$
declare
  v_missing int;
begin
  if (select count(*) from backfill_targets) <> 7 then
    raise exception 'expected exactly 7 backfill targets';
  end if;

  if exists (
    select 1
    from backfill_targets
    where not reuse_existing
      and store_code !~ '^[A-Z]{8,9}$'
  ) then
    raise exception 'new counter codes must be 8-9 uppercase letters';
  end if;

  select count(*) into v_missing
  from backfill_targets t
  left join public.shop_listings l
    on l.id = t.listing_id
   and l.crawl_id = 'puy-coffee'
   and l.is_paid is true
   and l.is_approved is true
   and l.owner_email = t.owner_email
   and l.display_name = t.display_name
  where l.id is null;

  if v_missing <> 0 then
    raise exception 'paid listing identity check failed for % row(s)', v_missing;
  end if;

  if (
    select count(*)
    from public.businesses
    where id in ('anthem', 'holiday')
  ) <> 2 then
    raise exception 'seed businesses anthem and holiday are missing';
  end if;

  -- Counter codes already on anthem/holiday stay. A code may be written
  -- only when it is free, or already belongs to the row we are creating.
  if exists (
    select 1
    from backfill_targets t
    join public.businesses b
      on b.store_code = t.store_code
     and b.id <> t.business_id
    where t.store_code is not null
  ) then
    raise exception 'a new counter code already belongs to another business';
  end if;
end
$checks$;

do $lock$
begin
  perform l.id
  from public.shop_listings l
  join backfill_targets t on t.listing_id = l.id
  for update of l;

  perform b.id
  from public.businesses b
  where b.id in ('anthem', 'holiday')
  for update of b;
end
$lock$;

create temp table listing_before on commit drop as
select
  id, crawl_id, business_id, display_name, owner_email, address, lat, lng,
  is_paid, is_approved, paid_at, amount_paid_cents, payment_source,
  stripe_session_id, photo_paths
from public.shop_listings;

create temp table signup_before on commit drop as
select id, status, paid_at, amount_cents, amount_paid_cents, stripe_session_id
from public.crawl_signups;

create temp table business_before on commit drop as
select
  id, name, address, lat, lng, type, store_code,
  md5(coalesce(qr_secret, '')) as qr_hash,
  logo_url, owner_user_id
from public.businesses;

create temp table membership_before on commit drop as
select crawl_id, business_id, status
from public.memberships;

create temp table backfill_counts (
  phase text primary key,
  paid_listings_with_business int not null,
  paid_listings_with_pin int not null,
  businesses_total int not null
) on commit drop;

insert into backfill_counts
select
  'before',
  (
    select count(*)::int
    from public.shop_listings
    where crawl_id = 'puy-coffee'
      and is_paid is true
      and business_id is not null
  ),
  (
    select count(*)::int
    from public.shop_listings
    where crawl_id = 'puy-coffee'
      and is_paid is true
      and lat is not null
      and lng is not null
  ),
  (select count(*)::int from public.businesses);

-- Correct the two seed rows in place. store_code, qr_secret, name, and
-- logo are intentionally absent from this SET.
update public.businesses b
set
  address = t.address,
  lat = t.lat,
  lng = t.lng,
  type = 'coffee'
from backfill_targets t
where b.id = t.business_id
  and t.reuse_existing
  and (
    b.address is distinct from t.address
    or b.lat is distinct from t.lat
    or b.lng is distinct from t.lng
    or b.type is distinct from 'coffee'
  );

insert into public.businesses (
  id, name, address, lat, lng, type, store_code, qr_secret
)
select
  t.business_id,
  t.biz_name,
  t.address,
  t.lat,
  t.lng,
  'coffee',
  t.store_code,
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
from backfill_targets t
where not t.reuse_existing
on conflict (id) do update
set
  name = excluded.name,
  address = excluded.address,
  lat = excluded.lat,
  lng = excluded.lng,
  type = 'coffee',
  store_code = coalesce(nullif(btrim(public.businesses.store_code), ''), excluded.store_code),
  qr_secret = coalesce(nullif(btrim(public.businesses.qr_secret), ''), excluded.qr_secret)
where public.businesses.name is distinct from excluded.name
   or public.businesses.address is distinct from excluded.address
   or public.businesses.lat is distinct from excluded.lat
   or public.businesses.lng is distinct from excluded.lng
   or public.businesses.type is distinct from 'coffee'
   or nullif(btrim(public.businesses.store_code), '') is null
   or nullif(btrim(public.businesses.qr_secret), '') is null;

-- LOAD-BEARING ORDER. Fill empty listing pins while business_id is still
-- null. shop_listings_after_update then sees a null business_id and does
-- not call sync_listing_business. A single UPDATE that sets business_id
-- and address together would call it.
update public.shop_listings l
set
  address = case
    when nullif(btrim(l.address), '') is null then t.address
    else l.address
  end,
  lat = coalesce(l.lat, t.lat),
  lng = coalesce(l.lng, t.lng)
from backfill_targets t
where l.id = t.listing_id
  and l.crawl_id = 'puy-coffee'
  and l.is_paid is true
  and l.is_approved is true
  and l.owner_email = t.owner_email
  and l.business_id is null
  and (
    nullif(btrim(l.address), '') is null
    or l.lat is null
    or l.lng is null
  );

-- business_id only. This SET list does not include display_name, address,
-- lat, lng, or photo_paths, so shop_listings_after_update does not fire.
update public.shop_listings l
set business_id = t.business_id
from backfill_targets t
where l.id = t.listing_id
  and l.crawl_id = 'puy-coffee'
  and l.is_paid is true
  and l.is_approved is true
  and l.owner_email = t.owner_email
  and l.business_id is null;

-- Paid shops are active members of this crawl. anthem and holiday already
-- have inactive puy-coffee memberships; those two rows become active.
-- Every other membership, including the unpaid seed shops and puy-pub, is
-- left as it is.
insert into public.memberships (crawl_id, business_id, status)
select 'puy-coffee', t.business_id, 'active'
from backfill_targets t
on conflict (crawl_id, business_id) do update
set status = 'active'
where public.memberships.status is distinct from 'active';

insert into backfill_counts
select
  'after',
  (
    select count(*)::int
    from public.shop_listings
    where crawl_id = 'puy-coffee'
      and is_paid is true
      and business_id is not null
  ),
  (
    select count(*)::int
    from public.shop_listings
    where crawl_id = 'puy-coffee'
      and is_paid is true
      and lat is not null
      and lng is not null
  ),
  (select count(*)::int from public.businesses);

do $verify$
begin
  if exists (
    select 1
    from public.shop_listings l
    join listing_before b on b.id = l.id
    where l.is_paid is distinct from b.is_paid
       or l.is_approved is distinct from b.is_approved
       or l.paid_at is distinct from b.paid_at
       or l.amount_paid_cents is distinct from b.amount_paid_cents
       or l.payment_source is distinct from b.payment_source
       or l.stripe_session_id is distinct from b.stripe_session_id
       or l.display_name is distinct from b.display_name
       or l.owner_email is distinct from b.owner_email
       or l.photo_paths is distinct from b.photo_paths
  ) then
    raise exception 'a listing payment or identity column changed';
  end if;

  if exists (
    select 1
    from public.shop_listings l
    join listing_before b on b.id = l.id
    where not exists (select 1 from backfill_targets t where t.listing_id = l.id)
      and (
        l.business_id is distinct from b.business_id
        or l.address is distinct from b.address
        or l.lat is distinct from b.lat
        or l.lng is distinct from b.lng
      )
  ) then
    raise exception 'a listing outside the 7 paid shops changed';
  end if;

  -- Listing address and pin are filled only where they were empty, so a
  -- second run (or a pin an owner already saved) must not be rewritten.
  if exists (
    select 1
    from public.shop_listings l
    join backfill_targets t on t.listing_id = l.id
    join listing_before prev on prev.id = l.id
    where l.business_id is distinct from t.business_id
       or l.address is distinct from case
            when nullif(btrim(prev.address), '') is null then t.address
            else prev.address
          end
       or l.lat is distinct from coalesce(prev.lat, t.lat)
       or l.lng is distinct from coalesce(prev.lng, t.lng)
  ) then
    raise exception 'a paid listing was not linked, or an existing pin was overwritten';
  end if;

  if exists (
    select 1
    from public.shop_listings l
    join backfill_targets t on t.listing_id = l.id
    where l.lat is null or l.lng is null or nullif(btrim(l.address), '') is null
  ) then
    raise exception 'a paid listing is still missing its address or pin';
  end if;

  if exists (
    select 1
    from public.crawl_signups s
    join signup_before b on b.id = s.id
    where s.status is distinct from b.status
       or s.paid_at is distinct from b.paid_at
       or s.amount_cents is distinct from b.amount_cents
       or s.amount_paid_cents is distinct from b.amount_paid_cents
       or s.stripe_session_id is distinct from b.stripe_session_id
  ) or (select count(*) from public.crawl_signups) <> (select count(*) from signup_before) then
    raise exception 'crawl_signups changed';
  end if;

  if exists (
    select 1
    from public.businesses b
    join business_before prev on prev.id = b.id
    where not exists (select 1 from backfill_targets t where t.business_id = b.id)
      and (
        b.name is distinct from prev.name
        or b.address is distinct from prev.address
        or b.lat is distinct from prev.lat
        or b.lng is distinct from prev.lng
        or b.type is distinct from prev.type
        or b.store_code is distinct from prev.store_code
        or md5(coalesce(b.qr_secret, '')) is distinct from prev.qr_hash
        or b.logo_url is distinct from prev.logo_url
        or b.owner_user_id is distinct from prev.owner_user_id
      )
  ) then
    raise exception 'a business outside the 7 paid shops changed';
  end if;

  if exists (
    select 1
    from public.businesses b
    join business_before prev on prev.id = b.id
    join backfill_targets t on t.business_id = b.id
    where t.reuse_existing
      and (
        b.name is distinct from prev.name
        or b.store_code is distinct from prev.store_code
        or md5(coalesce(b.qr_secret, '')) is distinct from prev.qr_hash
        or b.logo_url is distinct from prev.logo_url
        or b.owner_user_id is distinct from prev.owner_user_id
        or nullif(btrim(b.store_code), '') is null
        or nullif(btrim(b.qr_secret), '') is null
      )
  ) then
    raise exception 'anthem or holiday name, counter code, or QR secret changed';
  end if;

  if exists (
    select 1
    from backfill_targets t
    join public.businesses b on b.id = t.business_id
    left join business_before prev on prev.id = b.id
    where not t.reuse_existing
      and (
        b.name is distinct from t.biz_name
        or b.address is distinct from t.address
        or b.lat is distinct from t.lat
        or b.lng is distinct from t.lng
        or b.type is distinct from 'coffee'
        or nullif(btrim(b.store_code), '') is null
        or nullif(btrim(b.qr_secret), '') is null
        or (prev.id is null and b.store_code is distinct from t.store_code)
        or (prev.id is not null and b.store_code is distinct from prev.store_code)
        or (prev.id is not null and md5(coalesce(b.qr_secret, '')) is distinct from prev.qr_hash)
      )
  ) then
    raise exception 'a new business row is missing its pin, code, or QR secret';
  end if;

  if (
    select count(*)
    from public.memberships m
    join backfill_targets t on t.business_id = m.business_id
    where m.crawl_id = 'puy-coffee'
      and m.status = 'active'
  ) <> 7 then
    raise exception 'the 7 shops are not active puy-coffee members';
  end if;

  if exists (
    select 1
    from public.memberships m
    join membership_before prev
      on prev.crawl_id = m.crawl_id
     and prev.business_id = m.business_id
    where m.status is distinct from prev.status
      and not exists (
        select 1
        from backfill_targets t
        where t.business_id = m.business_id
          and m.crawl_id = 'puy-coffee'
      )
  ) then
    raise exception 'a membership outside the 7 paid shops changed';
  end if;

  if exists (
    select 1
    from public.memberships m
    where not exists (
      select 1
      from membership_before prev
      where prev.crawl_id = m.crawl_id
        and prev.business_id = m.business_id
    )
      and not exists (
        select 1
        from backfill_targets t
        where t.business_id = m.business_id
          and m.crawl_id = 'puy-coffee'
      )
  ) then
    raise exception 'an unexpected membership row was inserted';
  end if;

  -- Growth is counted from this run's snapshot, so applying the file twice
  -- is a no-op instead of a failed "+ 7" check.
  if (select businesses_total from backfill_counts where phase = 'after')
     <> (select businesses_total from backfill_counts where phase = 'before')
        + (
          select count(*)::int
          from backfill_targets t
          where not t.reuse_existing
            and not exists (select 1 from business_before prev where prev.id = t.business_id)
        ) then
    raise exception 'businesses total changed by an unexpected amount';
  end if;

  if (select paid_listings_with_business from backfill_counts where phase = 'after')
     <> (select paid_listings_with_business from backfill_counts where phase = 'before')
        + (
          select count(*)::int
          from backfill_targets t
          join listing_before prev on prev.id = t.listing_id
          where prev.business_id is null
        ) then
    raise exception 'paid listings with a business_id changed by an unexpected amount';
  end if;

  if (select paid_listings_with_pin from backfill_counts where phase = 'after')
     <> (select paid_listings_with_pin from backfill_counts where phase = 'before')
        + (
          select count(*)::int
          from backfill_targets t
          join listing_before prev on prev.id = t.listing_id
          where prev.lat is null or prev.lng is null
        ) then
    raise exception 'paid listings with a pin changed by an unexpected amount';
  end if;
end
$verify$;

select phase, paid_listings_with_business, paid_listings_with_pin, businesses_total
from backfill_counts
order by phase desc;

select
  l.display_name,
  l.business_id,
  (nullif(btrim(b.store_code), '') is not null) as has_code,
  (nullif(btrim(b.qr_secret), '') is not null) as has_qr,
  l.lat,
  l.lng,
  b.lat as business_lat,
  b.lng as business_lng,
  m.status as membership_status
from public.shop_listings l
join backfill_targets t on t.listing_id = l.id
join public.businesses b on b.id = l.business_id
left join public.memberships m
  on m.crawl_id = l.crawl_id
 and m.business_id = l.business_id
order by l.display_name;

commit;
