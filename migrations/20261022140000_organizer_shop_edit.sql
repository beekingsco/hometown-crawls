-- Organizers can edit a paid shop listing on a crawl they staff.
-- Review and apply manually. This file is not run against production by the app.
--
-- shop_listings gains postal_code. The store owner and crawl staff
-- (private.is_crawl_staff: owner, organizer, co-organizer, contributor)
-- save it through security definer RPCs. Staff image uploads use a
-- storage policy that calls a security definer helper. No service role
-- is granted to the browser.
--
-- The Puyallup crawl display name is updated. The crawl id and the
-- /puyallup/holiday-coffee-crawl URL stay the same.
--
-- Rollback (run only after review; not automatic):
--   drop policy if exists shop_images_staff_insert on storage.objects;
--   drop policy if exists shop_images_staff_update on storage.objects;
--   drop policy if exists shop_images_staff_delete on storage.objects;
--   drop policy if exists shop_images_staff_select on storage.objects;
--   drop function if exists public.organizer_shop_listing(uuid);
--   drop function if exists private.can_manage_shop_image(text);
--   drop function if exists private.can_edit_shop_listing(uuid);
--   alter table public.shop_listings drop constraint if exists shop_listings_postal_code_check;
--   alter table public.shop_listings drop column if exists postal_code;
--   Then restore shop_save_listing, shop_set_photo_paths, shop_set_stamp_art,
--   shop_my_listings, get_public_crawl_shops, and crawl_shops_public from the
--   previous definitions.

set local lock_timeout = '5s';

alter table public.shop_listings
  add column if not exists postal_code text;

alter table public.shop_listings
  drop constraint if exists shop_listings_postal_code_check;
alter table public.shop_listings
  add constraint shop_listings_postal_code_check
  check (postal_code is null or postal_code ~ '^[0-9]{5}(-[0-9]{4})?$');

update public.crawls
  set name = 'Downtown Puyallup Holiday Coffee Crawl'
  where id = 'puy-coffee'
    and name is distinct from 'Downtown Puyallup Holiday Coffee Crawl';

create or replace function private.can_edit_shop_listing(p_listing uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1
    from public.shop_listings l
    where l.id = p_listing
      and (
        l.owner_user_id = (select auth.uid())
        or private.is_crawl_staff(l.crawl_id)
      )
  );
$function$;

revoke all on function private.can_edit_shop_listing(uuid) from public, anon, authenticated;

-- Storage policies run as the signed-in user and cannot see another shop's
-- row through shop_listings RLS. This helper reads the listing as definer.
create or replace function private.can_manage_shop_image(p_folder text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1
    from public.shop_listings l
    where l.id::text = p_folder
      and (
        l.owner_user_id = (select auth.uid())
        or private.is_crawl_staff(l.crawl_id)
      )
  );
$function$;

revoke all on function private.can_manage_shop_image(text) from public, anon;
grant execute on function private.can_manage_shop_image(text) to authenticated;

drop policy if exists shop_images_staff_insert on storage.objects;
create policy shop_images_staff_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'shop-images'
    and private.can_manage_shop_image((storage.foldername(name))[1])
  );

drop policy if exists shop_images_staff_update on storage.objects;
create policy shop_images_staff_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'shop-images'
    and private.can_manage_shop_image((storage.foldername(name))[1])
  )
  with check (
    bucket_id = 'shop-images'
    and private.can_manage_shop_image((storage.foldername(name))[1])
  );

drop policy if exists shop_images_staff_delete on storage.objects;
create policy shop_images_staff_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'shop-images'
    and private.can_manage_shop_image((storage.foldername(name))[1])
  );

drop policy if exists shop_images_staff_select on storage.objects;
create policy shop_images_staff_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'shop-images'
    and private.can_manage_shop_image((storage.foldername(name))[1])
  );

drop function if exists public.shop_save_listing(uuid, text, text, text, text, text, text, text, text);

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
  p_postal text default null
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_label text := nullif(btrim(coalesce(p_stamp_label, '')), '');
  v_postal text := nullif(regexp_replace(btrim(coalesce(p_postal, '')), '\s', '', 'g'), '');
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
        updated_at = now()
    where id = p_listing;
end;
$function$;

revoke all on function public.shop_save_listing(uuid, text, text, text, text, text, text, text, text, text) from public;
revoke all on function public.shop_save_listing(uuid, text, text, text, text, text, text, text, text, text) from anon;
grant execute on function public.shop_save_listing(uuid, text, text, text, text, text, text, text, text, text) to authenticated;

create or replace function public.shop_set_photo_paths(p_listing uuid, p_paths text[])
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not private.can_edit_shop_listing(p_listing) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if coalesce(array_length(p_paths, 1), 0) > 8 then
    raise exception 'You can keep up to 8 photos';
  end if;
  if exists (
    select 1
    from unnest(coalesce(p_paths, '{}'::text[])) as p
    where p is null
       or p not like p_listing::text || '/%'
       or p like '%..%'
       or p !~* '\.(png|jpe?g|webp)$'
  ) then
    raise exception 'Photo path is not allowed';
  end if;
  update public.shop_listings
    set photo_paths = coalesce(p_paths, '{}'::text[]),
        updated_at = now()
    where id = p_listing;
end;
$function$;

revoke all on function public.shop_set_photo_paths(uuid, text[]) from public;
revoke all on function public.shop_set_photo_paths(uuid, text[]) from anon;
grant execute on function public.shop_set_photo_paths(uuid, text[]) to authenticated;

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
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_path text := nullif(btrim(coalesce(p_path, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if v_kind not in ('stamp', 'logo') then
    raise exception 'Unknown art';
  end if;
  if not private.can_edit_shop_listing(p_listing) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if v_path is not null and v_path !~ ('^' || p_listing::text || '/' || v_kind || '/[A-Za-z0-9._-]+[.](png|jpg|jpeg|webp)$') then
    raise exception 'Use a PNG, JPG, or WebP image';
  end if;

  if v_kind = 'stamp' then
    update public.shop_listings
      set stamp_image_path = v_path,
          updated_at = now()
      where id = p_listing;
  else
    update public.shop_listings
      set logo_path = v_path,
          updated_at = now()
      where id = p_listing;
  end if;

  return v_path;
end;
$function$;

revoke all on function public.shop_set_stamp_art(uuid, text, text) from public;
revoke all on function public.shop_set_stamp_art(uuid, text, text) from anon;
grant execute on function public.shop_set_stamp_art(uuid, text, text) to authenticated;

create or replace function public.organizer_shop_listing(p_listing uuid)
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
  is_paid boolean
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
         l.website, l.instagram, l.stamp_label, l.photo_paths, l.stamp_image_path, l.logo_path, l.is_paid
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
  postal_code text
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
         l.stamp_image_path, l.logo_path, l.stamp_label, l.postal_code
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
  postal_code text
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
         l.postal_code
  from public.shop_listings l
  where l.is_paid and l.is_approved and l.is_visible and (p_crawl is null or l.crawl_id = p_crawl)
  order by l.display_name;
$function$;

revoke all on function public.get_public_crawl_shops(text) from public;
grant execute on function public.get_public_crawl_shops(text) to anon, authenticated;

create view public.crawl_shops_public as
  select listing_id, crawl_id, business_id, display_name, address, lat, lng,
         hours, blurb, website, instagram, phone, photo_urls, updated_at,
         stamp_image_url, logo_url, stamp_label, postal_code
  from public.get_public_crawl_shops(null);

grant select on public.crawl_shops_public to anon, authenticated;
