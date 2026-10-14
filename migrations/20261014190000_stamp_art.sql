-- Stamp image and logo for passport circles.
-- Review and apply manually. This file is not run against production by the app.
--
-- shop_listings gains stamp_image_path and logo_path. Files live in the
-- existing public shop-images bucket, under {listing_id}/stamp/ or
-- {listing_id}/logo/. Owner storage policies already limit writes to that
-- folder. Guests do not get an update grant on shop_listings.
--
-- get_public_crawl_shops and crawl_shops_public gain stamp_image_url and
-- logo_url at the end. shop_my_listings gains the raw paths at the end.
-- Both functions are dropped first because CREATE OR REPLACE cannot change
-- RETURNS TABLE. Grants are restored after each create.
--
-- Rollback (run only after review; not automatic):
--   drop function if exists public.shop_set_stamp_art(uuid, text, text);
--   drop view if exists public.crawl_shops_public;
--   drop function if exists public.get_public_crawl_shops(text);
--   drop function if exists public.shop_my_listings();
--   alter table public.shop_listings drop constraint if exists shop_listings_stamp_image_path_check;
--   alter table public.shop_listings drop constraint if exists shop_listings_logo_path_check;
--   alter table public.shop_listings drop column if exists stamp_image_path;
--   alter table public.shop_listings drop column if exists logo_path;
--   Then restore get_public_crawl_shops, crawl_shops_public, and
--   shop_my_listings from the previous definitions in this pull request.

set local lock_timeout = '5s';

alter table public.shop_listings
  add column if not exists stamp_image_path text,
  add column if not exists logo_path text;

alter table public.shop_listings
  drop constraint if exists shop_listings_stamp_image_path_check;
alter table public.shop_listings
  add constraint shop_listings_stamp_image_path_check
  check (
    stamp_image_path is null
    or stamp_image_path ~ ('^' || id::text || '/stamp/[A-Za-z0-9._-]+[.](png|jpg|jpeg|webp)$')
  );

alter table public.shop_listings
  drop constraint if exists shop_listings_logo_path_check;
alter table public.shop_listings
  add constraint shop_listings_logo_path_check
  check (
    logo_path is null
    or logo_path ~ ('^' || id::text || '/logo/[A-Za-z0-9._-]+[.](png|jpg|jpeg|webp)$')
  );

-- Owner-only write. Does not grant table update to authenticated.
create or replace function public.shop_set_stamp_art(
  p_listing uuid,
  p_kind text,
  p_path text
)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_path text := nullif(btrim(coalesce(p_path, '')), '');
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if v_kind not in ('stamp', 'logo') then
    raise exception 'Unknown art';
  end if;

  select l.owner_user_id into v_owner
  from public.shop_listings l
  where l.id = p_listing;

  if v_owner is null or v_owner <> v_uid then
    raise exception 'Not authorized';
  end if;

  if v_path is not null and v_path !~ ('^' || p_listing::text || '/' || v_kind || '/[A-Za-z0-9._-]+[.](png|jpg|jpeg|webp)$') then
    raise exception 'Use a PNG, JPG, or WebP image';
  end if;

  if v_kind = 'stamp' then
    update public.shop_listings
      set stamp_image_path = v_path,
          updated_at = now()
      where id = p_listing
        and owner_user_id = v_uid;
  else
    update public.shop_listings
      set logo_path = v_path,
          updated_at = now()
      where id = p_listing
        and owner_user_id = v_uid;
  end if;

  return v_path;
end;
$function$;

revoke all on function public.shop_set_stamp_art(uuid, text, text) from public;
revoke all on function public.shop_set_stamp_art(uuid, text, text) from anon;
grant execute on function public.shop_set_stamp_art(uuid, text, text) to authenticated;
grant execute on function public.shop_set_stamp_art(uuid, text, text) to service_role;

drop view if exists public.crawl_shops_public;
drop function if exists public.get_public_crawl_shops(text);

