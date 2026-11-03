-- Store-tab totals for the signed-in shop owner.
-- Review and apply manually. This file is not run against production by the app.
-- A static-site deploy does not run it.
--
-- shop_my_listings already returns the caller's listings and nothing else.
-- This RPC adds the five Store-tab numbers for those same rows. Each row is
-- limited to that listing's crawl_id, so Arlington totals cannot mix into a
-- Puyallup listing (or the reverse).
--
-- players     crawl_joins on that crawl (one row per player; unique user+crawl)
-- scans       every stamp on that crawl
-- shop_scans  stamps on that crawl whose business_id is the listing's business
-- first_time  players whose earliest stamp on that crawl was at this business
--             (earliest claimed_at, then stamp id)
-- Share of scans is shop_scans / scans in the browser, same as the demo.
--
-- Ownership matches shop_my_listings: owner_user_id = auth.uid().
-- Crawl staff who do not own the listing keep using organizer_crawl_stats.
-- The function is security definer so the owner can read crawl-wide counts
-- that row level security would hide. It still returns only their listings.
-- search_path is empty and every table is schema-qualified.
--
-- Rollback (run only after review; not automatic):
--   drop function if exists public.shop_my_stats();

set local lock_timeout = '5s';

create or replace function public.shop_my_stats()
returns table (
  listing_id uuid,
  crawl_id text,
  players bigint,
  scans bigint,
  shop_scans bigint,
  first_time bigint
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated';
  end if;

  return query
  with mine as (
    select l.id, l.crawl_id, l.business_id, l.created_at
    from public.shop_listings l
    where l.owner_user_id = (select auth.uid())
  ),
  crawl_ids as (
    select distinct m.crawl_id
    from mine m
  ),
  player_counts as (
    select j.crawl_id, count(*)::bigint as n
    from public.crawl_joins j
    where j.crawl_id in (select c.crawl_id from crawl_ids c)
    group by j.crawl_id
  ),
  scan_counts as (
    select s.crawl_id, count(*)::bigint as n
    from public.stamps s
    where s.crawl_id in (select c.crawl_id from crawl_ids c)
    group by s.crawl_id
  ),
  shop_counts as (
    select s.crawl_id, s.business_id, count(*)::bigint as n
    from public.stamps s
    where s.crawl_id in (select c.crawl_id from crawl_ids c)
    group by s.crawl_id, s.business_id
  ),
  first_stamps as (
    select distinct on (s.crawl_id, s.user_id)
      s.crawl_id,
      s.business_id
    from public.stamps s
    where s.crawl_id in (select c.crawl_id from crawl_ids c)
    order by s.crawl_id, s.user_id, s.claimed_at asc, s.id asc
  ),
  first_counts as (
    select f.crawl_id, f.business_id, count(*)::bigint as n
    from first_stamps f
    group by f.crawl_id, f.business_id
  )
  select
    m.id,
    m.crawl_id,
    coalesce(p.n, 0)::bigint,
    coalesce(sc.n, 0)::bigint,
    case when m.business_id is null then 0::bigint else coalesce(ss.n, 0)::bigint end,
    case when m.business_id is null then 0::bigint else coalesce(fc.n, 0)::bigint end
  from mine m
  left join player_counts p on p.crawl_id = m.crawl_id
  left join scan_counts sc on sc.crawl_id = m.crawl_id
  left join shop_counts ss
    on ss.crawl_id = m.crawl_id
   and ss.business_id = m.business_id
  left join first_counts fc
    on fc.crawl_id = m.crawl_id
   and fc.business_id = m.business_id
  order by m.created_at desc;
end;
$function$;

revoke all on function public.shop_my_stats() from public;
revoke all on function public.shop_my_stats() from anon;
grant execute on function public.shop_my_stats() to authenticated;
