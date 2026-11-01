-- Stamp geofence radius is 100 m.
-- Replaces public.claim_stamp with the same logic as
-- 20261014210000_per_crawl_codes_no_bypass.sql. Only c_radius_m changes,
-- from 50 to 100. Crawl-shop code matching, listing visibility, and the
-- other claim rules stay as they are.
-- Already applied on production (project tatwbjuwufeqynpufodq). This file
-- records that change. A static-site deploy does not apply it.

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
  -- Radius is 100 m.
  c_radius_m constant double precision := 100;
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
