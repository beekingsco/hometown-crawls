-- Pin the seven puy-coffee shops whose listings, sl- businesses, codes, and
-- active memberships were created by private.sync_listing_business when the
-- webhook replay marked them paid. Those rows have no address and no pin.
--
-- Apply in the Supabase SQL editor for project tatwbjuwufeqynpufodq after
-- review. A deploy of the static site does not run this file. One transaction:
-- any failed check rolls every change back.
--
-- Do not re-link these listings onto the Sep 8 seed rows dulce, rescue, or xo.
-- Those seed pins are rough (about 85 m, 116 m, and 178 m off the storefronts
-- below). Do not update those rows, their codes, or their inactive memberships.
-- Do not change store_code or qr_secret on the sl- rows. The shops may already
-- have those webhook codes.
--
-- shop_listings_after_update fires on UPDATE OF address, lat, or lng when
-- business_id is already set, and then calls sync_listing_business. For an
-- existing business that helper writes only:
--   name = listing.display_name
--   address, lat, lng = the listing pin
--   logo_url = the first photo URL, or null when photo_paths is empty
--   and the puy-coffee membership status (active when paid and approved)
-- It does not write store_code or qr_secret, and it updates only
-- businesses.id = listing.business_id. These seven businesses are already
-- named with the listing display_name, logo_url is null, photo_paths is
-- empty, and the membership is already active, so the helper's rewrite keeps
-- those values and copies the new pin. This script refuses to run if that
-- rewrite would rename a business, clear or replace a logo, or change a
-- membership status. The business pin is written first, so it is stored even
-- when the listing pin is already filled and the helper does not run.
--
-- Pins are rooftop or storefront points, cross-checked. A wrong pin fails
-- the 150 m check-in fence.
--   sl-074ac1428ede  47.190575, -122.293863
--     Catffeinated, 212 S Meridian. catffeinated.net, News Tribune, chamber.
--     OpenStreetMap cafe node; the building node is about 2 m away and the
--     Esri point address about 15 m.
--   sl-be56d8ee6d77  47.189423, -122.293567
--     Dulce Cafe, 333 S Meridian Unit 111. dulcecafewa.com (same email).
--     Esri PointAddress; Census is about 5 m away and the OpenStreetMap
--     building node about 10 m. Not the Elements cafe node in the same center.
--   sl-65ed4ffe31b8  47.187395, -122.294116
--     Enchanted Espresso, 516 S Meridian, a fixed drive-thru at that parcel.
--     Yelp, Apple Maps, and BringFido (same email). Esri PointAddress; the
--     OpenStreetMap shop at that address is about 3 m away.
--   sl-96d797d33139  47.191969, -122.277322
--     Rescue Me Coffee, 1303 E Main Ave, Puyallup, not the Eatonville shop.
--     Apple Maps (owner Brionna) and Facebook. OpenStreetMap cafe node; Esri
--     PointAddress is about 1 m away.
--   sl-753d952bca71  47.193213, -122.293064
--     The Cat & Rabbitt, 111 E Stewart Ave, Puyallup. thecatandrabbitt.com
--     and the News Tribune. The Tacoma shop is not used. Esri PointAddress;
--     a second place record is about 4 m away.
--   sl-b44c3e1d592c  47.191494, -122.266256
--     Wanna Cupcake?, 2102 E Main Ave Suite 112, Puyallup. wannacupcake.com.
--     The University Place shop is not used. OpenStreetMap bakery node;
--     Esri PointAddress for 2102 E Main is about 52 m away on the same property.
--   sl-a90417517da6  47.193542, -122.299442
--     XO Expresso, 504 W Stewart Ave. MapQuest lists the signup phone.
--     Restaurantji, Martin Henry Coffee, joe.coffee. Esri PointAddress; a
--     second place record is about 10 m away and Census about 26 m.

begin;

create temp table pin_targets (
  listing_id uuid primary key,
  business_id text not null,
  display_name text not null,
  owner_email text not null,
  address text not null,
  lat double precision not null,
  lng double precision not null
) on commit drop;

