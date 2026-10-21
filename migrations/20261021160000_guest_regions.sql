-- One guest can join many crawls. guest_crawls stays keyed by (user_id, crawl_id).
-- Each participation stores the crawl's city/state/zip. Hidden crawls stay unlisted.
-- Area opt-in is stored only. This file does not send messages.
-- Guests still claim stamps through claim_stamp, which keeps the 50 m check.

set local lock_timeout = '5s';

alter table public.crawls
  add column if not exists state text,
  add column if not exists postal_code text,
  add column if not exists is_listed boolean not null default true;

update public.crawls
  set state = 'WA'
  where city ilike 'puyallup'
    and btrim(coalesce(state, '')) = '';

update public.crawls
  set is_listed = false
  where id = 'puy-pub';

alter table public.guest_crawls
  add column if not exists region_city text,
  add column if not exists region_state text,
  add column if not exists region_postal text,
  add column if not exists region_label text;

alter table public.profiles
  add column if not exists area_crawl_opt_in boolean not null default false,
  add column if not exists area_crawl_opt_in_at timestamptz;

create or replace function private.crawl_region(p_crawl text)
returns table (
  region_city text,
  region_state text,
  region_postal text,
  region_label text
)
language sql
stable
security definer
set search_path to ''
as $body$
  select
    nullif(pg_catalog.btrim(c.city), ''),
    nullif(pg_catalog.btrim(c.state), ''),
    nullif(pg_catalog.btrim(c.postal_code), ''),
    nullif(pg_catalog.concat_ws(
      ', ',
      nullif(pg_catalog.btrim(c.city), ''),
      nullif(pg_catalog.btrim(c.state), '')
    ), '')
  from public.crawls c
  where c.id = p_crawl;
$body$;

revoke all on function private.crawl_region(text) from public, anon, authenticated;

