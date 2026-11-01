-- One-time makeup stamps for launch-day GPS misses.
-- Apply by hand on project tatwbjuwufeqynpufodq after review.
-- A static-site deploy does not run this file.
--
-- Depends on public.stamps.source from 20261014260000_paper_cards.sql.
-- Guest pages call get_makeup_claim and claim_makeup_stamp with the anon
-- key. The token in the URL is the secret and is bound to user_id, so the
-- guest does not sign in and the phone does not read location.
--
-- One makeup stamp per account per crawl (not per token):
--   * at most one unused token per (user_id, crawl_id)
--   * at most one used token per (user_id, crawl_id)
--   * a trigger blocks a new token once any token for that pair is used
--   * claim_makeup_stamp also refuses when a stamps row with source makeup
--     already exists for that account and crawl
--
-- Mint from the SQL editor (service role / table owner), one guest at a time:
--
--   insert into public.makeup_claim_tokens (crawl_id, user_id, expires_at)
--   select 'puy-coffee', u.id, now() + interval '72 hours'
--   from auth.users u
--   where u.email = 'guest@example.com'
--     and exists (
--       select 1 from public.crawl_joins j
--       where j.user_id = u.id and j.crawl_id = 'puy-coffee'
--     )
--   returning token,
--     'https://www.hometowncrawls.com/makeup?t=' || token as claim_url,
--     expires_at;
--
-- Or call public.issue_makeup_claim as the service role or the crawl owner.
-- That RPC requires a crawl_joins row and refreshes the open token instead
-- of inserting a second one. See docs/makeup-stamp.md.
--
-- Rollback (review first; not automatic). Do not drop stamps.source.
--   drop trigger if exists makeup_claim_tokens_one_allowance on public.makeup_claim_tokens;
--   drop function if exists private.makeup_claim_one_allowance();
--   drop function if exists public.claim_makeup_stamp(uuid, text);
--   drop function if exists public.get_makeup_claim(uuid);
--   drop function if exists public.issue_makeup_claim(text, uuid, integer);
--   drop function if exists private.makeup_crawl_shops(text);
--   drop function if exists private.can_issue_makeup_claim(text);
--   drop table if exists public.makeup_claim_tokens;
--   alter table public.stamps drop constraint if exists stamps_source_check;
--   alter table public.stamps add constraint stamps_source_check
--     check (source = any (array['digital'::text, 'manual'::text]));
--   The old check fails if any row still has source makeup. Delete those
--   stamps first only if Chris says the makeup stamps should come off.

set local lock_timeout = '5s';

alter table public.stamps
  add column if not exists source text not null default 'digital';

alter table public.stamps drop constraint if exists stamps_source_check;
alter table public.stamps
  add constraint stamps_source_check
  check (source = any (array['digital'::text, 'manual'::text, 'makeup'::text]));

