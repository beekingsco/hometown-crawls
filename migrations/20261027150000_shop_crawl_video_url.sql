-- Optional social video links for a shop listing and a crawl.
-- Stored as plain text. Public pages embed only after a known-host parse.
-- Apply manually. Do not run from the app.

set local lock_timeout = '5s';

alter table public.shop_listings
  add column if not exists video_url text;

alter table public.crawls
  add column if not exists video_url text;

comment on column public.shop_listings.video_url is
  'Optional https URL for a YouTube, Instagram, or TikTok video. Public pages embed it only through the official player parser.';

comment on column public.crawls.video_url is
  'Optional https URL for a YouTube, Instagram, or TikTok video. The crawl page embeds it only through the official player parser.';

create or replace function private.video_url_is_embeddable(p_url text)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  select p_url is not null
    and pg_catalog.char_length(p_url) between 1 and 500
    and p_url ~ '^https://'
    and pg_catalog.strpos(p_url, pg_catalog.chr(60)) = 0
    and pg_catalog.strpos(p_url, pg_catalog.chr(62)) = 0
    and pg_catalog.strpos(p_url, pg_catalog.chr(34)) = 0
    and pg_catalog.strpos(p_url, pg_catalog.chr(39)) = 0
    and pg_catalog.strpos(pg_catalog.split_part(pg_catalog.substr(p_url, 9), '/', 1), '@') = 0
    and pg_catalog.split_part(pg_catalog.split_part(pg_catalog.lower(pg_catalog.substr(p_url, 9)), '/', 1), ':', 1)
        ~ '^(www\.|m\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com|instagram\.com|tiktok\.com)$'
    and (
      p_url ~* '^https://(www\.|m\.)?youtube\.com/watch/?\?([^#]*&)?v=[A-Za-z0-9_-]{11}([&#]|$)'
      or p_url ~* '^https://(www\.|m\.)?youtube\.com/(shorts|embed|live|v)/[A-Za-z0-9_-]{11}([/?#]|$)'
      or p_url ~* '^https://(www\.)?youtu\.be/[A-Za-z0-9_-]{11}([/?#]|$)'
      or p_url ~* '^https://(www\.)?youtube-nocookie\.com/embed/[A-Za-z0-9_-]{11}([/?#]|$)'
      or p_url ~* '^https://(www\.)?instagram\.com/(reel|reels|p|tv)/[A-Za-z0-9_-]{5,30}([/?#]|$)'
      or p_url ~* '^https://(www\.)?instagram\.com/[A-Za-z0-9._]{1,30}/(reel|reels|p|tv)/[A-Za-z0-9_-]{5,30}([/?#]|$)'
      or p_url ~* '^https://(www\.|m\.)?tiktok\.com/@[A-Za-z0-9._]{1,30}/video/[0-9]{6,30}([/?#]|$)'
      or p_url ~* '^https://(www\.|m\.)?tiktok\.com/embed/v2/[0-9]{6,30}([/?#]|$)'
    );
$function$;

revoke all on function private.video_url_is_embeddable(text) from public, anon, authenticated;

alter table public.shop_listings
  drop constraint if exists shop_listings_video_url_check;

alter table public.shop_listings
  add constraint shop_listings_video_url_check
  check (
    video_url is null
    or (
      char_length(video_url) <= 500
      and private.video_url_is_embeddable(video_url)
    )
  );

alter table public.crawls
  drop constraint if exists crawls_video_url_check;

alter table public.crawls
  add constraint crawls_video_url_check
  check (
    video_url is null
    or (
      char_length(video_url) <= 500
      and private.video_url_is_embeddable(video_url)
    )
  );

drop function if exists public.shop_save_listing(uuid, text, text, text, text, text, text, text, text, text);

