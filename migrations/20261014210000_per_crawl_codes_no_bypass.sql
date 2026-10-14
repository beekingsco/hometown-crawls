-- Per-crawl counter codes, and a claim_stamp with no demo location bypass.
-- Apply after 20261014200000_visibility_contributor_listing.sql.
-- Do not run this against production from the app.
--
-- Existing businesses.store_code values, including ANTHEMCO, keep working
-- until a crawl_shop_codes row exists for that shop. This file does not
-- backfill codes. ?demo=1 must not call shop_rotate_store_code.

set local lock_timeout = '5s';

alter table public.businesses drop column if exists demo_bypass_until;

create table if not exists public.crawl_shop_codes (
  id uuid primary key default extensions.gen_random_uuid(),
  crawl_id text not null references public.crawls (id) on delete cascade,
  listing_id uuid not null references public.shop_listings (id) on delete cascade,
  store_code text not null,
  qr_secret text not null,
  created_at timestamptz not null default now(),
  constraint crawl_shop_codes_listing_key unique (crawl_id, listing_id),
  constraint crawl_shop_codes_code_key unique (crawl_id, store_code),
  constraint crawl_shop_codes_code_check check (store_code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6,8}$')
);

alter table public.crawl_shop_codes enable row level security;

revoke all on public.crawl_shop_codes from public, anon, authenticated;

create or replace function public.shop_rotate_store_code(p_listing uuid)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_crawl text;
  v_code text;
  v_secret text;
  v_try int := 0;
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select l.crawl_id into v_crawl
  from public.shop_listings l
  where l.id = p_listing
    and l.owner_user_id = (select auth.uid());
  if v_crawl is null then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  loop
    v_try := v_try + 1;
    v_code := '';
    while char_length(v_code) < 8 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * char_length(v_alphabet))::int, 1);
    end loop;
    v_secret := encode(extensions.gen_random_bytes(18), 'hex');
    exit when not exists (
      select 1 from public.crawl_shop_codes k
      where k.crawl_id = v_crawl and k.store_code = v_code
    );
    if v_try > 8 then
      raise exception 'Could not generate a code';
    end if;
  end loop;
  insert into public.crawl_shop_codes (crawl_id, listing_id, store_code, qr_secret)
  values (v_crawl, p_listing, v_code, v_secret)
  on conflict (crawl_id, listing_id) do update
    set store_code = excluded.store_code,
        qr_secret = excluded.qr_secret,
        created_at = now();
  return v_code;
end;
$function$;

revoke all on function public.shop_rotate_store_code(uuid) from public;
revoke all on function public.shop_rotate_store_code(uuid) from anon;
grant execute on function public.shop_rotate_store_code(uuid) to authenticated;

