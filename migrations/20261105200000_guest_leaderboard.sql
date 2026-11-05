-- Guest leaderboard for one crawl at a time.
-- Review and apply manually. This file is not run against production by the app.
-- A static-site deploy does not run it.
--
-- Who is ranked: every public.crawl_joins row for that crawl_id. Someone who
-- stamped but never joined is left off. A stamp on a different crawl_id does
-- not count.
--
-- Score: distinct business_id in public.stamps for that crawl. Digital and
-- manual stamps both count (no filter on source). A second stamp at the same
-- shop does not raise the count. The time that shop counts is its earliest
-- claimed_at (then the smaller stamp id). The time they reached the count is
-- the latest of those first-stamp times. Ties break toward the earlier one,
-- then the earlier join, then user id.
--
-- Card total matches the guest passport:
--   puy-coffee and arl-coffee always use shop_listings, even when none are
--   live yet. loadShops() in assets/crawl.js does the same, so memberships
--   on puy-coffee are not the card.
--   Any other crawl with at least one paid, approved, visible listing uses
--   that distinct business_id count. That is get_public_crawl_shops.
--   A crawl with no such listing (puy-pub) uses active memberships whose
--   business still exists, which is the other branch of loadShops().
-- A card is complete when the distinct stamp count reaches that total and
-- the total is at least 1. completed_at is the claimed_at of the stamp that
-- made the count hit the total (the Nth new shop), not a later extra shop.
--
-- Store: the caller must own the listing (shop_listings.owner_user_id =
-- auth.uid()). The crawl id is read from that listing. The client cannot
-- pass a different crawl. Names are first name and last initial. Emails are
-- not returned. p_page is 1-based and each page holds 50 guests. The rank
-- on every page is the guest's place on the whole crawl.
-- Organizer: owner, organizer, or co-organizer of THIS crawl, the same
-- crawl_organizers + auth.uid() check as the weekly drawing. Contributors
-- and viewers cannot. The full name and email are included. Paging matches
-- the store board: 50 guests per page, ranks counted from the top.
--
-- Both public functions are security definer so the caller can read stamp
-- totals that row level security would hide. They still return one crawl.
-- search_path is empty and every table is schema-qualified. Private helpers
-- are not granted to anon or authenticated. Row level security is unchanged.
--
-- Rollback (run only after review; not automatic):
--   drop function if exists public.organizer_guest_leaderboard(text, integer);
--   drop function if exists public.organizer_guest_leaderboard(text, boolean);
--   drop function if exists public.shop_guest_leaderboard(uuid, integer);
--   drop function if exists public.shop_guest_leaderboard(uuid, boolean);
--   drop function if exists public.shop_guest_leaderboard(uuid);
--   drop function if exists private.leaderboard_window(integer, integer);
--   drop function if exists private.guest_leaderboard_payload(text);
--   drop function if exists private.crawl_card_total(text);
--   drop function if exists private.guest_short_name(text);
--   drop function if exists private.assert_leaderboard_reader(text);

set local lock_timeout = '5s';

create schema if not exists private;

create or replace function private.guest_short_name(p_name text)
returns text
language plpgsql
immutable
set search_path to ''
as $function$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_parts text[];
begin
  if v_name = '' or position('@' in v_name) > 0 then
    return 'Guest';
  end if;
  v_parts := pg_catalog.regexp_split_to_array(v_name, '\s+');
  if pg_catalog.cardinality(v_parts) <= 1 then
    return v_parts[1];
  end if;
  return v_parts[1] || ' ' || upper(left(v_parts[pg_catalog.cardinality(v_parts)], 1)) || '.';
end;
$function$;

comment on function private.guest_short_name(text) is
  'First name and last initial for the store leaderboard. A blank name or a name that contains @ becomes Guest, so an email is not used as the label.';

revoke all on function private.guest_short_name(text) from public;
revoke all on function private.guest_short_name(text) from anon;
revoke all on function private.guest_short_name(text) from authenticated;