create function public.shop_save_listing(
  p_listing uuid,
  p_name text,
  p_address text,
  p_phone text,
  p_hours text,
  p_blurb text,
  p_website text,
  p_instagram text,
  p_stamp_label text,
  p_postal text default null,
  p_video_url text default null
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_label text := nullif(btrim(coalesce(p_stamp_label, '')), '');
  v_postal text := nullif(regexp_replace(btrim(coalesce(p_postal, '')), '\s', '', 'g'), '');
  v_video text := nullif(btrim(coalesce(p_video_url, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not private.can_edit_shop_listing(p_listing) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_website is not null and btrim(p_website) <> '' and p_website !~* '^https?://' then
    raise exception 'Website must start with http:// or https://';
  end if;
  if v_label is not null and char_length(v_label) > 40 then
    raise exception 'Stamp label needs to be 40 characters or fewer';
  end if;
  if v_postal is not null and v_postal !~ '^[0-9]{5}(-[0-9]{4})?$' then
    raise exception 'Zip code needs to be 5 digits';
  end if;
  if v_video is not null and char_length(v_video) > 500 then
    raise exception 'Video link needs to be 500 characters or fewer';
  end if;
  if v_video is not null and not private.video_url_is_embeddable(v_video) then
    raise exception 'Paste a YouTube, Instagram, or TikTok video URL';
  end if;
  update public.shop_listings
    set display_name = left(btrim(coalesce(p_name, display_name)), 200),
        address = nullif(left(btrim(coalesce(p_address, '')), 300), ''),
        postal_code = v_postal,
        phone = nullif(left(btrim(coalesce(p_phone, '')), 40), ''),
        hours = nullif(left(btrim(coalesce(p_hours, '')), 500), ''),
        blurb = nullif(left(btrim(coalesce(p_blurb, '')), 600), ''),
        website = nullif(left(btrim(coalesce(p_website, '')), 300), ''),
        instagram = nullif(left(regexp_replace(btrim(coalesce(p_instagram, '')), '^@', ''), 100), ''),
        stamp_label = v_label,
        video_url = v_video,
        updated_at = now()
    where id = p_listing;
end;
$function$;

revoke all on function public.shop_save_listing(uuid, text, text, text, text, text, text, text, text, text, text) from public;
revoke all on function public.shop_save_listing(uuid, text, text, text, text, text, text, text, text, text, text) from anon;
grant execute on function public.shop_save_listing(uuid, text, text, text, text, text, text, text, text, text, text) to authenticated;

drop function if exists public.organizer_update_crawl(text, text, date, date);

create function public.organizer_update_crawl(
  p_crawl text,
  p_name text,
  p_starts date,
  p_ends date,
  p_video_url text default null
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_role text;
  v_name text := btrim(coalesce(p_name, ''));
  v_video text := nullif(btrim(coalesce(p_video_url, '')), '');
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
  if v_video is not null and char_length(v_video) > 500 then
    raise exception 'Video link needs to be 500 characters or fewer';
  end if;
  if v_video is not null and not private.video_url_is_embeddable(v_video) then
    raise exception 'Paste a YouTube, Instagram, or TikTok video URL';
  end if;
  update public.crawls
    set name = v_name,
        starts_at = p_starts::timestamptz,
        ends_at = p_ends::timestamptz,
        video_url = v_video
    where id = p_crawl;
end;
$function$;

revoke all on function public.organizer_update_crawl(text, text, date, date, text) from public;
revoke all on function public.organizer_update_crawl(text, text, date, date, text) from anon;
grant execute on function public.organizer_update_crawl(text, text, date, date, text) to authenticated;

drop function if exists public.organizer_my_crawls();

create function public.organizer_my_crawls()
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
  gross_cents bigint,
  video_url text
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
         (select coalesce(sum(coalesce(l.amount_paid_cents, c.price_cents, 0)), 0)::bigint from public.shop_listings l where l.crawl_id = c.id and l.is_paid),
         c.video_url
  from public.crawl_organizers co
  join public.organizers o on o.id = co.organizer_id
  join public.crawls c on c.id = co.crawl_id
  where o.user_id = (select auth.uid())
  order by c.starts_at nulls last, c.name;
$function$;

revoke all on function public.organizer_my_crawls() from public, anon;
grant execute on function public.organizer_my_crawls() to authenticated;

drop function if exists public.organizer_shop_listing(uuid);

create function public.organizer_shop_listing(p_listing uuid)
returns table (
  listing_id uuid,
  crawl_id text,
  display_name text,
  address text,
  postal_code text,
  phone text,
  hours text,
  blurb text,
  website text,
  instagram text,
  stamp_label text,
  photo_paths text[],
  stamp_image_path text,
  logo_path text,
  is_paid boolean,
  video_url text
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (
    select 1
    from public.shop_listings l
    where l.id = p_listing
      and private.is_crawl_staff(l.crawl_id)
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
  select l.id, l.crawl_id, l.display_name, l.address, l.postal_code, l.phone, l.hours, l.blurb,
         l.website, l.instagram, l.stamp_label, l.photo_paths, l.stamp_image_path, l.logo_path, l.is_paid,
         l.video_url
  from public.shop_listings l
  where l.id = p_listing;
end;
$function$;

revoke all on function public.organizer_shop_listing(uuid) from public, anon;
grant execute on function public.organizer_shop_listing(uuid) to authenticated;

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
  stamp_label text,
  postal_code text,
  video_url text
)
language sql
stable
security definer
set search_path to ''
as $function$
  select l.id, l.crawl_id, c.name, c.starts_at, c.ends_at, l.signup_id, l.display_name, l.contact_name,
         l.owner_email, l.address, l.lat, l.lng, l.hours, l.blurb, l.website, l.instagram, l.phone,
         l.photo_paths, l.is_paid, l.paid_at, l.is_approved, c.price_cents, c.payment_link, l.business_id,
         coalesce(k.store_code, case when l.is_paid then b.store_code end),
         coalesce(k.qr_secret, case when l.is_paid then b.qr_secret end),
         l.stamp_image_path, l.logo_path, l.stamp_label, l.postal_code, l.video_url
  from public.shop_listings l
  join public.crawls c on c.id = l.crawl_id
  left join public.businesses b on b.id = l.business_id
  left join public.crawl_shop_codes k on k.listing_id = l.id and k.crawl_id = l.crawl_id
  where l.owner_user_id = (select auth.uid())
  order by l.created_at desc;
$function$;

revoke all on function public.shop_my_listings() from public;
revoke all on function public.shop_my_listings() from anon;
grant execute on function public.shop_my_listings() to authenticated;

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
  stamp_label text,
  postal_code text,
  video_url text
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
         nullif(btrim(l.stamp_label), ''),
         l.postal_code,
         case when private.video_url_is_embeddable(l.video_url) then l.video_url else null end
  from public.shop_listings l
  where l.is_paid and l.is_approved and l.is_visible and (p_crawl is null or l.crawl_id = p_crawl)
  order by l.display_name;
$function$;

revoke all on function public.get_public_crawl_shops(text) from public;
grant execute on function public.get_public_crawl_shops(text) to anon, authenticated;

create view public.crawl_shops_public as
  select listing_id, crawl_id, business_id, display_name, address, lat, lng,
         hours, blurb, website, instagram, phone, photo_urls, updated_at,
         stamp_image_url, logo_url, stamp_label, postal_code, video_url
  from public.get_public_crawl_shops(null);

revoke all on table public.crawl_shops_public from public, anon, authenticated;
grant select on public.crawl_shops_public to anon, authenticated;

notify pgrst, 'reload schema';
