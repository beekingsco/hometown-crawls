-- Close the no-selfie stamp path.
--
-- Apply this AFTER 20261006140000_checkin_selfies.sql AND after the new
-- front end is deployed. The new pages call start_checkin / complete_checkin
-- and never call claim_stamp.
--
-- If this file is applied first, check-in stops until the new pages are
-- live. That is safer than granting a stamp with no photo, and it does
-- break the previous check-in until the front end is deployed.
--
-- Same signature and return type as the live function. It does not insert.

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
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  raise exception 'A selfie is required';
end;
$function$;