create or replace function private.crawl_card_total(p_crawl text)
returns integer
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_crawl text := btrim(coalesce(p_crawl, ''));
  v_listing_shops integer := 0;
  v_membership_shops integer := 0;
begin
  select count(distinct l.business_id)::integer
    into v_listing_shops
  from public.shop_listings l
  where l.crawl_id = v_crawl
    and l.is_paid
    and l.is_approved
    and l.is_visible
    and nullif(btrim(l.business_id), '') is not null;

  if v_crawl in ('puy-coffee', 'arl-coffee') or v_listing_shops > 0 then
    return v_listing_shops;
  end if;

  select count(distinct m.business_id)::integer
    into v_membership_shops
  from public.memberships m
  join public.businesses b on b.id = m.business_id
  where m.crawl_id = v_crawl
    and m.status = 'active';

  return coalesce(v_membership_shops, 0);
end;
$function$;

comment on function private.crawl_card_total(text) is
  'Shops on the guest passport for one crawl. Paid, approved, visible shop_listings for listing crawls. Active memberships for the rest.';

revoke all on function private.crawl_card_total(text) from public;
revoke all on function private.crawl_card_total(text) from anon;
revoke all on function private.crawl_card_total(text) from authenticated;

create or replace function private.assert_leaderboard_reader(p_crawl text)
returns void
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_crawl text := btrim(coalesce(p_crawl, ''));
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_crawl = '' or not exists (
    select 1 from public.crawls c where c.id = v_crawl
  ) then
    raise exception 'Unknown crawl';
  end if;
  if not exists (
    select 1
    from public.crawl_organizers co
    join public.organizers o on o.id = co.organizer_id
    where co.crawl_id = v_crawl
      and o.user_id = (select auth.uid())
      and co.role in ('owner', 'organizer', 'co-organizer')
  ) then
    raise exception 'Only the owner, an organizer, or a co-organizer of this crawl can see the leaderboard'
      using errcode = '42501';
  end if;
end;
$function$;

comment on function private.assert_leaderboard_reader(text) is
  'Same crawl_organizers check as the weekly drawing: owner, organizer, or co-organizer of this crawl_id, matched to auth.uid().';

revoke all on function private.assert_leaderboard_reader(text) from public;
revoke all on function private.assert_leaderboard_reader(text) from anon;
revoke all on function private.assert_leaderboard_reader(text) from authenticated;

create or replace function private.guest_leaderboard_payload(p_crawl text)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_crawl text := btrim(coalesce(p_crawl, ''));
  v_shop_total integer := private.crawl_card_total(v_crawl);
  v_rows jsonb := '[]'::jsonb;
begin
  with first_hit as (
    select distinct on (s.user_id, s.business_id)
      s.user_id,
      s.business_id,
      s.claimed_at as first_at,
      s.id as stamp_id
    from public.stamps s
    where s.crawl_id = v_crawl
      and nullif(btrim(s.business_id), '') is not null
    order by s.user_id, s.business_id, s.claimed_at asc, s.id asc
  ),
  progress as (
    select
      f.user_id,
      count(*)::integer as stamp_count,
      max(f.first_at) as reached_at
    from first_hit f
    group by f.user_id
  ),
  nth as (
    select numbered.user_id, numbered.first_at
    from (
      select
        f.user_id,
        f.first_at,
        row_number() over (
          partition by f.user_id
          order by f.first_at asc, f.stamp_id asc
        ) as n
      from first_hit f
    ) numbered
    where v_shop_total > 0
      and numbered.n = v_shop_total
  ),
  people as (
    select distinct on (j.user_id)
      j.user_id,
      j.joined_at
    from public.crawl_joins j
    where j.crawl_id = v_crawl
    order by j.user_id, j.joined_at asc
  ),
  scored as (
    select
      people.user_id,
      people.joined_at,
      coalesce(progress.stamp_count, 0)::integer as stamp_count,
      progress.reached_at,
      case
        when coalesce(progress.stamp_count, 0) >= v_shop_total and v_shop_total > 0
          then nth.first_at
        else null
      end as completed_at
    from people
    left join progress on progress.user_id = people.user_id
    left join nth on nth.user_id = people.user_id
  ),
  ranked as (
    select
      row_number() over (
        order by scored.stamp_count desc,
                 scored.reached_at asc nulls last,
                 scored.joined_at asc nulls last,
                 scored.user_id asc
      )::bigint as place,
      scored.user_id,
      scored.stamp_count,
      scored.completed_at
    from scored
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'place', ranked.place,
        'profile_name', left(nullif(btrim(p.name), ''), 200),
        'email', left(coalesce(nullif(btrim(u.email::text), ''), ''), 320),
        'stamps', ranked.stamp_count,
        'completed_at', ranked.completed_at
      )
      order by ranked.place
    ),
    '[]'::jsonb
  )
    into v_rows
  from ranked
  left join public.profiles p on p.id = ranked.user_id
  left join auth.users u on u.id = ranked.user_id;

  return jsonb_build_object(
    'crawl_id', v_crawl,
    'shop_total', v_shop_total,
    'guest_count', jsonb_array_length(v_rows),
    'rows', v_rows
  );
