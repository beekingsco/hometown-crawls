-- Organizer feature switches. Apply manually. Do not run from the app.
--
-- crawls.settings defaults to {}. Missing switches are off, so the live
-- Puyallup guest experience stays as it is until an owner or organizer
-- turns a switch on for some other crawl.
--
-- Switches: guest_reviews, peoples_choice, completion_badge, completion_raffle.
-- Owners and organizers may write them. Co-organizers, contributors, and
-- viewers may not. The public read returns only those four booleans.
--
-- puy-coffee refuses any switch set to true. Reads for that crawl are
-- always off, even if a row were edited by hand.
--
-- Guest reviews stay pending until an owner or organizer approves them.
-- A people's-choice vote is allowed only for a shop that guest has stamped.
-- Paper stamps (source manual) count the same as phone stamps (source digital).
-- Completion uses paid, approved, visible shops that have a map pin.
-- The guest completion line is only: You're on the completion list.
--
-- Phone stamps still require a signed-in guest and a position within 50 meters.
-- Crawls other than puy-coffee also require a paid shop seat and a map pin.
-- puy-coffee keeps its current stamp rules so shops already on that crawl
-- are not refused a stamp they can claim today.
--
-- Optional staging crawl oly-coffee is inserted unlisted. It does not
-- appear in list_public_crawls. This file does not create any other city crawl.

set local lock_timeout = '5s';

alter table public.crawls
  add column if not exists settings jsonb;

update public.crawls
  set settings = '{}'::jsonb
  where settings is null;

alter table public.crawls
  alter column settings set default '{}'::jsonb;

alter table public.crawls
  alter column settings set not null;

comment on column public.crawls.settings is
  'Organizer feature switches. Missing keys are off. puy-coffee cannot turn a switch on.';

create or replace function private.feature_bool(p_in jsonb, p_key text, p_crawl text)
returns boolean
language plpgsql
immutable
set search_path to ''
as $body$
declare
  v_val jsonb;
begin
  if not (p_in ? p_key) then
    return false;
  end if;
  v_val := p_in -> p_key;
  if pg_catalog.jsonb_typeof(v_val) is distinct from 'boolean' then
    raise exception 'Feature values must be true or false';
  end if;
  if p_crawl = 'puy-coffee' and v_val = 'true'::jsonb then
    raise exception 'Puyallup crawl features stay off';
  end if;
  return v_val = 'true'::jsonb;
end;
$body$;

create or replace function private.normalize_crawl_settings(p_crawl text, p_settings jsonb)
returns jsonb
language plpgsql
immutable
set search_path to ''
as $body$
declare
  v_in jsonb := coalesce(p_settings, '{}'::jsonb);
begin
  if pg_catalog.jsonb_typeof(v_in) is distinct from 'object' then
    raise exception 'Feature settings must be an object';
  end if;
  return pg_catalog.jsonb_build_object(
    'guest_reviews', private.feature_bool(v_in, 'guest_reviews', p_crawl),
    'peoples_choice', private.feature_bool(v_in, 'peoples_choice', p_crawl),
    'completion_badge', private.feature_bool(v_in, 'completion_badge', p_crawl),
    'completion_raffle', private.feature_bool(v_in, 'completion_raffle', p_crawl)
  );
end;
$body$;

revoke all on function private.feature_bool(jsonb, text, text) from public, anon, authenticated;
revoke all on function private.normalize_crawl_settings(text, jsonb) from public, anon, authenticated;

create or replace function private.guard_crawl_settings()
returns trigger
language plpgsql
security definer
set search_path to ''
as $body$
begin
  new.settings := private.normalize_crawl_settings(new.id, new.settings);
  return new;
end;
$body$;

revoke all on function private.guard_crawl_settings() from public, anon, authenticated;

drop trigger if exists crawls_guard_settings on public.crawls;
create trigger crawls_guard_settings
  before insert or update of settings on public.crawls
  for each row
  execute function private.guard_crawl_settings();

