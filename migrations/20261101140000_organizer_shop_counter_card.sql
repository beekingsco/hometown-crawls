-- Organizers can view a shop counter code and QR secret for a crawl they staff.
-- Review and apply manually. This file is not run against production by the app.
-- Apply on staging first when a staging database exists, then production, and only
-- after the pull request is approved. The live site does not call this function
-- until the matching frontend is deployed.
--
-- crawl_shop_codes stays revoked from anon and authenticated. This security
-- definer RPC is the only new read path. It returns a row only when
-- private.is_crawl_staff(crawl_id) is true for the listing's crawl.
-- Codes use the same coalesce as shop_my_listings: crawl_shop_codes, then the
-- legacy businesses columns when the listing is paid. Unclaimed shops
-- (owner_user_id is null) are included. This function does not rotate codes.
--
-- Rollback (run only after review; not automatic):
--   drop function if exists public.organizer_shop_counter_card(uuid);

set local lock_timeout = '5s';

drop function if exists public.organizer_shop_counter_card(uuid);

create function public.organizer_shop_counter_card(p_listing uuid)
returns table (
  listing_id uuid,
  crawl_id text,
  display_name text,
  business_id text,
  is_paid boolean,
  store_code text,
  qr_secret text
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
  if not exists (
    select 1
    from public.shop_listings l
    where l.id = p_listing
      and private.is_crawl_staff(l.crawl_id)
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
  select l.id,
         l.crawl_id,
         l.display_name,
         l.business_id,
         l.is_paid,
         coalesce(k.store_code, case when l.is_paid then b.store_code end),
         coalesce(k.qr_secret, case when l.is_paid then b.qr_secret end)
  from public.shop_listings l
  left join public.businesses b on b.id = l.business_id
  left join public.crawl_shop_codes k on k.listing_id = l.id and k.crawl_id = l.crawl_id
  where l.id = p_listing;
end;
$function$;

comment on function public.organizer_shop_counter_card(uuid) is
  'Staff-only counter code and QR secret for one shop listing. Does not rotate codes.';

revoke all on function public.organizer_shop_counter_card(uuid) from public;
revoke all on function public.organizer_shop_counter_card(uuid) from anon;
grant execute on function public.organizer_shop_counter_card(uuid) to authenticated;

notify pgrst, 'reload schema';