end;
$function$;

comment on function private.guest_leaderboard_payload(text) is
  'Full leaderboard for one crawl_id, including emails. Callers must already have checked the shop owner or the organizer role for that same id.';

revoke all on function private.guest_leaderboard_payload(text) from public;
revoke all on function private.guest_leaderboard_payload(text) from anon;
revoke all on function private.guest_leaderboard_payload(text) from authenticated;

create or replace function private.leaderboard_window(p_count integer, p_page integer)
returns table (
  page integer,
  page_count integer,
  place_from integer,
  place_to integer
)
language sql
immutable
set search_path to ''
as $function$
  with sized as (
    select
      greatest(coalesce(p_count, 0), 0) as guests,
      greatest(coalesce(p_page, 1), 1) as asked
  ),
  bounded as (
    select guests, greatest(1, ceil(guests / 50.0)::integer) as pages, asked
    from sized
  )
  select
    least(bounded.asked, bounded.pages)::integer,
    bounded.pages::integer,
    ((least(bounded.asked, bounded.pages) - 1) * 50)::integer,
    (least(bounded.asked, bounded.pages) * 50)::integer
  from bounded;
$function$;

comment on function private.leaderboard_window(integer, integer) is
  'One page of 50. place_from is exclusive and place_to is inclusive, so page 2 is ranks 51 through 100.';

revoke all on function private.leaderboard_window(integer, integer) from public;
revoke all on function private.leaderboard_window(integer, integer) from anon;
revoke all on function private.leaderboard_window(integer, integer) from authenticated;

drop function if exists public.shop_guest_leaderboard(uuid, boolean);
drop function if exists public.shop_guest_leaderboard(uuid);

create or replace function public.shop_guest_leaderboard(
  p_listing uuid default null,
  p_page integer default 1
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_listing uuid := p_listing;
  v_crawl text;
  v_name text;
  v_payload jsonb;
  v_count integer := 0;
  v_page integer := 1;
  v_pages integer := 1;
  v_from integer := 0;
  v_to integer := 50;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if v_listing is null then
    select l.id
      into v_listing
    from public.shop_listings l
    where l.owner_user_id = v_uid
    order by l.created_at desc
    limit 1;
    if v_listing is null then
      raise exception 'No shop listing is linked to this account.' using errcode = '42501';
    end if;
  end if;

  select l.crawl_id, c.name
    into v_crawl, v_name
  from public.shop_listings l
  join public.crawls c on c.id = l.crawl_id
  where l.id = v_listing
    and l.owner_user_id = v_uid;

  if v_crawl is null then
    raise exception 'Only the shop owner can see this leaderboard.' using errcode = '42501';
  end if;

  v_payload := private.guest_leaderboard_payload(v_crawl);
  v_count := coalesce((v_payload->>'guest_count')::integer, 0);

  select w.page, w.page_count, w.place_from, w.place_to
    into v_page, v_pages, v_from, v_to
  from private.leaderboard_window(v_count, p_page) w;

  return jsonb_build_object(
    'crawl_id', v_crawl,
    'crawl_name', coalesce(v_name, ''),
    'shop_total', coalesce((v_payload->>'shop_total')::integer, 0),
    'guest_count', v_count,
    'page', v_page,
    'page_count', v_pages,
    'page_size', 50,
    'rows', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'rank', (entry->>'place')::integer,
            'name', private.guest_short_name(
              case
                when position('@' in coalesce(entry->>'profile_name', '')) > 0 then null
                else entry->>'profile_name'
              end
            ),
            'stamps', (entry->>'stamps')::integer,
            'completed_at', entry->'completed_at'
          )
          order by (entry->>'place')::integer
        ),
        '[]'::jsonb
      )
      from jsonb_array_elements(coalesce(v_payload->'rows', '[]'::jsonb)) entry
      where (entry->>'place')::integer > v_from
        and (entry->>'place')::integer <= v_to
    )
  );
