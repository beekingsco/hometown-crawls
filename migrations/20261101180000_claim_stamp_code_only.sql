-- Guest stamps use the shop counter code or QR only.
-- Recreates the live public.claim_stamp on Hometown Crawls
-- (ref tatwbjuwufeqynpufodq) as of 2026-11-01.
-- Latitude and longitude stay optional and are stored when a caller sends them.
-- There is no device-location requirement and no distance reject.
-- Code match, crawl membership, auth, and already-stamped stay.
-- The organizer manual stamp path is not in this file.
-- Apply by hand. A static-site deploy does not run it.

set local lock_timeout = '5s';

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

  -- Location / GPS optional: no geofence during launch (Chris Nov 1, 2026)
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
