-- Per-crawl daily limit for guest (digital) stamps.
-- Apply by hand. A static-site deploy does not run this file.
-- Depends on public.stamp_attempt_failures from
-- 20261105213000_stamp_failures_and_fix_requests.sql.
--
-- crawls.daily_stamp_limit defaults to 2. Null means that crawl has no cap.
-- claim_stamp counts only this crawl's stamps whose source is digital or
-- null, and whose claimed_at falls on today's date in America/Los_Angeles.
-- Manual stamps (organizer or stamp-fix approval, source manual) are not
-- counted and this check does not run on those insert paths.
-- At the limit, claim_stamp raises 'Daily limit' and puts the crawl's
-- number in the hint. The client logs that message through
-- log_stamp_attempt_failure, which stores reason daily_limit.

set local lock_timeout = '5s';

alter table public.crawls
  add column if not exists daily_stamp_limit integer default 2;

comment on column public.crawls.daily_stamp_limit is
  'Max digital stamps a guest can claim on this crawl per America/Los_Angeles day. Null means unlimited.';

alter table public.stamp_attempt_failures
  drop constraint if exists stamp_attempt_failures_reason_check;

alter table public.stamp_attempt_failures
  add constraint stamp_attempt_failures_reason_check check (
    reason = any (array[
      'not_signed_in'::text,
      'not_joined'::text,
      'bad_code'::text,
      'already_stamped'::text,
      'error'::text,
      'daily_limit'::text
    ])
  );

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
  elsif v_message ~* 'daily limit' then
    v_reason := 'daily_limit';
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
  v_limit integer;
  v_today integer;
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

  select c.daily_stamp_limit into v_limit
  from public.crawls c
  where c.id = p_crawl;

  if v_limit is not null then
    select count(*)::integer into v_today
    from public.stamps s
    where s.user_id = v_uid
      and s.crawl_id = p_crawl
      and coalesce(s.source, 'digital') = 'digital'
      and (s.claimed_at at time zone 'America/Los_Angeles')::date
          = (pg_catalog.now() at time zone 'America/Los_Angeles')::date;
    if coalesce(v_today, 0) >= v_limit then
      raise exception 'Daily limit' using hint = v_limit::text;
    end if;
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
