-- One pending stamp-fix row per guest, crawl, and shop.
-- Apply by hand after 20261105213000_stamp_failures_and_fix_requests.sql.
-- A static-site deploy does not run this file.
--
-- stamp_fix_requests still stores the guest's note and the shop list.
-- stamp_fix_request_shops is one row per shop so a partial unique index
-- can reject a second pending request for the same user, crawl, and shop.
-- Approving the request marks those shop rows approved, which frees the
-- unique slot. A shop that is already stamped is rejected before insert.

set local lock_timeout = '5s';

create table if not exists public.stamp_fix_request_shops (
  request_id uuid not null references public.stamp_fix_requests (id) on delete cascade,
  user_id uuid not null,
  crawl_id text not null,
  business_id text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  primary key (request_id, business_id),
  constraint stamp_fix_request_shops_status_check check (
    status = any (array['pending'::text, 'approved'::text])
  )
);

create unique index if not exists stamp_fix_request_shops_one_pending
  on public.stamp_fix_request_shops (user_id, crawl_id, business_id)
  where status = 'pending';

alter table public.stamp_fix_request_shops enable row level security;
alter table public.stamp_fix_request_shops force row level security;
revoke all on table public.stamp_fix_request_shops from public, anon, authenticated;

insert into public.stamp_fix_request_shops (
  request_id, user_id, crawl_id, business_id, status, created_at
)
select distinct on (r.user_id, r.crawl_id, btrim(shop))
  r.id,
  r.user_id,
  r.crawl_id,
  btrim(shop),
  case when r.status = 'approved' then 'approved' else 'pending' end,
  r.created_at
from public.stamp_fix_requests r
cross join lateral unnest(r.business_ids) as shop
where btrim(coalesce(shop, '')) <> ''
order by r.user_id, r.crawl_id, btrim(shop), r.created_at
on conflict (request_id, business_id) do nothing;

create or replace function public.request_stamp_fix(
  p_crawl text,
  p_businesses text[],
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_ids text[];
  v_id uuid;
  v_shop text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (select 1 from public.crawls c where c.id = p_crawl) then
    raise exception 'Unknown crawl';
  end if;
  if not exists (
    select 1
    from public.crawl_joins j
    where j.user_id = v_uid
      and j.crawl_id = p_crawl
  ) then
    raise exception 'Not joined';
  end if;

  select coalesce(array_agg(shop_id order by shop_id), '{}'::text[])
    into v_ids
  from (
    select distinct btrim(x) as shop_id
    from unnest(coalesce(p_businesses, '{}'::text[])) as x
    where btrim(coalesce(x, '')) <> ''
  ) shops;

  if cardinality(v_ids) = 0 then
    raise exception 'Pick at least one shop';
  end if;
  if cardinality(v_ids) > 40 then
    raise exception 'Too many shops';
  end if;
  if exists (
    select 1
    from unnest(v_ids) as shop(id)
    where not private.shop_on_crawl(p_crawl, shop.id)
  ) then
    raise exception 'That shop is not on this crawl';
  end if;
  if exists (
    select 1
    from public.stamps s
    where s.user_id = v_uid
      and s.crawl_id = p_crawl
      and s.business_id = any (v_ids)
  ) then
    raise exception 'That shop is already stamped';
  end if;
  if exists (
    select 1
    from public.stamp_fix_request_shops s
    where s.user_id = v_uid
      and s.crawl_id = p_crawl
      and s.status = 'pending'
      and s.business_id = any (v_ids)
  ) then
    raise exception 'That shop is already pending';
  end if;

  insert into public.stamp_fix_requests (user_id, crawl_id, business_ids, note)
  values (v_uid, p_crawl, v_ids, left(btrim(coalesce(p_note, '')), 1000))
  returning id into v_id;

  begin
    foreach v_shop in array v_ids loop
      insert into public.stamp_fix_request_shops (
        request_id, user_id, crawl_id, business_id, status
      )
      values (v_id, v_uid, p_crawl, v_shop, 'pending');
    end loop;
  exception
    when unique_violation then
      raise exception 'That shop is already pending';
  end;

  return v_id;
end;
$fn$;

revoke all on function public.request_stamp_fix(text, text[], text) from public, anon, authenticated;
grant execute on function public.request_stamp_fix(text, text[], text) to authenticated;

create or replace function public.my_stamp_fix_requests(p_crawl text)
returns table (
  id uuid,
  crawl_id text,
  business_ids text[],
  note text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path to ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  return query
  select r.id, r.crawl_id, r.business_ids, r.note, r.created_at
  from public.stamp_fix_requests r
  where r.user_id = auth.uid()
    and r.crawl_id = p_crawl
    and r.status = 'pending'
  order by r.created_at desc;
end;
$fn$;

revoke all on function public.my_stamp_fix_requests(text) from public, anon, authenticated;
grant execute on function public.my_stamp_fix_requests(text) to authenticated;

create or replace function public.organizer_approve_stamp_fix(
  p_crawl text,
  p_request uuid
)
returns void
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_user uuid;
  v_ids text[];
  v_status text;
  v_shop text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not private.is_crawl_staff(p_crawl) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select r.user_id, r.business_ids, r.status
    into v_user, v_ids, v_status
  from public.stamp_fix_requests r
  where r.id = p_request
    and r.crawl_id = p_crawl;

  if not found then
    raise exception 'Unknown request';
  end if;
  if v_status = 'approved' then
    return;
  end if;
  if not exists (
    select 1
    from public.crawl_joins j
    where j.user_id = v_user
      and j.crawl_id = p_crawl
  ) then
    raise exception 'That player has not joined this crawl';
  end if;

  foreach v_shop in array v_ids loop
    if not private.shop_on_crawl(p_crawl, v_shop) then
      continue;
    end if;
    if exists (
      select 1
      from public.stamps s
      where s.user_id = v_user
        and s.crawl_id = p_crawl
        and s.business_id = v_shop
    ) then
      continue;
    end if;
    insert into public.stamps (user_id, crawl_id, business_id, source)
    values (v_user, p_crawl, v_shop, 'manual');
  end loop;

  update public.stamp_fix_request_shops
    set status = 'approved'
    where request_id = p_request
      and crawl_id = p_crawl
      and user_id = v_user
      and status = 'pending';

  update public.stamp_fix_requests
    set status = 'approved',
        resolved_at = pg_catalog.now(),
        resolved_by = auth.uid()
    where id = p_request
      and crawl_id = p_crawl
      and status = 'pending';
end;
$fn$;

revoke all on function public.organizer_approve_stamp_fix(text, uuid) from public, anon, authenticated;
grant execute on function public.organizer_approve_stamp_fix(text, uuid) to authenticated;