insert into pin_targets (
  listing_id, business_id, display_name, owner_email, address, lat, lng
) values
  (
    '074ac142-8ede-4a5b-9a8d-66b4f04870cb',
    'sl-074ac1428ede',
    'Catffeinated',
    'kristi515@gmail.com',
    '212 S Meridian, Puyallup, WA 98371',
    47.190575, -122.293863
  ),
  (
    'be56d8ee-6d77-4131-9229-ab80012ec66a',
    'sl-be56d8ee6d77',
    'Dulce Cafe',
    'dulcecafeofficial@gmail.com',
    '333 S Meridian, Unit 111, Puyallup, WA 98371',
    47.189423, -122.293567
  ),
  (
    '65ed4ffe-31b8-410a-b3ee-6cd3a39f9907',
    'sl-65ed4ffe31b8',
    'Enchanted Espresso',
    'enchanted.espressocoffee@gmail.com',
    '516 S Meridian, Puyallup, WA 98371',
    47.187395, -122.294116
  ),
  (
    '96d797d3-3139-4bcb-b8af-b1e1ee0664a4',
    'sl-96d797d33139',
    'RESCUE ME COFFEE',
    'brionna.junell@gmail.com',
    '1303 E Main Ave, Puyallup, WA 98372',
    47.191969, -122.277322
  ),
  (
    '753d952b-ca71-4854-be55-2b68a0765810',
    'sl-753d952bca71',
    'The Cat & Rabbitt',
    'julia@thecatandrabbitt.com',
    '111 E Stewart Ave, Puyallup, WA 98371',
    47.193213, -122.293064
  ),
  (
    'b44c3e1d-592c-4db3-b749-46da43d62714',
    'sl-b44c3e1d592c',
    'Wanna Cupcake? Bakery Cafe',
    'jim@wannacupcake.com',
    '2102 E Main Ave, Suite 112, Puyallup, WA 98372',
    47.191494, -122.266256
  ),
  (
    'a9041751-7da6-4e12-b014-2d6aaa16b9c2',
    'sl-a90417517da6',
    'XO Expresso',
    'xoexpressocoffee@outlook.com',
    '504 W Stewart Ave, Puyallup, WA 98371',
    47.193542, -122.299442
  );

do $checks$
declare
  v_missing int;
begin
  if (select count(*) from pin_targets) <> 7
     or exists (select 1 from pin_targets where business_id not like 'sl-%') then
    raise exception 'pin target list is not the seven sl- businesses';
  end if;

  select count(*) into v_missing
  from pin_targets t
  left join public.shop_listings l
    on l.id = t.listing_id
   and l.crawl_id = 'puy-coffee'
   and l.business_id = t.business_id
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
    from public.businesses b
    join pin_targets t on t.business_id = b.id
  ) <> 7 then
    raise exception 'an sl- business row is missing';
  end if;

  -- sync_listing_business would rename the business or replace logo_url.
  if exists (
    select 1
    from pin_targets t
    join public.businesses b on b.id = t.business_id
    where b.name is distinct from t.display_name
       or b.logo_url is not null
  ) then
    raise exception 'sync would rename a business or clear a logo';
  end if;

  if exists (
    select 1
    from pin_targets t
    join public.shop_listings l on l.id = t.listing_id
    where coalesce(array_length(l.photo_paths, 1), 0) > 0
  ) then
    raise exception 'listing has photos; sync would rewrite logo_url';
  end if;

  -- The helper re-asserts this status. Refuse unless it is already active,
  -- so the rewrite cannot change a membership.
  if exists (
    select 1
    from pin_targets t
    left join public.memberships m
      on m.crawl_id = 'puy-coffee'
     and m.business_id = t.business_id
     and m.status = 'active'
    where m.business_id is null
  ) then
    raise exception 'expected an active puy-coffee membership on each sl- business';
  end if;
end
$checks$;

do $lock$
begin
  perform l.id
  from public.shop_listings l
  join pin_targets t on t.listing_id = l.id
  for update of l;

  perform b.id
  from public.businesses b
  join pin_targets t on t.business_id = b.id
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

create temp table pin_counts (
  phase text primary key,
  paid_listings_with_business int not null,
  paid_listings_with_pin int not null,
  businesses_total int not null
) on commit drop;

insert into pin_counts
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

-- Direct pin on the sl- row only. store_code, qr_secret, name, and logo
-- are not in this SET. Seed ids cannot match business_id like 'sl-%'.
update public.businesses b
set
  address = case
    when nullif(btrim(b.address), '') is null then t.address
    else b.address
  end,
  lat = coalesce(b.lat, t.lat),
  lng = coalesce(b.lng, t.lng)
from pin_targets t
where b.id = t.business_id
  and b.id like 'sl-%'
  and (
    nullif(btrim(b.address), '') is null
    or b.lat is null
    or b.lng is null
  );

-- Listing pin, only where empty. business_id is already set, so this fires
-- shop_listings_after_update. The checks above make the helper's name, logo,
-- and membership writes keep the current values while it copies this pin.
update public.shop_listings l
set
  address = case
    when nullif(btrim(l.address), '') is null then t.address
    else l.address
  end,
  lat = coalesce(l.lat, t.lat),
  lng = coalesce(l.lng, t.lng)
