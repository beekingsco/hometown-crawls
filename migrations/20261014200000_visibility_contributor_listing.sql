-- Visibility, contributor role, stamp labels, and owner listing saves.
-- Review and apply manually after 20261014190000_stamp_art.sql.
-- Do not run this against production from the app.
--
-- Chris Miller (chris@beekings.com) is already the owner of puy-coffee.
-- The contributor insert uses ON CONFLICT DO NOTHING and does not change
-- that owner row. Bryan Reynolds stays an organizer if that row exists.

set local lock_timeout = '5s';

alter table public.shop_listings
  add column if not exists stamp_image_path text,
  add column if not exists logo_path text,
  add column if not exists stamp_label text,
  add column if not exists is_visible boolean not null default true;

alter table public.shop_listings drop constraint if exists shop_listings_stamp_label_check;
alter table public.shop_listings
  add constraint shop_listings_stamp_label_check
  check (stamp_label is null or char_length(stamp_label) <= 40);

alter table public.crawl_organizers drop constraint if exists crawl_organizers_role_check;
alter table public.crawl_organizers
  add constraint crawl_organizers_role_check
  check (role = any (array['owner'::text, 'organizer'::text, 'co-organizer'::text, 'contributor'::text, 'viewer'::text]));

insert into public.organizers (email, name)
select 'bryan@myanthemcoffee.com', 'Bryan Reynolds'
where not exists (
  select 1 from public.organizers o where o.email = 'bryan@myanthemcoffee.com'
);

insert into public.crawl_organizers (crawl_id, organizer_id, role)
select 'puy-coffee', o.id, 'organizer'
from public.organizers o
where o.email = 'bryan@myanthemcoffee.com'
on conflict (crawl_id, organizer_id) do nothing;

insert into public.organizers (email, name)
select 'chris@beekings.com', 'Chris Miller'
where not exists (
  select 1 from public.organizers o where o.email = 'chris@beekings.com'
);

insert into public.crawl_organizers (crawl_id, organizer_id, role)
select 'puy-coffee', o.id, 'contributor'
from public.organizers o
where o.email = 'chris@beekings.com'
on conflict (crawl_id, organizer_id) do nothing;

create or replace function public.organizer_set_shop_visible(p_listing uuid, p_visible boolean)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_crawl text;
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select l.crawl_id into v_crawl
  from public.shop_listings l
  where l.id = p_listing;
  if v_crawl is null then
    raise exception 'Unknown listing';
  end if;
  select co.role into v_role
  from public.crawl_organizers co
  join public.organizers o on o.id = co.organizer_id
  where co.crawl_id = v_crawl
    and o.user_id = (select auth.uid());
  if v_role is null or v_role not in ('owner', 'organizer', 'co-organizer', 'contributor') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  update public.shop_listings
    set is_visible = coalesce(p_visible, false),
        updated_at = now()
    where id = p_listing;
end;
$function$;

revoke all on function public.organizer_set_shop_visible(uuid, boolean) from public;
revoke all on function public.organizer_set_shop_visible(uuid, boolean) from anon;
grant execute on function public.organizer_set_shop_visible(uuid, boolean) to authenticated;

-- Share columns stay in the signature and are always 0.
-- is_visible and scans are new return columns, so the old function is dropped first.
drop function if exists public.organizer_crawl_shops(text);

