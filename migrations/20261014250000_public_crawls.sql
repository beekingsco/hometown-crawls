-- Public crawl directory. Apply manually. Do not run from the app.
-- Read-only list for the homepage search. Omits signup keys, payment
-- links, and prices. No anonymous writes.

set local lock_timeout = '5s';

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
as $function$
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
  where c.ends_at is null
     or c.ends_at >= now()
     or (c.starts_at is not null and c.starts_at > now());
$function$;

revoke all on function public.list_public_crawls() from public, anon, authenticated;
grant execute on function public.list_public_crawls() to anon, authenticated;