create or replace function private.crawl_feature_on(p_crawl text, p_key text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $body$
  select case
    when p_crawl = 'puy-coffee' then false
    when p_key not in (
      'guest_reviews',
      'peoples_choice',
      'completion_badge',
      'completion_raffle'
    ) then false
    else coalesce((c.settings ->> p_key)::boolean, false)
  end
  from public.crawls c
  where c.id = p_crawl;
$body$;

revoke all on function private.crawl_feature_on(text, text) from public, anon, authenticated;

create or replace function private.require_feature_editor(p_crawl text)
returns void
language plpgsql
security definer
set search_path to ''
as $body$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.crawl_organizers co
    join public.organizers o on o.id = co.organizer_id
    where co.crawl_id = p_crawl
      and o.user_id = auth.uid()
      and co.role in ('owner', 'organizer')
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
end;
$body$;

revoke all on function private.require_feature_editor(text) from public, anon, authenticated;

create or replace function private.current_guest()
returns uuid
language plpgsql
stable
security definer
set search_path to ''
as $body$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if exists (
    select 1
    from auth.users u
    where u.id = v_uid
      and coalesce(u.is_anonymous, false)
  ) then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  return v_uid;
end;
$body$;

revoke all on function private.current_guest() from public, anon, authenticated;

create or replace function private.paid_pinned_shop(p_crawl text, p_business text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $body$
  select exists (
    select 1
    from public.shop_listings l
    where l.crawl_id = p_crawl
      and l.business_id::text = pg_catalog.btrim(coalesce(p_business, ''))
      and l.is_paid is true
      and l.is_approved is true
      and l.is_visible is true
      and l.lat is not null
      and l.lng is not null
  );
$body$;

revoke all on function private.paid_pinned_shop(text, text) from public, anon, authenticated;

-- Paper (manual) and phone (digital) stamps both count. Legacy rows with
-- a null source are treated as phone stamps.
create or replace function private.guest_stamped_shop(p_crawl text, p_user uuid, p_business text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $body$
  select exists (
    select 1
    from public.stamps s
    where s.crawl_id = p_crawl
      and s.user_id = p_user
      and s.business_id = pg_catalog.btrim(coalesce(p_business, ''))
      and coalesce(s.source, 'digital') in ('digital', 'manual')
  );
$body$;

revoke all on function private.guest_stamped_shop(text, uuid, text) from public, anon, authenticated;

create or replace function public.public_crawl_features(p_crawl text)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $body$
declare
  v_crawl text := pg_catalog.btrim(coalesce(p_crawl, ''));
  v_settings jsonb;
begin
  if v_crawl = 'puy-coffee' then
    return private.normalize_crawl_settings('puy-coffee', '{}'::jsonb);
  end if;
  select c.settings
    into v_settings
  from public.crawls c
  where c.id = v_crawl;
  if not found then
    return private.normalize_crawl_settings(v_crawl, '{}'::jsonb);
  end if;
  return private.normalize_crawl_settings(v_crawl, coalesce(v_settings, '{}'::jsonb));
end;
$body$;

revoke all on function public.public_crawl_features(text) from public, anon, authenticated;
grant execute on function public.public_crawl_features(text) to anon, authenticated;

create or replace function public.organizer_set_crawl_features(p_crawl text, p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $body$
declare
  v_crawl text := pg_catalog.btrim(coalesce(p_crawl, ''));
  v_next jsonb;
begin
  if not exists (select 1 from public.crawls c where c.id = v_crawl) then
    raise exception 'Unknown crawl';
  end if;
  perform private.require_feature_editor(v_crawl);
  if p_settings is null or pg_catalog.jsonb_typeof(p_settings) is distinct from 'object' then
    raise exception 'Feature settings must be an object';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_each(p_settings) as feature(key, value)
    where feature.key not in (
      'guest_reviews',
      'peoples_choice',
      'completion_badge',
      'completion_raffle'
    )
  ) then
    raise exception 'Unknown feature';
  end if;
  v_next := private.normalize_crawl_settings(v_crawl, p_settings);
  update public.crawls
    set settings = v_next
    where id = v_crawl;
  return v_next;
end;
$body$;

revoke all on function public.organizer_set_crawl_features(text, jsonb) from public, anon, authenticated;
grant execute on function public.organizer_set_crawl_features(text, jsonb) to authenticated;

create table if not exists public.shop_reviews (
  id uuid primary key default gen_random_uuid(),
  crawl_id text not null references public.crawls (id) on delete cascade,
  user_id uuid not null,
  business_id text not null,
  body text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint shop_reviews_status_check check (status = any (array['pending'::text, 'approved'::text, 'hidden'::text])),
  constraint shop_reviews_body_check check (char_length(btrim(body)) between 1 and 600),
  constraint shop_reviews_one_per_shop unique (crawl_id, user_id, business_id)
);

create index if not exists shop_reviews_crawl_status_idx
  on public.shop_reviews (crawl_id, status, created_at);

alter table public.shop_reviews enable row level security;
revoke all on public.shop_reviews from public, anon, authenticated;

create table if not exists public.peoples_choice_votes (
  crawl_id text not null references public.crawls (id) on delete cascade,
  user_id uuid not null,
  business_id text not null,
  created_at timestamptz not null default now(),
  primary key (crawl_id, user_id)
);

create index if not exists peoples_choice_votes_crawl_idx
  on public.peoples_choice_votes (crawl_id, business_id);

alter table public.peoples_choice_votes enable row level security;
revoke all on public.peoples_choice_votes from public, anon, authenticated;

create or replace function public.submit_shop_review(p_crawl text, p_business text, p_body text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $body$
declare
  v_uid uuid := private.current_guest();
  v_crawl text := pg_catalog.btrim(coalesce(p_crawl, ''));
  v_business text := pg_catalog.btrim(coalesce(p_business, ''));
  v_body text := pg_catalog.btrim(coalesce(p_body, ''));
  v_id uuid;
  v_status text;
begin
  if not coalesce(private.crawl_feature_on(v_crawl, 'guest_reviews'), false) then
    raise exception 'That feature is off';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 600 then
    raise exception 'Review needs 1 to 600 characters';
  end if;
  if not private.paid_pinned_shop(v_crawl, v_business) then
    raise exception 'That shop is not on this crawl';
  end if;
  if not private.guest_stamped_shop(v_crawl, v_uid, v_business) then
    raise exception 'Stamp this shop first';
  end if;
  insert into public.shop_reviews (crawl_id, user_id, business_id, body, status)
  values (v_crawl, v_uid, v_business, v_body, 'pending')
  on conflict (crawl_id, user_id, business_id) do update
    set body = excluded.body,
        status = 'pending',
        created_at = now()
  returning id, status into v_id, v_status;
  return pg_catalog.jsonb_build_object('id', v_id, 'status', v_status);
end;
$body$;

revoke all on function public.submit_shop_review(text, text, text) from public, anon, authenticated;
grant execute on function public.submit_shop_review(text, text, text) to authenticated;

create or replace function public.my_shop_reviews(p_crawl text)
returns table (
  id uuid,
  business_id text,
  body text,
  status text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path to ''
as $body$
declare
  v_uid uuid := auth.uid();
  v_crawl text := pg_catalog.btrim(coalesce(p_crawl, ''));
begin
  if v_uid is null then
    return;
  end if;
  if exists (
    select 1 from auth.users u
    where u.id = v_uid and coalesce(u.is_anonymous, false)
  ) then
    return;
  end if;
  return query
  select r.id, r.business_id, r.body, r.status, r.created_at
  from public.shop_reviews r
  where r.crawl_id = v_crawl
    and r.user_id = v_uid
  order by r.created_at desc;
end;
$body$;

revoke all on function public.my_shop_reviews(text) from public, anon, authenticated;
grant execute on function public.my_shop_reviews(text) to authenticated;

create or replace function public.public_shop_reviews(p_crawl text)
returns table (
  id uuid,
  business_id text,
  body text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path to ''
as $body$
declare
  v_crawl text := pg_catalog.btrim(coalesce(p_crawl, ''));
begin
  if not coalesce(private.crawl_feature_on(v_crawl, 'guest_reviews'), false) then
    return;
  end if;
  return query
  select r.id, r.business_id, r.body, r.created_at
  from public.shop_reviews r
  where r.crawl_id = v_crawl
    and r.status = 'approved'
  order by r.created_at desc;
end;
$body$;

revoke all on function public.public_shop_reviews(text) from public, anon, authenticated;
grant execute on function public.public_shop_reviews(text) to anon, authenticated;

create or replace function public.organizer_shop_reviews(p_crawl text)
returns table (
  id uuid,
  business_id text,
  shop_name text,
  body text,
  status text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path to ''
as $body$
declare
  v_crawl text := pg_catalog.btrim(coalesce(p_crawl, ''));
begin
  perform private.require_feature_editor(v_crawl);
  if not coalesce(private.crawl_feature_on(v_crawl, 'guest_reviews'), false) then
    return;
  end if;
  return query
  select
    r.id,
    r.business_id,
    coalesce((
      select l.display_name
      from public.shop_listings l
      where l.crawl_id = r.crawl_id
        and l.business_id::text = r.business_id
      order by l.is_paid desc
      limit 1
    ), r.business_id) as shop_name,
    r.body,
    r.status,
    r.created_at
  from public.shop_reviews r
  where r.crawl_id = v_crawl
  order by case r.status when 'pending' then 0 when 'approved' then 1 else 2 end, r.created_at desc;
end;
$body$;

revoke all on function public.organizer_shop_reviews(text) from public, anon, authenticated;
grant execute on function public.organizer_shop_reviews(text) to authenticated;

create or replace function public.organizer_set_review_status(p_review uuid, p_status text)
returns text
language plpgsql
security definer
set search_path to ''
as $body$
declare
  v_crawl text;
  v_status text := pg_catalog.btrim(coalesce(p_status, ''));
begin
  if v_status not in ('pending', 'approved', 'hidden') then
    raise exception 'Unknown review status';
  end if;
  select r.crawl_id into v_crawl
  from public.shop_reviews r
  where r.id = p_review;
  if v_crawl is null then
    raise exception 'Unknown review';
  end if;
  perform private.require_feature_editor(v_crawl);
  update public.shop_reviews
    set status = v_status
    where id = p_review;
  return v_status;
end;
$body$;

revoke all on function public.organizer_set_review_status(uuid, text) from public, anon, authenticated;
grant execute on function public.organizer_set_review_status(uuid, text) to authenticated;

create or replace function public.cast_peoples_choice(p_crawl text, p_business text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $body$
declare
  v_uid uuid := private.current_guest();
  v_crawl text := pg_catalog.btrim(coalesce(p_crawl, ''));
  v_business text := pg_catalog.btrim(coalesce(p_business, ''));
begin
  if not coalesce(private.crawl_feature_on(v_crawl, 'peoples_choice'), false) then
    raise exception 'That feature is off';
  end if;
  if not private.paid_pinned_shop(v_crawl, v_business) then
    raise exception 'That shop is not on this crawl';
  end if;
  if not private.guest_stamped_shop(v_crawl, v_uid, v_business) then
    raise exception 'Stamp this shop first';
  end if;
  insert into public.peoples_choice_votes (crawl_id, user_id, business_id)
  values (v_crawl, v_uid, v_business)
  on conflict (crawl_id, user_id) do update
    set business_id = excluded.business_id,
        created_at = now();
  return pg_catalog.jsonb_build_object('business_id', v_business);
end;
$body$;

revoke all on function public.cast_peoples_choice(text, text) from public, anon, authenticated;
grant execute on function public.cast_peoples_choice(text, text) to authenticated;

create or replace function public.my_peoples_choice(p_crawl text)
returns text
language plpgsql
stable
security definer
set search_path to ''
as $body$
declare
  v_uid uuid := auth.uid();
  v_crawl text := pg_catalog.btrim(coalesce(p_crawl, ''));
  v_business text;
begin
  if v_uid is null then
    return null;
  end if;
  if not coalesce(private.crawl_feature_on(v_crawl, 'peoples_choice'), false) then
    return null;
  end if;
  select v.business_id into v_business
  from public.peoples_choice_votes v
  where v.crawl_id = v_crawl
    and v.user_id = v_uid;
  return v_business;
end;
$body$;

revoke all on function public.my_peoples_choice(text) from public, anon, authenticated;
grant execute on function public.my_peoples_choice(text) to authenticated;

create or replace function public.peoples_choice_tally(p_crawl text)
returns table (
  business_id text,
  votes bigint
)
language plpgsql
stable
security definer
set search_path to ''
as $body$
declare
  v_crawl text := pg_catalog.btrim(coalesce(p_crawl, ''));
begin
  if not coalesce(private.crawl_feature_on(v_crawl, 'peoples_choice'), false) then
    return;
  end if;
  return query
  select v.business_id, count(*)::bigint as votes
  from public.peoples_choice_votes v
  where v.crawl_id = v_crawl
    and private.paid_pinned_shop(v.crawl_id, v.business_id)
    and exists (
      select 1
      from public.stamps s
      where s.crawl_id = v.crawl_id
        and s.user_id = v.user_id
        and s.business_id = v.business_id
        and coalesce(s.source, 'digital') in ('digital', 'manual')
    )
  group by v.business_id
  order by count(*) desc, v.business_id;
end;
$body$;

revoke all on function public.peoples_choice_tally(text) from public, anon, authenticated;
grant execute on function public.peoples_choice_tally(text) to anon, authenticated;

create or replace function public.my_crawl_completion(p_crawl text)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $body$
declare
  v_uid uuid := auth.uid();
  v_crawl text := pg_catalog.btrim(coalesce(p_crawl, ''));
  v_stops bigint := 0;
  v_stamped bigint := 0;
  v_complete boolean := false;
  v_line text := null;
begin
  if v_uid is not null and exists (
    select 1 from auth.users u
    where u.id = v_uid and coalesce(u.is_anonymous, false)
  ) then
    v_uid := null;
  end if;

  select count(*)::bigint into v_stops
  from (
    select distinct l.business_id::text as business_id
    from public.shop_listings l
    where l.crawl_id = v_crawl
      and l.is_paid is true
      and l.is_approved is true
      and l.is_visible is true
      and l.lat is not null
      and l.lng is not null
  ) stops;

  if v_uid is not null then
    select count(*)::bigint into v_stamped
    from (
      select distinct s.business_id
      from public.stamps s
      where s.user_id = v_uid
        and s.crawl_id = v_crawl
        and coalesce(s.source, 'digital') in ('digital', 'manual')
        and exists (
          select 1
          from public.shop_listings l
          where l.crawl_id = v_crawl
            and l.business_id::text = s.business_id
            and l.is_paid is true
            and l.is_approved is true
            and l.is_visible is true
            and l.lat is not null
            and l.lng is not null
        )
    ) stamped;
  end if;

  v_complete := v_stops > 0 and v_stamped = v_stops;
  if v_complete and coalesce(private.crawl_feature_on(v_crawl, 'completion_raffle'), false) then
    v_line := 'You''re on the completion list.';
  end if;

  return pg_catalog.jsonb_build_object(
    'stops', v_stops,
    'stamped', v_stamped,
    'complete', v_complete,
    'show_badge', v_complete and coalesce(private.crawl_feature_on(v_crawl, 'completion_badge'), false),
    'completion_line', v_line
  );
end;
$body$;

revoke all on function public.my_crawl_completion(text) from public, anon, authenticated;
grant execute on function public.my_crawl_completion(text) to anon, authenticated;

create or replace function public.organizer_completion_list(p_crawl text)
returns table (
  player_name text
)
language plpgsql
stable
security definer
set search_path to ''
as $body$
declare
  v_crawl text := pg_catalog.btrim(coalesce(p_crawl, ''));
  v_stops bigint;
begin
  perform private.require_feature_editor(v_crawl);
  if not coalesce(private.crawl_feature_on(v_crawl, 'completion_raffle'), false) then
    return;
  end if;

  select count(*)::bigint into v_stops
  from (
    select distinct l.business_id::text as business_id
    from public.shop_listings l
    where l.crawl_id = v_crawl
      and l.is_paid is true
      and l.is_approved is true
      and l.is_visible is true
      and l.lat is not null
      and l.lng is not null
  ) stops;

  if coalesce(v_stops, 0) = 0 then
    return;
  end if;

  return query
  select coalesce(nullif(pg_catalog.btrim(p.name), ''), 'Guest') as player_name
  from (
    select s.user_id
    from public.stamps s
    where s.crawl_id = v_crawl
      and coalesce(s.source, 'digital') in ('digital', 'manual')
      and exists (
        select 1
        from public.shop_listings l
        where l.crawl_id = v_crawl
          and l.business_id::text = s.business_id
          and l.is_paid is true
          and l.is_approved is true
          and l.is_visible is true
          and l.lat is not null
          and l.lng is not null
      )
    group by s.user_id
    having count(distinct s.business_id) = v_stops
  ) finished
  left join public.profiles p on p.id = finished.user_id
  order by 1;
end;
$body$;

revoke all on function public.organizer_completion_list(text) from public, anon, authenticated;
grant execute on function public.organizer_completion_list(text) to authenticated;

-- Phone stamps. Same signature as the live function.
-- puy-coffee keeps the previous pin exception. Every other crawl requires
-- a paid visible shop and a map pin, then the same 50 meter check.
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

  if exists (
    select 1
    from auth.users u
    where u.id = v_uid
      and coalesce(u.is_anonymous, false)
  ) then
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

  if p_crawl is distinct from 'puy-coffee' then
    if v_listing is null then
      raise exception 'Business not on this crawl';
    end if;
    if v_shop_lat is null or v_shop_lng is null then
      raise exception 'Map pin required';
    end if;
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

-- Paper stamps still skip the 50 meter check. The organizer is at the counter.
-- They count the same as phone stamps toward votes and completion.
-- puy-coffee keeps the previous shop check. Other crawls need a paid shop and a pin.
create or replace function public.organizer_set_manual_stamp(
  p_crawl text,
  p_user uuid,
  p_business text,
  p_on boolean
)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_source text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_user is null or btrim(coalesce(p_business, '')) = '' then
    raise exception 'Player and shop are required';
  end if;
  if not private.is_crawl_staff(p_crawl) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_crawl = 'puy-coffee' then
    if not exists (
      select 1
      from public.shop_listings l
      where l.crawl_id = p_crawl
        and l.business_id = p_business
        and l.is_paid
        and l.is_visible
    ) then
      raise exception 'Unknown shop';
    end if;
  else
    if not exists (
      select 1
      from public.shop_listings l
      where l.crawl_id = p_crawl
        and l.business_id = p_business
        and l.is_paid
        and l.is_approved
        and l.is_visible
    ) then
      raise exception 'Unknown shop';
    end if;
    if not exists (
      select 1
      from public.shop_listings l
      where l.crawl_id = p_crawl
        and l.business_id = p_business
        and l.is_paid
        and l.is_approved
        and l.is_visible
        and l.lat is not null
        and l.lng is not null
    ) then
      raise exception 'Map pin required';
    end if;
  end if;
  if not exists (
    select 1 from public.crawl_joins j
    where j.user_id = p_user and j.crawl_id = p_crawl
  ) then
    raise exception 'That player has not joined this crawl';
  end if;

  select s.source into v_source
  from public.stamps s
  where s.user_id = p_user
    and s.crawl_id = p_crawl
    and s.business_id = p_business;

  if coalesce(p_on, false) then
    if v_source is null then
      insert into public.stamps (user_id, crawl_id, business_id, source)
      values (p_user, p_crawl, p_business, 'manual');
      v_source := 'manual';
    end if;
  elsif v_source = 'manual' then
    delete from public.stamps s
    where s.user_id = p_user
      and s.crawl_id = p_crawl
      and s.business_id = p_business
      and s.source = 'manual';
    v_source := null;
  end if;

  return v_source;
end;
$function$;

revoke all on function public.organizer_set_manual_stamp(text, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.organizer_set_manual_stamp(text, uuid, text, boolean) to authenticated;

insert into public.crawls (
  id,
  name,
  city,
  state,
  postal_code,
  type,
  lat,
  lng,
  blurb,
  is_listed,
  price_cents,
  settings
)
values (
  'oly-coffee',
  'Olympia Coffee Crawl',
  'Olympia',
  'WA',
  '98501',
  'coffee',
  47.0379,
  -122.9007,
  'Staging crawl. Unlisted.',
  false,
  4999,
  '{}'::jsonb
)
on conflict (id) do update
  set is_listed = false;

insert into public.crawl_organizers (crawl_id, organizer_id, role)
select 'oly-coffee', o.id, 'owner'
from public.organizers o
where o.email = 'chris@beekings.com'
on conflict (crawl_id, organizer_id) do nothing;