create or replace function public.list_public_crawls()
returns table (
  id text,
  name text,
  city text,
  type text,
  lat double precision,
  lng double precision,
  blurb text,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path to ''
as $body$
  select
    c.id,
    c.name,
    c.city,
    c.type,
    c.lat,
    c.lng,
    c.blurb,
    c.starts_at,
    c.ends_at,
    c.created_at
  from public.crawls c
  where c.is_listed
    and (c.ends_at is null or c.ends_at >= pg_catalog.now());
$body$;

revoke all on function public.list_public_crawls() from public, anon, authenticated;
grant execute on function public.list_public_crawls() to anon, authenticated;

drop function if exists public.record_guest_signup(text, text, text, boolean, boolean, text, boolean, boolean);

create function public.record_guest_signup(
  p_crawl text,
  p_name text,
  p_phone text,
  p_contact boolean,
  p_photo boolean,
  p_shop text,
  p_paper boolean,
  p_terms boolean,
  p_area boolean default false
)
returns void
language plpgsql
security definer
set search_path to ''
as $body$
declare
  v_uid uuid := auth.uid();
  v_name text := pg_catalog.left(pg_catalog.btrim(coalesce(p_name, '')), 80);
  v_phone text := pg_catalog.left(pg_catalog.btrim(coalesce(p_phone, '')), 40);
  v_digits text := pg_catalog.regexp_replace(v_phone, '\D', '', 'g');
  v_shop text := pg_catalog.btrim(coalesce(p_shop, ''));
  v_listing uuid;
  v_city text;
  v_state text;
  v_postal text;
  v_label text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_contact is not true then
    raise exception 'Prize contact approval is required';
  end if;
  if p_photo is not true then
    raise exception 'Photo promotional approval is required';
  end if;
  if v_name = '' then
    raise exception 'Name is required';
  end if;
  if v_digits ~ '^1\d{10}$' then
    v_digits := pg_catalog.substring(v_digits, 2);
  end if;
  if pg_catalog.char_length(v_digits) < 10 or pg_catalog.char_length(v_digits) > 15 then
    raise exception 'Enter a valid phone number';
  end if;
  if coalesce(p_paper, false) and p_terms is not true then
    raise exception 'Terms are required';
  end if;
  if not exists (select 1 from public.crawls c where c.id = p_crawl) then
    raise exception 'Unknown crawl';
  end if;

  select
    nullif(pg_catalog.btrim(c.city), ''),
    nullif(pg_catalog.btrim(c.state), ''),
    nullif(pg_catalog.btrim(c.postal_code), ''),
    nullif(pg_catalog.concat_ws(
      ', ',
      nullif(pg_catalog.btrim(c.city), ''),
      nullif(pg_catalog.btrim(c.state), '')
    ), '')
    into v_city, v_state, v_postal, v_label
  from public.crawls c
  where c.id = p_crawl;

  if v_shop ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select l.id into v_listing
    from public.shop_listings l
    where l.id = v_shop::uuid
      and l.crawl_id = p_crawl;
  end if;
  if v_listing is null and v_shop <> '' then
    select l.id into v_listing
    from public.shop_listings l
    where l.crawl_id = p_crawl
      and l.business_id = v_shop
    order by l.is_paid desc, l.is_visible desc, l.created_at
    limit 1;
  end if;

  perform public.join_crawl(p_crawl);

  insert into public.guest_crawls (
    user_id, crawl_id, play_mode, signup_listing_id, terms_accepted_at,
    region_city, region_state, region_postal, region_label
  )
  values (
    v_uid,
    p_crawl,
    case when coalesce(p_paper, false) then 'paper' else 'digital' end,
    v_listing,
    case when coalesce(p_paper, false) then pg_catalog.now() else null end,
    v_city, v_state, v_postal, v_label
  )
  on conflict (user_id, crawl_id) do update
    set play_mode = case
          when public.guest_crawls.play_mode = 'paper' or excluded.play_mode = 'paper' then 'paper'
          else 'digital'
        end,
        signup_listing_id = coalesce(excluded.signup_listing_id, public.guest_crawls.signup_listing_id),
        terms_accepted_at = coalesce(public.guest_crawls.terms_accepted_at, excluded.terms_accepted_at),
        region_city = excluded.region_city,
        region_state = excluded.region_state,
        region_postal = excluded.region_postal,
        region_label = excluded.region_label;

  update public.profiles
    set name = v_name,
        phone = v_phone,
        contact_consent = true,
        consented_at = pg_catalog.now(),
        photo_promo_consent = true,
        photo_promo_consented_at = pg_catalog.now(),
        area_crawl_opt_in = coalesce(p_area, false),
        area_crawl_opt_in_at = case
          when coalesce(p_area, false) then coalesce(public.profiles.area_crawl_opt_in_at, pg_catalog.now())
          else null
        end
    where id = v_uid;
  if not found then
    insert into public.profiles (
      id, name, phone, contact_consent, consented_at, photo_promo_consent, photo_promo_consented_at,
      area_crawl_opt_in, area_crawl_opt_in_at
    )
    values (
      v_uid, v_name, v_phone, true, pg_catalog.now(), true, pg_catalog.now(),
      coalesce(p_area, false),
      case when coalesce(p_area, false) then pg_catalog.now() else null end
    );
  end if;
end;
$body$;

revoke all on function public.record_guest_signup(text, text, text, boolean, boolean, text, boolean, boolean, boolean) from public, anon, authenticated;
grant execute on function public.record_guest_signup(text, text, text, boolean, boolean, text, boolean, boolean, boolean) to authenticated;

create or replace function public.join_listed_crawl(p_crawl text)
returns void
language plpgsql
security definer
set search_path to ''
as $body$
declare
  v_uid uuid := auth.uid();
  v_listed boolean;
  v_ends timestamptz;
  v_city text;
  v_state text;
  v_postal text;
  v_label text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (
    select 1
    from public.profiles p
    where p.id = v_uid
      and p.contact_consent
      and p.photo_promo_consent
  ) then
    raise exception 'Sign up before joining another crawl';
  end if;
  select c.is_listed, c.ends_at
    into v_listed, v_ends
  from public.crawls c
  where c.id = p_crawl;
  if not found then
    raise exception 'Unknown crawl';
  end if;
  if v_listed is not true then
    raise exception 'That crawl is not open';
  end if;
  if v_ends is not null and v_ends < pg_catalog.now() then
    raise exception 'That crawl has ended';
  end if;

  select
    nullif(pg_catalog.btrim(c.city), ''),
    nullif(pg_catalog.btrim(c.state), ''),
    nullif(pg_catalog.btrim(c.postal_code), ''),
    nullif(pg_catalog.concat_ws(
      ', ',
      nullif(pg_catalog.btrim(c.city), ''),
      nullif(pg_catalog.btrim(c.state), '')
    ), '')
    into v_city, v_state, v_postal, v_label
  from public.crawls c
  where c.id = p_crawl;

  perform public.join_crawl(p_crawl);

  insert into public.guest_crawls (
    user_id, crawl_id, play_mode, region_city, region_state, region_postal, region_label
  )
  values (v_uid, p_crawl, 'digital', v_city, v_state, v_postal, v_label)
  on conflict (user_id, crawl_id) do update
    set region_city = excluded.region_city,
        region_state = excluded.region_state,
        region_postal = excluded.region_postal,
        region_label = excluded.region_label;
end;
$body$;

revoke all on function public.join_listed_crawl(text) from public, anon, authenticated;
grant execute on function public.join_listed_crawl(text) to authenticated;

create or replace function public.guest_nearby_crawls()
returns table (
  id text,
  name text,
  city text,
  region_label text,
  starts_at timestamptz,
  ends_at timestamptz,
  distance_miles double precision
)
language sql
stable
security definer
set search_path to ''
as $body$
  with mine as (
    select c.id, c.city, c.state, c.lat, c.lng
    from public.crawl_joins j
    join public.crawls c on c.id = j.crawl_id
    where j.user_id = (select auth.uid())
  ),
  ranked as (
    select
      c.id,
      c.name,
      c.city,
      nullif(pg_catalog.concat_ws(', ', nullif(pg_catalog.btrim(c.city), ''), nullif(pg_catalog.btrim(c.state), '')), '') as region_label,
      c.starts_at,
      c.ends_at,
      (
        select pg_catalog.min(
          3958.8 * 2 * pg_catalog.asin(least(1::double precision, pg_catalog.sqrt(
            pg_catalog.power(pg_catalog.sin(pg_catalog.radians(c.lat - m.lat) / 2), 2)
            + pg_catalog.cos(pg_catalog.radians(m.lat)) * pg_catalog.cos(pg_catalog.radians(c.lat))
              * pg_catalog.power(pg_catalog.sin(pg_catalog.radians(c.lng - m.lng) / 2), 2)
          )))
        )
        from mine m
        where c.lat is not null and c.lng is not null and m.lat is not null and m.lng is not null
      ) as distance_miles
    from public.crawls c
    where (select auth.uid()) is not null
      and c.is_listed
      and (c.ends_at is null or c.ends_at >= pg_catalog.now())
      and not exists (select 1 from mine m where m.id = c.id)
      and exists (
        select 1
        from mine m
        where (
          pg_catalog.lower(pg_catalog.btrim(coalesce(c.city, ''))) = pg_catalog.lower(pg_catalog.btrim(coalesce(m.city, '')))
          and pg_catalog.btrim(coalesce(c.city, '')) <> ''
          and (
            pg_catalog.btrim(coalesce(c.state, '')) = ''
            or pg_catalog.btrim(coalesce(m.state, '')) = ''
            or pg_catalog.lower(pg_catalog.btrim(c.state)) = pg_catalog.lower(pg_catalog.btrim(m.state))
          )
        )
        or (
          c.lat is not null and c.lng is not null and m.lat is not null and m.lng is not null
          and (
            3958.8 * 2 * pg_catalog.asin(least(1::double precision, pg_catalog.sqrt(
              pg_catalog.power(pg_catalog.sin(pg_catalog.radians(c.lat - m.lat) / 2), 2)
              + pg_catalog.cos(pg_catalog.radians(m.lat)) * pg_catalog.cos(pg_catalog.radians(c.lat))
                * pg_catalog.power(pg_catalog.sin(pg_catalog.radians(c.lng - m.lng) / 2), 2)
            )))
          ) <= 50
        )
      )
  )
  select r.id, r.name, r.city, r.region_label, r.starts_at, r.ends_at, r.distance_miles
  from ranked r
  order by r.distance_miles nulls last, r.name
  limit 3;
$body$;

revoke all on function public.guest_nearby_crawls() from public, anon, authenticated;
grant execute on function public.guest_nearby_crawls() to authenticated;

create or replace function public.organizer_area_opt_ins(p_region text)
returns table (
  user_id uuid,
  player_name text,
  player_email text,
  player_phone text,
  crawl_id text,
  crawl_name text,
  region_label text,
  region_city text,
  region_state text,
  region_postal text,
  opted_in_at timestamptz
)
language plpgsql
stable
security definer
set search_path to ''
as $body$
declare
  v_region text := pg_catalog.replace(pg_catalog.replace(pg_catalog.btrim(coalesce(p_region, '')), '%', ''), '_', '');
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (
    select 1
    from public.crawl_organizers co
    join public.organizers o on o.id = co.organizer_id
    where o.user_id = (select auth.uid())
      and co.role in ('owner', 'organizer', 'co-organizer', 'contributor')
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
  select
    g.user_id,
    coalesce(p.name, ''),
    coalesce(u.email::text, ''),
    coalesce(p.phone, ''),
    g.crawl_id,
    coalesce(c.name, ''),
    coalesce(g.region_label, ''),
    coalesce(g.region_city, ''),
    coalesce(g.region_state, ''),
    coalesce(g.region_postal, ''),
    p.area_crawl_opt_in_at
  from public.guest_crawls g
  join public.crawls c on c.id = g.crawl_id
  join public.profiles p on p.id = g.user_id
  join auth.users u on u.id = g.user_id
  where p.area_crawl_opt_in
    and private.is_crawl_staff(g.crawl_id)
    and (
      v_region = ''
      or coalesce(g.region_label, '') ilike '%' || v_region || '%'
      or coalesce(g.region_city, '') ilike '%' || v_region || '%'
      or coalesce(g.region_state, '') ilike '%' || v_region || '%'
      or coalesce(g.region_postal, '') ilike '%' || v_region || '%'
    )
  order by coalesce(g.region_label, ''), coalesce(p.name, u.email::text), c.name
  limit 500;
end;
$body$;

revoke all on function public.organizer_area_opt_ins(text) from public, anon, authenticated;
grant execute on function public.organizer_area_opt_ins(text) to authenticated;