create function public.get_public_crawl_shops(p_crawl text default null)
returns table (
  listing_id uuid,
  crawl_id text,
  business_id text,
  display_name text,
  address text,
  lat double precision,
  lng double precision,
  hours text,
  blurb text,
  website text,
  instagram text,
  phone text,
  photo_urls text[],
  updated_at timestamp with time zone,
  stamp_image_url text,
  logo_url text
)
language sql
stable
security definer
set search_path to ''
as $function$
  select l.id, l.crawl_id, l.business_id, l.display_name, l.address, l.lat, l.lng, l.hours, l.blurb,
         l.website, l.instagram, l.phone,
         coalesce((select array_agg('https://tatwbjuwufeqynpufodq.supabase.co/storage/v1/object/public/shop-images/' || p order by ord)
                   from unnest(l.photo_paths) with ordinality as t(p, ord)
                   where p like l.id::text || '/%' and p not like '%..%'), '{}'::text[]),
         l.updated_at,
         case
           when l.stamp_image_path ~ ('^' || l.id::text || '/stamp/[A-Za-z0-9._-]+[.](png|jpg|jpeg|webp)$')
           then 'https://tatwbjuwufeqynpufodq.supabase.co/storage/v1/object/public/shop-images/' || l.stamp_image_path
           else null
         end,
         case
           when l.logo_path ~ ('^' || l.id::text || '/logo/[A-Za-z0-9._-]+[.](png|jpg|jpeg|webp)$')
           then 'https://tatwbjuwufeqynpufodq.supabase.co/storage/v1/object/public/shop-images/' || l.logo_path
           else null
         end
  from public.shop_listings l
  where l.is_paid and l.is_approved and (p_crawl is null or l.crawl_id = p_crawl)
  order by l.display_name;
$function$;

revoke all on function public.get_public_crawl_shops(text) from public;
grant execute on function public.get_public_crawl_shops(text) to anon;
grant execute on function public.get_public_crawl_shops(text) to authenticated;
grant execute on function public.get_public_crawl_shops(text) to service_role;

create view public.crawl_shops_public as
  select listing_id, crawl_id, business_id, display_name, address, lat, lng,
         hours, blurb, website, instagram, phone, photo_urls, updated_at,
         stamp_image_url, logo_url
  from public.get_public_crawl_shops(null);

grant select on public.crawl_shops_public to anon, authenticated;

drop function if exists public.shop_my_listings();

create function public.shop_my_listings()
returns table (
  listing_id uuid,
  crawl_id text,
  crawl_name text,
  crawl_starts_at timestamp with time zone,
  crawl_ends_at timestamp with time zone,
  signup_id uuid,
  display_name text,
  contact_name text,
  owner_email text,
  address text,
  lat double precision,
  lng double precision,
  hours text,
  blurb text,
  website text,
  instagram text,
  phone text,
  photo_paths text[],
  is_paid boolean,
  paid_at timestamp with time zone,
  is_approved boolean,
  price_cents integer,
  payment_link text,
  business_id text,
  store_code text,
  qr_secret text,
  stamp_image_path text,
  logo_path text
)
language sql
stable
security definer
set search_path to ''
as $function$
  select l.id, l.crawl_id, c.name, c.starts_at, c.ends_at, l.signup_id, l.display_name, l.contact_name,
         l.owner_email, l.address, l.lat, l.lng, l.hours, l.blurb, l.website, l.instagram, l.phone,
         l.photo_paths, l.is_paid, l.paid_at, l.is_approved, c.price_cents, c.payment_link, l.business_id,
         case when l.is_paid then b.store_code end, case when l.is_paid then b.qr_secret end,
         l.stamp_image_path, l.logo_path
  from public.shop_listings l
  join public.crawls c on c.id = l.crawl_id
  left join public.businesses b on b.id = l.business_id
  where l.owner_user_id = (select auth.uid())
  order by l.created_at desc;
$function$;

revoke all on function public.shop_my_listings() from public;
revoke all on function public.shop_my_listings() from anon;
grant execute on function public.shop_my_listings() to authenticated;
grant execute on function public.shop_my_listings() to service_role;
