-- Failed stamp attempts and guest stamp-fix requests.
-- Apply by hand. A static-site deploy does not run this file.
--
-- claim_stamp still raises on failure. PostgreSQL rolls that whole RPC
-- back, so a row inserted in the same call would disappear. Failures are
-- written by public.log_stamp_attempt_failure, a security definer logger
-- the site calls on its own after the attempt fails. That includes
-- not_signed_in, which never reaches claim_stamp.
--
-- Neither table is readable by anon or authenticated. Organizers read one
-- crawl at a time through the RPCs below. A request or failure for a
-- different crawl_id is not returned and cannot be approved.

set local lock_timeout = '5s';

create table if not exists public.stamp_attempt_failures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  crawl_id text not null,
  business_id text,
  code_entered text not null default '',
  reason text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  constraint stamp_attempt_failures_reason_check check (
    reason = any (array[
      'not_signed_in'::text,
      'not_joined'::text,
      'bad_code'::text,
      'already_stamped'::text,
      'error'::text
    ])
  )
);

create index if not exists stamp_attempt_failures_crawl_created_idx
  on public.stamp_attempt_failures (crawl_id, created_at desc);

alter table public.stamp_attempt_failures enable row level security;
alter table public.stamp_attempt_failures force row level security;
revoke all on table public.stamp_attempt_failures from public, anon, authenticated;

create table if not exists public.stamp_fix_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  crawl_id text not null,
  business_ids text[] not null,
  note text not null default '',
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  constraint stamp_fix_requests_status_check check (
    status = any (array['pending'::text, 'approved'::text])
  ),
  constraint stamp_fix_requests_shops_check check (cardinality(business_ids) > 0)
);

create index if not exists stamp_fix_requests_crawl_status_idx
  on public.stamp_fix_requests (crawl_id, status, created_at desc);

alter table public.stamp_fix_requests enable row level security;
alter table public.stamp_fix_requests force row level security;
revoke all on table public.stamp_fix_requests from public, anon, authenticated;

create or replace function private.shop_on_crawl(p_crawl text, p_business text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $fn$
  select exists (
    select 1
    from public.shop_listings l
    where l.crawl_id = p_crawl
      and l.business_id::text = p_business
      and l.is_paid is true
      and l.is_approved is true
      and l.is_visible is true
  )
  or exists (
    select 1
    from public.memberships m
    where m.crawl_id = p_crawl
      and m.business_id::text = p_business
      and m.status = 'active'
  );
$fn$;

revoke all on function private.shop_on_crawl(text, text) from public, anon, authenticated;

create or replace function public.log_stamp_attempt_failure(
  p_crawl text,
  p_business text,
  p_code text,
  p_message text,
  p_user_agent text
)
returns void
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_crawl text := btrim(coalesce(p_crawl, ''));
  v_message text := left(btrim(coalesce(p_message, '')), 500);
  v_reason text;
begin
  if v_crawl !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' then
    return;
  end if;
  if not exists (select 1 from public.crawls c where c.id = v_crawl) then
    return;
  end if;

  if auth.uid() is null then
    v_reason := 'not_signed_in';
  elsif v_message ~* 'already stamped' then
    v_reason := 'already_stamped';
  elsif v_message ~* 'invalid code|code required|unknown business|not on this crawl' then
    v_reason := 'bad_code';
  elsif v_message ~* 'not joined|has not joined|not a member' then
    v_reason := 'not_joined';
  elsif v_message ~* 'not authenticated|sign in with email' then
    v_reason := 'not_signed_in';
  else
    v_reason := 'error';
  end if;

  insert into public.stamp_attempt_failures (
    user_id, crawl_id, business_id, code_entered, reason, user_agent
  )
  values (
    auth.uid(),
    v_crawl,
    nullif(left(btrim(coalesce(p_business, '')), 80), ''),
    left(btrim(coalesce(p_code, '')), 120),
    v_reason,
    left(btrim(coalesce(p_user_agent, '')), 400)
  );
end;
$fn$;

revoke all on function public.log_stamp_attempt_failure(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.log_stamp_attempt_failure(text, text, text, text, text) to anon, authenticated;

create or replace function public.organizer_stamp_failures(p_crawl text)
returns table (
  id uuid,
  user_id uuid,
  crawl_id text,
  business_id text,
  code_entered text,
  reason text,
  user_agent text,
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
  if not private.is_crawl_staff(p_crawl) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
  select f.id, f.user_id, f.crawl_id, f.business_id, f.code_entered, f.reason, f.user_agent, f.created_at
  from public.stamp_attempt_failures f
  where f.crawl_id = p_crawl
  order by f.created_at desc
  limit 50;
end;
$fn$;

revoke all on function public.organizer_stamp_failures(text) from public, anon, authenticated;
grant execute on function public.organizer_stamp_failures(text) to authenticated;

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

  select coalesce(array_agg(distinct shop_id), '{}'::text[])
    into v_ids
  from (
    select btrim(x) as shop_id
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

  insert into public.stamp_fix_requests (user_id, crawl_id, business_ids, note)
  values (v_uid, p_crawl, v_ids, left(btrim(coalesce(p_note, '')), 1000))
  returning id into v_id;
  return v_id;
end;
$fn$;

revoke all on function public.request_stamp_fix(text, text[], text) from public, anon, authenticated;
grant execute on function public.request_stamp_fix(text, text[], text) to authenticated;

create or replace function public.organizer_list_stamp_fix_requests(p_crawl text)
returns table (
  id uuid,
  crawl_id text,
  user_id uuid,
  guest_email text,
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
  if not private.is_crawl_staff(p_crawl) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
  select r.id, r.crawl_id, r.user_id, u.email::text, r.business_ids, r.note, r.created_at
  from public.stamp_fix_requests r
  left join auth.users u on u.id = r.user_id
  where r.crawl_id = p_crawl
    and r.status = 'pending'
  order by r.created_at desc
  limit 50;
end;
$fn$;

revoke all on function public.organizer_list_stamp_fix_requests(text) from public, anon, authenticated;
grant execute on function public.organizer_list_stamp_fix_requests(text) to authenticated;

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

-- Same guest stamp path as 20261101180000, plus a stable "Not joined"
-- error when join_crawl cannot put this user on this crawl.
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
as $fn$
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
    begin
      perform public.join_crawl(p_crawl);
    exception
      when others then
        if sqlerrm ilike '%not authenticated%' then
          raise exception 'Not authenticated';
        end if;
        raise exception 'Not joined';
    end;
    if not exists (
      select 1 from public.crawl_joins j
      where j.user_id = v_uid and j.crawl_id = p_crawl
    ) then
      raise exception 'Not joined';
    end if;
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
$fn$;

revoke all on function public.claim_stamp(text, text, text, double precision, double precision) from public;
grant execute on function public.claim_stamp(text, text, text, double precision, double precision) to authenticated;