from pin_targets t
where l.id = t.listing_id
  and l.crawl_id = 'puy-coffee'
  and l.business_id = t.business_id
  and l.is_paid is true
  and l.is_approved is true
  and l.owner_email = t.owner_email
  and (
    nullif(btrim(l.address), '') is null
    or l.lat is null
    or l.lng is null
  );

insert into pin_counts
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
       or l.business_id is distinct from b.business_id
       or l.photo_paths is distinct from b.photo_paths
  ) then
    raise exception 'a listing identity, link, or payment column changed';
  end if;

  if exists (
    select 1
    from public.shop_listings l
    join listing_before b on b.id = l.id
    where not exists (select 1 from pin_targets t where t.listing_id = l.id)
      and (
        l.address is distinct from b.address
        or l.lat is distinct from b.lat
        or l.lng is distinct from b.lng
      )
  ) then
    raise exception 'a listing outside these seven shops changed';
  end if;

  if exists (
    select 1
    from public.shop_listings l
    join pin_targets t on t.listing_id = l.id
    join listing_before prev on prev.id = l.id
    where l.address is distinct from case
            when nullif(btrim(prev.address), '') is null then t.address
            else prev.address
          end
       or l.lat is distinct from coalesce(prev.lat, t.lat)
       or l.lng is distinct from coalesce(prev.lng, t.lng)
       or l.lat is null
       or l.lng is null
       or nullif(btrim(l.address), '') is null
  ) then
    raise exception 'a listing pin was not filled, or an existing pin was overwritten';
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
    where not exists (select 1 from pin_targets t where t.business_id = b.id)
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
    raise exception 'a business outside these seven sl- rows changed';
  end if;

  if exists (
    select 1
    from pin_targets t
    join public.businesses b on b.id = t.business_id
    join business_before prev on prev.id = b.id
    where b.name is distinct from prev.name
       or b.type is distinct from prev.type
       or b.store_code is distinct from prev.store_code
       or md5(coalesce(b.qr_secret, '')) is distinct from prev.qr_hash
       or b.logo_url is distinct from prev.logo_url
       or b.owner_user_id is distinct from prev.owner_user_id
       or b.address is distinct from case
            when nullif(btrim(prev.address), '') is null then t.address
            else prev.address
          end
       or b.lat is distinct from coalesce(prev.lat, t.lat)
       or b.lng is distinct from coalesce(prev.lng, t.lng)
       or b.lat is null
       or b.lng is null
       or nullif(btrim(b.store_code), '') is null
       or nullif(btrim(b.qr_secret), '') is null
  ) then
    raise exception 'an sl- business pin, code, or QR secret is wrong';
  end if;

  if exists (
    select 1
    from public.memberships m
    join membership_before prev
      on prev.crawl_id = m.crawl_id
     and prev.business_id = m.business_id
    where m.status is distinct from prev.status
  )
  or (select count(*) from public.memberships) <> (select count(*) from membership_before)
  or exists (
    select 1
    from public.memberships m
    full join membership_before prev
      on prev.crawl_id = m.crawl_id
     and prev.business_id = m.business_id
    where m.business_id is null or prev.business_id is null
  ) then
    raise exception 'a membership changed';
  end if;

  if (select businesses_total from pin_counts where phase = 'after')
     <> (select businesses_total from pin_counts where phase = 'before') then
    raise exception 'businesses total changed';
  end if;

  if (select paid_listings_with_business from pin_counts where phase = 'after')
     <> (select paid_listings_with_business from pin_counts where phase = 'before') then
    raise exception 'paid listings with a business_id changed';
  end if;

  if (select paid_listings_with_pin from pin_counts where phase = 'after')
     <> (select paid_listings_with_pin from pin_counts where phase = 'before')
        + (
          select count(*)::int
          from pin_targets t
          join listing_before prev on prev.id = t.listing_id
          where prev.lat is null or prev.lng is null
        ) then
    raise exception 'paid listings with a pin changed by an unexpected amount';
  end if;
end
$verify$;

select phase, paid_listings_with_business, paid_listings_with_pin, businesses_total
from pin_counts
order by phase desc;

select
  l.display_name,
  l.business_id,
  (nullif(btrim(b.store_code), '') is not null) as has_code,
  (nullif(btrim(b.qr_secret), '') is not null) as has_qr,
  l.lat,
  l.lng,
  b.lat as business_lat,
  b.lng as business_lng
from public.shop_listings l
join pin_targets t on t.listing_id = l.id
join public.businesses b on b.id = l.business_id
order by l.display_name;

commit;