create function public.organizer_crawl_shops(p_crawl text)
returns table (
  listing_id uuid,
  signup_id uuid,
  display_name text,
  signup_business_name text,
  contact_name text,
  email text,
  phone text,
  applied_at timestamp with time zone,
  applied_pt text,
  is_paid boolean,
  paid_at timestamp with time zone,
  paid_pt text,
  payment_source text,
  amount_cents integer,
  organizer_share_cents integer,
  hc_share_cents integer,
  is_approved boolean,
  is_visible boolean,
  address text,
  website text,
  instagram text,
  business_id text,
  owner_linked boolean,
  photo_count integer,
  scans bigint
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not private.is_crawl_organizer(p_crawl) then
    raise exception 'Not an organizer of this crawl' using errcode = '42501';
  end if;
  return query
  select l.id, l.signup_id, l.display_name, s.business_name, coalesce(l.contact_name, s.contact_name),
         l.owner_email, coalesce(l.phone, s.phone), coalesce(s.created_at, l.created_at),
         to_char(coalesce(s.created_at, l.created_at) at time zone 'America/Los_Angeles', 'YYYY-MM-DD HH12:MI AM') || ' PT',
         l.is_paid, l.paid_at,
         case when l.paid_at is not null then to_char(l.paid_at at time zone 'America/Los_Angeles', 'YYYY-MM-DD HH12:MI AM') || ' PT' end,
         l.payment_source,
         case when l.is_paid then coalesce(l.amount_paid_cents, c.price_cents, s.amount_cents, 0) else 0 end,
         0,
         0,
         l.is_approved, l.is_visible, l.address, l.website, l.instagram, l.business_id,
         (l.owner_user_id is not null), coalesce(array_length(l.photo_paths, 1), 0),
         (select count(*)::bigint from public.stamps st
           where st.crawl_id = l.crawl_id and st.business_id = l.business_id)
  from public.shop_listings l
  join public.crawls c on c.id = l.crawl_id
  left join public.crawl_signups s on s.id = l.signup_id
  where l.crawl_id = p_crawl
  order by coalesce(s.created_at, l.created_at) desc;
end;
$function$;

create or replace function public.organizer_my_crawls()
returns table (
  crawl_id text,
  name text,
  city text,
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  role text,
  price_cents integer,
  payment_link text,
  applied bigint,
  paid bigint,
  visible bigint,
  gross_cents bigint
)
language sql
stable
security definer
set search_path to ''
as $function$
  select c.id, c.name, c.city, c.starts_at, c.ends_at, co.role, c.price_cents, c.payment_link,
         (select count(*) from public.shop_listings l where l.crawl_id = c.id),
         (select count(*) from public.shop_listings l where l.crawl_id = c.id and l.is_paid),
         (select count(*) from public.shop_listings l where l.crawl_id = c.id and l.is_paid and l.is_approved and l.is_visible),
         (select coalesce(sum(coalesce(l.amount_paid_cents, c.price_cents, 0)), 0)::bigint from public.shop_listings l where l.crawl_id = c.id and l.is_paid)
  from public.crawl_organizers co
  join public.organizers o on o.id = co.organizer_id
  join public.crawls c on c.id = co.crawl_id
  where o.user_id = (select auth.uid())
  order by c.starts_at nulls last, c.name;
$function$;

create or replace function public.organizer_update_crawl(p_crawl text, p_name text, p_starts date, p_ends date)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_role text;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select co.role into v_role
  from public.crawl_organizers co
  join public.organizers o on o.id = co.organizer_id
  where co.crawl_id = p_crawl
    and o.user_id = (select auth.uid());
  if v_role is null or v_role not in ('owner', 'organizer', 'co-organizer', 'contributor') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if v_name = '' or char_length(v_name) > 120 then
    raise exception 'Title needs 1 to 120 characters';
  end if;
  if p_starts is null or p_ends is null or p_ends < p_starts then
    raise exception 'End date needs to be on or after the start date';
  end if;
  update public.crawls
    set name = v_name,
        starts_at = p_starts::timestamptz,
        ends_at = p_ends::timestamptz
    where id = p_crawl;
end;
$function$;

revoke all on function public.organizer_update_crawl(text, text, date, date) from public;
revoke all on function public.organizer_update_crawl(text, text, date, date) from anon;
grant execute on function public.organizer_update_crawl(text, text, date, date) to authenticated;

create or replace function public.shop_save_listing(
  p_listing uuid,
  p_name text,
  p_address text,
  p_phone text,
  p_hours text,
  p_blurb text,
  p_website text,
  p_instagram text,
  p_stamp_label text
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_label text := nullif(btrim(coalesce(p_stamp_label, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (
    select 1 from public.shop_listings l
    where l.id = p_listing and l.owner_user_id = (select auth.uid())
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_website is not null and btrim(p_website) <> '' and p_website !~* '^https?://' then
    raise exception 'Website must start with http:// or https://';
  end if;
  if v_label is not null and char_length(v_label) > 40 then
    raise exception 'Stamp label needs to be 40 characters or fewer';
  end if;
  update public.shop_listings
    set display_name = left(btrim(coalesce(p_name, display_name)), 200),
        address = nullif(left(btrim(coalesce(p_address, '')), 300), ''),
        phone = nullif(left(btrim(coalesce(p_phone, '')), 40), ''),
        hours = nullif(left(btrim(coalesce(p_hours, '')), 500), ''),
        blurb = nullif(left(btrim(coalesce(p_blurb, '')), 600), ''),
        website = nullif(left(btrim(coalesce(p_website, '')), 300), ''),
        instagram = nullif(left(regexp_replace(btrim(coalesce(p_instagram, '')), '^@', ''), 100), ''),
        stamp_label = v_label,
        updated_at = now()
    where id = p_listing
      and owner_user_id = (select auth.uid());
end;
$function$;

revoke all on function public.shop_save_listing(uuid, text, text, text, text, text, text, text, text) from public;
revoke all on function public.shop_save_listing(uuid, text, text, text, text, text, text, text, text) from anon;
grant execute on function public.shop_save_listing(uuid, text, text, text, text, text, text, text, text) to authenticated;

create or replace function public.shop_set_photo_paths(p_listing uuid, p_paths text[])
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select l.id into v_id
  from public.shop_listings l
  where l.id = p_listing
    and l.owner_user_id = (select auth.uid());
  if v_id is null then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if coalesce(array_length(p_paths, 1), 0) > 8 then
    raise exception 'You can keep up to 8 photos';
  end if;
  if exists (
    select 1
    from unnest(coalesce(p_paths, '{}'::text[])) as p
    where p is null
       or p not like v_id::text || '/%'
       or p like '%..%'
       or p !~* '\.(png|jpe?g|webp)$'
  ) then
    raise exception 'Photo path is not allowed';
  end if;
  update public.shop_listings
    set photo_paths = coalesce(p_paths, '{}'::text[]),
        updated_at = now()
    where id = v_id
      and owner_user_id = (select auth.uid());
end;
$function$;

revoke all on function public.shop_set_photo_paths(uuid, text[]) from public;
revoke all on function public.shop_set_photo_paths(uuid, text[]) from anon;
grant execute on function public.shop_set_photo_paths(uuid, text[]) to authenticated;

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
  logo_url text,
  stamp_label text
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
         end,
         nullif(btrim(l.stamp_label), '')
  from public.shop_listings l
  where l.is_paid and l.is_approved and l.is_visible and (p_crawl is null or l.crawl_id = p_crawl)
  order by l.display_name;
$function$;

revoke all on function public.get_public_crawl_shops(text) from public;
grant execute on function public.get_public_crawl_shops(text) to anon, authenticated;

create view public.crawl_shops_public as
  select listing_id, crawl_id, business_id, display_name, address, lat, lng,
         hours, blurb, website, instagram, phone, photo_urls, updated_at,
         stamp_image_url, logo_url, stamp_label
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
  logo_path text,
  stamp_label text
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
         l.stamp_image_path, l.logo_path, l.stamp_label
  from public.shop_listings l
  join public.crawls c on c.id = l.crawl_id
  left join public.businesses b on b.id = l.business_id
  where l.owner_user_id = (select auth.uid())
  order by l.created_at desc;
$function$;

revoke all on function public.shop_my_listings() from public;
revoke all on function public.shop_my_listings() from anon;
grant execute on function public.shop_my_listings() to authenticated;