end;
$function$;

comment on function public.shop_guest_leaderboard(uuid, integer) is
  'One page of guests on the crawl of a listing the caller owns. First name and last initial only. No email. Ranks count from the top of the crawl.';

revoke all on function public.shop_guest_leaderboard(uuid, integer) from public;
revoke all on function public.shop_guest_leaderboard(uuid, integer) from anon;
revoke all on function public.shop_guest_leaderboard(uuid, integer) from authenticated;
grant execute on function public.shop_guest_leaderboard(uuid, integer) to authenticated;

drop function if exists public.organizer_guest_leaderboard(text, boolean);

create or replace function public.organizer_guest_leaderboard(
  p_crawl text,
  p_page integer default 1
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_crawl text := btrim(coalesce(p_crawl, ''));
  v_name text;
  v_payload jsonb;
  v_count integer := 0;
  v_page integer := 1;
  v_pages integer := 1;
  v_from integer := 0;
  v_to integer := 50;
begin
  perform private.assert_leaderboard_reader(v_crawl);

  select c.name
    into v_name
  from public.crawls c
  where c.id = v_crawl;

  v_payload := private.guest_leaderboard_payload(v_crawl);
  v_count := coalesce((v_payload->>'guest_count')::integer, 0);

  select w.page, w.page_count, w.place_from, w.place_to
    into v_page, v_pages, v_from, v_to
  from private.leaderboard_window(v_count, p_page) w;

  return jsonb_build_object(
    'crawl_id', v_payload->>'crawl_id',
    'crawl_name', coalesce(v_name, ''),
    'shop_total', coalesce((v_payload->>'shop_total')::integer, 0),
    'guest_count', v_count,
    'page', v_page,
    'page_count', v_pages,
    'page_size', 50,
    'rows', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'rank', (entry->>'place')::integer,
            'name', left(
              coalesce(
                nullif(btrim(entry->>'profile_name'), ''),
                nullif(btrim(entry->>'email'), ''),
                'Guest'
              ),
              200
            ),
            'email', coalesce(entry->>'email', ''),
            'stamps', (entry->>'stamps')::integer,
            'completed_at', entry->'completed_at'
          )
          order by (entry->>'place')::integer
        ),
        '[]'::jsonb
      )
      from jsonb_array_elements(coalesce(v_payload->'rows', '[]'::jsonb)) entry
      where (entry->>'place')::integer > v_from
        and (entry->>'place')::integer <= v_to
    )
  );
end;
$function$;

comment on function public.organizer_guest_leaderboard(text, integer) is
  'One page of one crawl. Owner, organizer, or co-organizer only. Full name and email. Ranks count from the top of the crawl.';

revoke all on function public.organizer_guest_leaderboard(text, integer) from public;
revoke all on function public.organizer_guest_leaderboard(text, integer) from anon;
revoke all on function public.organizer_guest_leaderboard(text, integer) from authenticated;
grant execute on function public.organizer_guest_leaderboard(text, integer) to authenticated;

notify pgrst, 'reload schema';