create table if not exists public.makeup_claim_tokens (
  token uuid primary key default gen_random_uuid(),
  crawl_id text not null references public.crawls (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  claimed_business_id text,
  constraint makeup_claim_tokens_used_pair_check check (
    (used_at is null and claimed_business_id is null)
    or (
      used_at is not null
      and claimed_business_id is not null
      and btrim(claimed_business_id) <> ''
    )
  )
);

comment on table public.makeup_claim_tokens is
  'Secret one-time makeup stamp links. One open token and one used claim per guest per crawl.';

create unique index if not exists makeup_claim_tokens_one_open_idx
  on public.makeup_claim_tokens (user_id, crawl_id)
  where used_at is null;

create unique index if not exists makeup_claim_tokens_one_used_idx
  on public.makeup_claim_tokens (user_id, crawl_id)
  where used_at is not null;

alter table public.makeup_claim_tokens enable row level security;

revoke all on table public.makeup_claim_tokens from public, anon, authenticated;

drop policy if exists makeup_claim_tokens_select_own on public.makeup_claim_tokens;
create policy makeup_claim_tokens_select_own
  on public.makeup_claim_tokens
  for select
  to authenticated
  using (user_id = (select auth.uid()));

grant select on table public.makeup_claim_tokens to authenticated;

-- Paid, approved, visible listings that have a map pin. Same shops the
-- guest passport map can draw. business_id is the stamp key.
create or replace function private.makeup_crawl_shops(p_crawl text)
returns table (id text, name text)
language sql
stable
security definer
set search_path to ''
as $function$
  select s.id, s.name
  from (
    select distinct on (l.business_id)
      l.business_id as id,
      coalesce(nullif(btrim(l.display_name), ''), 'Shop') as name
    from public.shop_listings l
    where l.crawl_id = p_crawl
      and l.is_paid is true
      and l.is_approved is true
      and l.is_visible is true
      and l.lat is not null
      and l.lng is not null
      and nullif(btrim(l.business_id), '') is not null
    order by l.business_id, l.display_name
  ) s
  order by s.name, s.id;
$function$;

revoke all on function private.makeup_crawl_shops(text) from public, anon, authenticated;

create or replace function private.can_issue_makeup_claim(p_crawl text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select auth.role() = 'service_role'
    or exists (
      select 1
      from public.crawl_organizers co
      join public.organizers o on o.id = co.organizer_id
      where co.crawl_id = p_crawl
        and o.user_id = (select auth.uid())
        and co.role = 'owner'
    );
$function$;

revoke all on function private.can_issue_makeup_claim(text) from public, anon, authenticated;

create or replace function private.makeup_claim_one_allowance()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if exists (
    select 1
    from public.makeup_claim_tokens t
    where t.user_id = new.user_id
      and t.crawl_id = new.crawl_id
      and t.token is distinct from new.token
      and t.used_at is not null
  ) then
    raise exception 'One makeup stamp per guest on this crawl'
      using errcode = '23505';
  end if;
  return new;
end;
$function$;

revoke all on function private.makeup_claim_one_allowance() from public, anon, authenticated;

drop trigger if exists makeup_claim_tokens_one_allowance on public.makeup_claim_tokens;
create trigger makeup_claim_tokens_one_allowance
  before insert or update on public.makeup_claim_tokens
  for each row
  execute function private.makeup_claim_one_allowance();

create or replace function public.get_makeup_claim(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_token public.makeup_claim_tokens%rowtype;
  v_used_business text;
  v_makeup_business text;
  v_crawl_name text;
  v_shop_name text;
  v_shops jsonb;
  v_closed boolean := false;
begin
  if p_token is null then
    return jsonb_build_object('status', 'invalid');
  end if;

  select * into v_token
  from public.makeup_claim_tokens t
  where t.token = p_token;
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;

  select c.name into v_crawl_name
  from public.crawls c
  where c.id = v_token.crawl_id;

  select t.claimed_business_id into v_used_business
  from public.makeup_claim_tokens t
  where t.user_id = v_token.user_id
    and t.crawl_id = v_token.crawl_id
    and t.used_at is not null
  order by t.used_at
  limit 1;
  if found then
    v_closed := true;
  end if;

  select s.business_id into v_makeup_business
  from public.stamps s
  where s.user_id = v_token.user_id
    and s.crawl_id = v_token.crawl_id
    and s.source = 'makeup'
  order by s.claimed_at
  limit 1;
  if found then
    v_closed := true;
  end if;

  if v_token.used_at is not null or v_closed then
    if v_used_business is not null then
      select shops.name into v_shop_name
      from private.makeup_crawl_shops(v_token.crawl_id) shops
      where shops.id = v_used_business;
    end if;
    if v_shop_name is null and v_makeup_business is not null then
      select shops.name into v_shop_name
      from private.makeup_crawl_shops(v_token.crawl_id) shops
      where shops.id = v_makeup_business;
    end if;
    return jsonb_build_object(
      'status', 'used',
      'crawl_id', v_token.crawl_id,
      'crawl_name', v_crawl_name,
      'business_id', coalesce(v_used_business, v_makeup_business),
      'business_name', v_shop_name,
      'shops', '[]'::jsonb
    );
  end if;

  if v_token.expires_at <= now() then
    return jsonb_build_object(
      'status', 'expired',
      'crawl_id', v_token.crawl_id,
      'crawl_name', v_crawl_name,
      'shops', '[]'::jsonb
    );
  end if;

  select coalesce(
    jsonb_agg(jsonb_build_object('id', shops.id, 'name', shops.name) order by shops.name, shops.id),
    '[]'::jsonb
  )
  into v_shops
  from private.makeup_crawl_shops(v_token.crawl_id) shops;

  return jsonb_build_object(
    'status', 'ready',
    'crawl_id', v_token.crawl_id,
    'crawl_name', v_crawl_name,
    'shops', v_shops
  );
end;
$function$;

comment on function public.get_makeup_claim(uuid) is
  'Looks up a makeup link. ready includes stampable shops. used, expired, and invalid do not. Anon may call it. The token is the secret.';

revoke all on function public.get_makeup_claim(uuid) from public;
grant execute on function public.get_makeup_claim(uuid) to anon, authenticated;

create or replace function public.claim_makeup_stamp(p_token uuid, p_business text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_token public.makeup_claim_tokens%rowtype;
  v_business text := btrim(coalesce(p_business, ''));
  v_user uuid;
  v_crawl text;
  v_crawl_name text;
  v_shop_name text;
  v_makeup_business text;
  v_sibling_business text;
  v_has_sibling boolean := false;
  v_has_makeup boolean := false;
begin
  if p_token is null then
    return jsonb_build_object('status', 'invalid');
  end if;

  select t.user_id, t.crawl_id into v_user, v_crawl
  from public.makeup_claim_tokens t
  where t.token = p_token;
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;

  -- One claim at a time for this account and crawl, including two tabs.
  perform pg_advisory_xact_lock(hashtext(v_user::text), hashtext(v_crawl));

  select * into v_token
  from public.makeup_claim_tokens t
  where t.token = p_token
  for update;
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;

  perform 1
  from public.makeup_claim_tokens t
  where t.user_id = v_token.user_id
    and t.crawl_id = v_token.crawl_id
  order by t.token
  for update;

  select c.name into v_crawl_name
  from public.crawls c
  where c.id = v_token.crawl_id;

  select t.claimed_business_id into v_sibling_business
  from public.makeup_claim_tokens t
  where t.user_id = v_token.user_id
    and t.crawl_id = v_token.crawl_id
    and t.used_at is not null
    and t.token is distinct from v_token.token
  limit 1;
  v_has_sibling := found;

  select s.business_id into v_makeup_business
  from public.stamps s
  where s.user_id = v_token.user_id
    and s.crawl_id = v_token.crawl_id
    and s.source = 'makeup'
  limit 1;
  v_has_makeup := found;

  if v_token.used_at is not null and v_token.claimed_business_id = v_business then
    select shops.name into v_shop_name
    from private.makeup_crawl_shops(v_token.crawl_id) shops
    where shops.id = v_business;
    return jsonb_build_object(
      'status', 'claimed',
      'idempotent', true,
      'crawl_id', v_token.crawl_id,
      'crawl_name', v_crawl_name,
      'business_id', v_business,
      'business_name', v_shop_name
    );
  end if;

  if v_token.used_at is not null or v_has_sibling or v_has_makeup then
    if v_sibling_business is not null then
      select shops.name into v_shop_name
      from private.makeup_crawl_shops(v_token.crawl_id) shops
      where shops.id = v_sibling_business;
    elsif v_token.claimed_business_id is not null then
      select shops.name into v_shop_name
      from private.makeup_crawl_shops(v_token.crawl_id) shops
      where shops.id = v_token.claimed_business_id;
    elsif v_makeup_business is not null then
      select shops.name into v_shop_name
      from private.makeup_crawl_shops(v_token.crawl_id) shops
      where shops.id = v_makeup_business;
    end if;
    return jsonb_build_object(
      'status', 'used',
      'crawl_id', v_token.crawl_id,
      'crawl_name', v_crawl_name,
      'business_id', coalesce(v_token.claimed_business_id, v_sibling_business, v_makeup_business),
      'business_name', v_shop_name
    );
  end if;

  if v_token.expires_at <= now() then
    return jsonb_build_object(
      'status', 'expired',
      'crawl_id', v_token.crawl_id,
      'crawl_name', v_crawl_name
    );
  end if;

  if not exists (
    select 1
    from public.crawl_joins j
    where j.user_id = v_token.user_id
      and j.crawl_id = v_token.crawl_id
  ) then
    return jsonb_build_object(
      'status', 'not_joined',
      'crawl_id', v_token.crawl_id,
      'crawl_name', v_crawl_name
    );
  end if;

  if v_business = '' then
    return jsonb_build_object(
      'status', 'invalid_shop',
      'crawl_id', v_token.crawl_id,
      'crawl_name', v_crawl_name
    );
  end if;

  select shops.name into v_shop_name
  from private.makeup_crawl_shops(v_token.crawl_id) shops
  where shops.id = v_business;
  if v_shop_name is null then
    return jsonb_build_object(
      'status', 'invalid_shop',
      'crawl_id', v_token.crawl_id,
      'crawl_name', v_crawl_name
    );
  end if;

  if exists (
    select 1
    from public.stamps s
    where s.user_id = v_token.user_id
      and s.crawl_id = v_token.crawl_id
      and s.business_id = v_business
  ) then
    return jsonb_build_object(
      'status', 'already_stamped',
      'crawl_id', v_token.crawl_id,
      'crawl_name', v_crawl_name,
      'business_id', v_business,
      'business_name', v_shop_name
    );
  end if;

  update public.makeup_claim_tokens
    set used_at = now(),
        claimed_business_id = v_business
    where token = v_token.token
      and used_at is null;
  if not found then
    return jsonb_build_object(
      'status', 'used',
      'crawl_id', v_token.crawl_id,
      'crawl_name', v_crawl_name
    );
  end if;

  insert into public.stamps (user_id, crawl_id, business_id, lat, lng, source)
  values (v_token.user_id, v_token.crawl_id, v_business, null, null, 'makeup');

  return jsonb_build_object(
    'status', 'claimed',
    'idempotent', false,
    'crawl_id', v_token.crawl_id,
    'crawl_name', v_crawl_name,
    'business_id', v_business,
    'business_name', v_shop_name
  );
exception
  when unique_violation then
    if exists (
      select 1
      from public.stamps s
      where s.user_id = v_user
        and s.crawl_id = v_crawl
        and s.business_id = v_business
    ) then
      return jsonb_build_object(
        'status', 'already_stamped',
        'crawl_id', v_crawl,
        'business_id', v_business
      );
    end if;
    return jsonb_build_object(
      'status', 'used',
      'crawl_id', v_crawl
    );
end;
$function$;

comment on function public.claim_makeup_stamp(uuid, text) is
  'Adds one makeup stamp for the token''s account and crawl. No GPS and no signed-in session. A second call does not add another stamp.';

revoke all on function public.claim_makeup_stamp(uuid, text) from public;
grant execute on function public.claim_makeup_stamp(uuid, text) to anon, authenticated;

create or replace function public.issue_makeup_claim(
  p_crawl text,
  p_user uuid,
  p_ttl_hours integer default 72
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_crawl text := btrim(coalesce(p_crawl, ''));
  v_hours integer := coalesce(p_ttl_hours, 72);
  v_token public.makeup_claim_tokens%rowtype;
  v_expires timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    if auth.uid() is null or not private.can_issue_makeup_claim(v_crawl) then
      raise exception 'Not authorized' using errcode = '42501';
    end if;
  end if;

  if v_crawl = '' or p_user is null then
    raise exception 'Crawl and guest are required';
  end if;
  if v_hours < 1 or v_hours > 336 then
    raise exception 'TTL must be between 1 and 336 hours';
  end if;
  if not exists (select 1 from public.crawls c where c.id = v_crawl) then
    raise exception 'Unknown crawl';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'Unknown guest';
  end if;
  if not exists (
    select 1
    from public.crawl_joins j
    where j.user_id = p_user
      and j.crawl_id = v_crawl
  ) then
    raise exception 'That guest has not joined this crawl';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_user::text), hashtext(v_crawl));

  if exists (
    select 1
    from public.makeup_claim_tokens t
    where t.user_id = p_user
      and t.crawl_id = v_crawl
      and t.used_at is not null
  ) or exists (
    select 1
    from public.stamps s
    where s.user_id = p_user
      and s.crawl_id = v_crawl
      and s.source = 'makeup'
  ) then
    raise exception 'Makeup stamp already used for this crawl';
  end if;

  v_expires := now() + make_interval(hours => v_hours);

  update public.makeup_claim_tokens t
    set expires_at = v_expires
    where t.user_id = p_user
      and t.crawl_id = v_crawl
      and t.used_at is null
    returning * into v_token;

  if not found then
    begin
      insert into public.makeup_claim_tokens (crawl_id, user_id, expires_at)
      values (v_crawl, p_user, v_expires)
      returning * into v_token;
    exception
      when unique_violation then
        update public.makeup_claim_tokens t
          set expires_at = v_expires
          where t.user_id = p_user
            and t.crawl_id = v_crawl
            and t.used_at is null
          returning * into v_token;
        if not found then
          raise exception 'Makeup stamp already used for this crawl';
        end if;
    end;
  end if;

  return jsonb_build_object(
    'token', v_token.token,
    'crawl_id', v_token.crawl_id,
    'user_id', v_token.user_id,
    'expires_at', v_token.expires_at,
    'path', '/makeup?t=' || v_token.token::text
  );
end;
$function$;

comment on function public.issue_makeup_claim(text, uuid, integer) is
  'Mints or refreshes one open makeup link. Service role or the crawl owner only. Refuses a second link after the guest has used a makeup stamp.';

revoke all on function public.issue_makeup_claim(text, uuid, integer) from public, anon;
grant execute on function public.issue_makeup_claim(text, uuid, integer) to authenticated;

do $grant$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.get_makeup_claim(uuid) to service_role;
    grant execute on function public.claim_makeup_stamp(uuid, text) to service_role;
    grant execute on function public.issue_makeup_claim(text, uuid, integer) to service_role;
  end if;
end
$grant$;

notify pgrst, 'reload schema';