create or replace function public.claim_stamp(
  p_crawl text,
  p_business text,
  p_code text,
  p_lat double precision default null,
  p_lng double precision default null
)
returns public.stamps
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  c_radius_m constant double precision := 50;
  v_uid uuid := auth.uid();
  v_biz jsonb;
  v_listing jsonb;
  v_code_row jsonb;
  v_row public.stamps;
  v_code text := btrim(coalesce(p_code, ''));
  v_store_biz text;
  v_store_listing text;
  v_qr_biz text;
  v_qr_listing text;
  v_shop_lat double precision;
  v_shop_lng double precision;
  v_dist_m double precision;
  v_member boolean := false;
  v_match boolean := false;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.crawl_joins j
    where j.user_id = v_uid and j.crawl_id = p_crawl
  ) then
    perform public.join_crawl(p_crawl);
  end if;

  select to_jsonb(b) into v_biz
  from public.businesses b
  where b.id = p_business;

  select to_jsonb(l) into v_listing
  from public.shop_listings l
  where l.crawl_id = p_crawl
    and l.business_id::text = p_business
    and l.is_paid is true
    and l.is_approved is true
    and l.is_visible is true
  order by (l.lat is not null and l.lng is not null) desc
  limit 1;

  v_member := exists (
    select 1 from public.memberships m
    where m.crawl_id = p_crawl
      and m.business_id = p_business
      and m.status = 'active'
  );

  if v_biz is null and v_listing is null then
    raise exception 'Unknown business';
  end if;
  if not v_member and v_listing is null then
    raise exception 'Business not on this crawl';
  end if;
  if v_code = '' then
    raise exception 'Code required';
  end if;

  v_store_biz := nullif(btrim(v_biz->>'store_code'), '');
  v_store_listing := nullif(btrim(v_listing->>'store_code'), '');
  v_qr_biz := nullif(btrim(v_biz->>'qr_secret'), '');
  v_qr_listing := nullif(btrim(v_listing->>'qr_secret'), '');

  if v_store_biz is not null and upper(v_store_biz) = upper(v_code) then
    v_match := true;
  elsif v_store_listing is not null and upper(v_store_listing) = upper(v_code) then
    v_match := true;
  elsif v_qr_biz is not null and v_qr_biz = v_code then
    v_match := true;
  elsif v_qr_listing is not null and v_qr_listing = v_code then
    v_match := true;
  end if;

  -- Once a per-crawl code exists, the legacy business code no longer matches.
  select to_jsonb(k) into v_code_row
  from public.crawl_shop_codes k
  join public.shop_listings l on l.id = k.listing_id
  where k.crawl_id = p_crawl
    and l.business_id::text = p_business
  limit 1;

  if v_code_row is not null then
    v_match := false;
    if upper(coalesce(v_code_row->>'store_code', '')) = upper(v_code) then
      v_match := true;
    elsif coalesce(v_code_row->>'qr_secret', '') = v_code then
      v_match := true;
    end if;
  end if;

  if not v_match then
    raise exception 'Invalid code';
  end if;

  if p_lat is null or p_lng is null then
    raise exception 'Location required';
  end if;

  if v_listing is not null
     and nullif(v_listing->>'lat', '') is not null
     and nullif(v_listing->>'lng', '') is not null then
    v_shop_lat := (v_listing->>'lat')::double precision;
    v_shop_lng := (v_listing->>'lng')::double precision;
  elsif v_biz is not null
     and nullif(v_biz->>'lat', '') is not null
     and nullif(v_biz->>'lng', '') is not null then
    v_shop_lat := (v_biz->>'lat')::double precision;
    v_shop_lng := (v_biz->>'lng')::double precision;
  end if;

  if v_shop_lat is not null and v_shop_lng is not null then
    v_dist_m := 6371000 * 2 * asin(sqrt(
      power(sin(radians(p_lat - v_shop_lat) / 2), 2) +
      cos(radians(v_shop_lat)) * cos(radians(p_lat)) *
      power(sin(radians(p_lng - v_shop_lng) / 2), 2)
    ));
    if v_dist_m > c_radius_m then
      raise exception 'You need to be at the shop';
    end if;
  end if;

  if exists (
    select 1 from public.stamps s
    where s.user_id = v_uid and s.crawl_id = p_crawl and s.business_id = p_business
  ) then
    raise exception 'Already stamped';
  end if;

  begin
    insert into public.stamps (user_id, crawl_id, business_id, lat, lng)
    values (v_uid, p_crawl, p_business, p_lat, p_lng)
    returning * into v_row;
  exception
    when unique_violation then
      raise exception 'Already stamped';
  end;

  return v_row;
end;
$function$;

revoke all on function public.claim_stamp(text, text, text, double precision, double precision) from public;
grant execute on function public.claim_stamp(text, text, text, double precision, double precision) to authenticated;

-- Prefer the per-crawl code once a row exists. Legacy businesses.store_code
-- stays the fallback, so ANTHEMCO still matches until a rotation.
create or replace function public.shop_my_listings()
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
         coalesce(k.store_code, case when l.is_paid then b.store_code end),
         coalesce(k.qr_secret, case when l.is_paid then b.qr_secret end),
         l.stamp_image_path, l.logo_path, l.stamp_label
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
