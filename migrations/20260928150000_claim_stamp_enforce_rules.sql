-- Enforce stamp rules in public.claim_stamp.
--
-- Replaces the live function (same signature and return type). Apply this
-- file to the Hometown Crawls Supabase project (ref tatwbjuwufeqynpufodq)
-- after merge. Do not assume a deploy of the static site applies it.
--
-- Rules:
--   * Short store_code (case-insensitive) or exact qr_secret.
--   * One stamp per person per shop per crawl. A repeat claim does not
--     update or refresh the existing row; it raises 'Already stamped'.
--   * Player lat/lng is required ('Location required').
--   * If the shop has a pin, distance must be within 150 m
--     ('You need to be at the shop'). Shops with no coordinates are
--     allowed: there is no pin to measure against.
--   * A shop is claimable when it has an active membership on the crawl
--     or a paid and approved shop_listings row for that crawl.
-- Codes and pins are read from businesses and, when present, from the
-- listing (holiday shops store lat/lng on shop_listings; store_code and
-- qr_secret are accepted from either row).

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
  -- Single radius for every crawl. "Over 150 m" is refused.
  c_radius_m constant double precision := 150;
  v_uid uuid := auth.uid();
  v_biz jsonb;
  v_listing jsonb;
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
    select 1
    from public.crawl_joins j
    where j.user_id = v_uid
      and j.crawl_id = p_crawl
  ) then
    perform public.join_crawl(p_crawl);
  end if;

  select to_jsonb(b) into v_biz
  from public.businesses b
  where b.id = p_business;

  -- Holiday shops are paid shop_listings rows. business_id points at
  -- public.businesses. Listing jsonb keeps this working if store_code,
  -- qr_secret, lat, or lng live on the listing rather than the business.
  select to_jsonb(l) into v_listing
  from public.shop_listings l
  where l.crawl_id = p_crawl
    and l.business_id::text = p_business
    and l.is_paid is true
    and l.is_approved is true
  order by (l.lat is not null and l.lng is not null) desc
  limit 1;

  v_member := exists (
    select 1
    from public.memberships m
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

  if not v_match then
    raise exception 'Invalid code';
  end if;

  if p_lat is null or p_lng is null then
    raise exception 'Location required';
  end if;

  -- Prefer the listing pin (what the public map shows). Fall back to the
  -- business pin. If neither source has both coordinates, allow the claim:
  -- a shop that has not been geocoded has no point to measure 150 m from.
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

  -- Do not refresh claimed_at, lat, or lng when this person already
  -- stamped this shop on this crawl.
  if exists (
    select 1
    from public.stamps s
    where s.user_id = v_uid
      and s.crawl_id = p_crawl
      and s.business_id = p_business
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
