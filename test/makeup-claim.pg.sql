-- Local proof of the makeup stamp link. Not run against production.
-- Stub tables match the columns the migration reads and writes.

create schema if not exists auth;
create schema if not exists private;
create schema if not exists test;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'hc_postgres') then
    create role hc_postgres nologin nosuperuser;
  end if;
end $$;

alter role hc_postgres nosuperuser nologin;

create table auth.users (
  id uuid primary key,
  email text
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )
$$;

grant usage on schema auth to hc_postgres, anon, authenticated, service_role;
grant select, references on table auth.users to hc_postgres;
grant execute on function auth.uid() to public;
grant execute on function auth.role() to public;
grant usage, create on schema public to hc_postgres;
grant usage, create on schema private to hc_postgres;
grant usage on schema public to anon, authenticated, service_role;

set role hc_postgres;

create table public.crawls (
  id text primary key,
  name text not null
);

create table public.organizers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text,
  user_id uuid references auth.users (id)
);

create table public.crawl_organizers (
  crawl_id text not null references public.crawls (id) on delete cascade,
  organizer_id uuid not null references public.organizers (id) on delete cascade,
  role text not null,
  primary key (crawl_id, organizer_id)
);

create table public.shop_listings (
  id uuid primary key default gen_random_uuid(),
  crawl_id text not null references public.crawls (id) on delete cascade,
  business_id text,
  display_name text,
  is_paid boolean not null default false,
  is_approved boolean not null default false,
  is_visible boolean not null default true,
  lat double precision,
  lng double precision
);

create table public.crawl_joins (
  user_id uuid not null references auth.users (id) on delete cascade,
  crawl_id text not null references public.crawls (id) on delete cascade,
  primary key (user_id, crawl_id)
);

create table public.stamps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  crawl_id text not null,
  business_id text not null,
  claimed_at timestamptz not null default now(),
  lat double precision,
  lng double precision,
  source text not null default 'digital',
  unique (user_id, crawl_id, business_id),
  constraint stamps_source_check check (source = any (array['digital'::text, 'manual'::text]))
);

reset role;

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'chris@beekings.com'),
  ('22222222-2222-4222-8222-222222222222', 'bryan@myanthemcoffee.com'),
  ('33333333-3333-4333-8333-333333333333', 'guest.a@example.com'),
  ('44444444-4444-4444-8444-444444444444', 'guest.b@example.com'),
  ('55555555-5555-4555-8555-555555555555', 'guest.c@example.com'),
  ('66666666-6666-4666-8666-666666666666', 'stranger@example.com');

set role hc_postgres;

insert into public.crawls (id, name) values
  ('puy-coffee', 'Downtown Puyallup Holiday Coffee Crawl'),
  ('arl-coffee', 'Arlington Holiday Coffee Crawl');

insert into public.organizers (id, email, name, user_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'chris@beekings.com', 'Chris Miller', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'bryan@myanthemcoffee.com', 'Bryan Reynolds', '22222222-2222-4222-8222-222222222222');

insert into public.crawl_organizers (crawl_id, organizer_id, role) values
  ('puy-coffee', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'owner'),
  ('arl-coffee', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'owner'),
  ('puy-coffee', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'organizer');

insert into public.shop_listings (crawl_id, business_id, display_name, is_paid, is_approved, is_visible, lat, lng) values
  ('puy-coffee', 'anthem', 'Anthem Coffee', true, true, true, 47.191, -122.293),
  ('puy-coffee', 'cedar', 'Cedar Coffee', true, true, true, 47.185, -122.292),
  ('puy-coffee', 'hidden-shop', 'Hidden Roaster', true, true, false, 47.190, -122.290),
  ('puy-coffee', 'no-pin', 'Window Seat', true, true, true, null, null),
  ('puy-coffee', 'unpaid', 'Free Beans', false, true, true, 47.180, -122.280),
  ('puy-coffee', 'pending', 'Pending Pour', true, false, true, 47.182, -122.281),
  ('arl-coffee', 'roastery', 'Arlington Roastery', true, true, true, 48.170, -122.140);

insert into public.crawl_joins (user_id, crawl_id) values
  ('33333333-3333-4333-8333-333333333333', 'puy-coffee'),
  ('33333333-3333-4333-8333-333333333333', 'arl-coffee'),
  ('44444444-4444-4444-8444-444444444444', 'puy-coffee'),
  ('55555555-5555-4555-8555-555555555555', 'puy-coffee');

reset role;

create or replace function test.as_user(p_id uuid, p_role text)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_id::text, ''), false);
  perform set_config('request.jwt.claim.role', coalesce(p_role, ''), false);
  perform set_config(
    'request.jwt.claims',
    case
      when p_role is null then ''
      else json_build_object('sub', p_id, 'role', p_role)::text
    end,
    false
  );
end;
$$;

create or replace function test.expect(cond boolean, msg text)
returns void
language plpgsql
as $$
begin
  if not coalesce(cond, false) then
    raise exception 'FAIL: %', msg;
  end if;
end;
$$;

create or replace function test.raises(stmt text, needle text)
returns void
language plpgsql
as $$
begin
  execute stmt;
  raise exception 'FAIL: expected error containing "%", but statement succeeded', needle;
exception
  when others then
    if sqlerrm like 'FAIL:%' then
      raise;
    end if;
    if position(needle in sqlerrm) = 0 then
      raise exception 'FAIL: expected "%" in error, got "%"', needle, sqlerrm;
    end if;
end;
$$;

grant usage on schema test to anon, authenticated, service_role;
grant execute on all functions in schema test to anon, authenticated, service_role;

begin;
set local role hc_postgres;
\ir ../migrations/20261101190000_makeup_claim_tokens.sql
commit;

begin;
set local role hc_postgres;
\ir ../migrations/20261101190000_makeup_claim_tokens.sql
commit;

select test.expect(
  (select rolsuper from pg_roles where rolname = 'hc_postgres') = false
  and (select r.rolname from pg_proc p join pg_roles r on r.oid = p.proowner
       where p.oid = 'public.claim_makeup_stamp(uuid, text)'::regprocedure) = 'hc_postgres',
  'claim function is owned by the non-superuser migration role'
);

select test.expect(
  position('search_path' in pg_get_functiondef('public.claim_makeup_stamp(uuid, text)'::regprocedure)) > 0
  and position('source' in pg_get_functiondef('public.claim_makeup_stamp(uuid, text)'::regprocedure)) > 0
  and position('makeup' in pg_get_functiondef('public.claim_makeup_stamp(uuid, text)'::regprocedure)) > 0,
  'claim function pins search_path and writes a makeup stamp'
);

select test.expect(
  has_function_privilege('anon', 'public.get_makeup_claim(uuid)', 'execute')
  and has_function_privilege('anon', 'public.claim_makeup_stamp(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.issue_makeup_claim(text, uuid, integer)', 'execute')
  and has_function_privilege('authenticated', 'public.issue_makeup_claim(text, uuid, integer)', 'execute')
  and not has_table_privilege('anon', 'public.makeup_claim_tokens', 'select')
  and not has_table_privilege('anon', 'public.makeup_claim_tokens', 'insert')
  and has_table_privilege('authenticated', 'public.makeup_claim_tokens', 'select')
  and not has_table_privilege('authenticated', 'public.makeup_claim_tokens', 'insert')
  and not has_table_privilege('authenticated', 'public.makeup_claim_tokens', 'update'),
  'anon can claim but cannot read or mint token rows'
);

set role anon;
select test.raises('select * from public.makeup_claim_tokens', 'permission denied');
select test.raises(
  'select public.issue_makeup_claim(''puy-coffee'', ''33333333-3333-4333-8333-333333333333''::uuid, 72)',
  'permission denied'
);
reset role;

select test.as_user('22222222-2222-4222-8222-222222222222', 'authenticated');
select test.raises(
  'select public.issue_makeup_claim(''puy-coffee'', ''33333333-3333-4333-8333-333333333333''::uuid, 72)',
  'Not authorized'
);

select test.as_user('11111111-1111-4111-8111-111111111111', 'authenticated');
select test.raises(
  'select public.issue_makeup_claim(''puy-coffee'', ''33333333-3333-4333-8333-333333333333''::uuid, 0)',
  'TTL must be between 1 and 336 hours'
);
select test.raises(
  'select public.issue_makeup_claim(''no-such-crawl'', ''33333333-3333-4333-8333-333333333333''::uuid, 72)',
  'Not authorized'
);
select test.raises(
  'select public.issue_makeup_claim(''puy-coffee'', ''99999999-9999-4999-8999-999999999999''::uuid, 72)',
  'Unknown guest'
);
select test.raises(
  'select public.issue_makeup_claim(''puy-coffee'', ''66666666-6666-4666-8666-666666666666''::uuid, 72)',
  'That guest has not joined this crawl'
);

create temp table makeup_results (label text primary key, payload jsonb);
grant select on makeup_results to anon, authenticated, service_role;

select test.as_user('11111111-1111-4111-8111-111111111111', 'authenticated');
insert into makeup_results (label, payload)
values (
  'a-puy',
  public.issue_makeup_claim('puy-coffee', '33333333-3333-4333-8333-333333333333'::uuid, 72)
);

update public.makeup_claim_tokens
  set expires_at = now() + interval '1 hour'
  where token = (select (payload->>'token')::uuid from makeup_results where label = 'a-puy');

select test.as_user(null, 'service_role');
insert into makeup_results (label, payload)
values (
  'a-puy-refresh',
  public.issue_makeup_claim('puy-coffee', '33333333-3333-4333-8333-333333333333'::uuid, 72)
);

select test.expect(
  (select payload->>'token' from makeup_results where label = 'a-puy')
    = (select payload->>'token' from makeup_results where label = 'a-puy-refresh')
  and (select (payload->>'expires_at')::timestamptz from makeup_results where label = 'a-puy-refresh')
    > now() + interval '24 hours'
  and (select payload->>'path' from makeup_results where label = 'a-puy')
    = '/makeup?t=' || (select payload->>'token' from makeup_results where label = 'a-puy'),
  'reissue refreshes the same open token'
);

select test.as_user(null, 'anon');
set role anon;

select test.expect(
  (public.get_makeup_claim((select (payload->>'token')::uuid from makeup_results where label = 'a-puy')) ->> 'status') = 'ready'
  and (public.get_makeup_claim((select (payload->>'token')::uuid from makeup_results where label = 'a-puy')) -> 'shops')
    = '[{"id":"anthem","name":"Anthem Coffee"},{"id":"cedar","name":"Cedar Coffee"}]'::jsonb
  and (public.get_makeup_claim((select (payload->>'token')::uuid from makeup_results where label = 'a-puy')) ->> 'crawl_id') = 'puy-coffee',
  'ready link lists only pinned paid approved visible shops on that crawl'
);

select test.expect(
  (public.get_makeup_claim('99999999-9999-4999-8999-999999999999'::uuid) ->> 'status') = 'invalid'
  and not (public.get_makeup_claim('99999999-9999-4999-8999-999999999999'::uuid) ? 'crawl_id')
  and (public.get_makeup_claim(null) ->> 'status') = 'invalid',
  'unknown token stays closed and does not name a crawl'
);

select test.expect(
  (public.claim_makeup_stamp(
    (select (payload->>'token')::uuid from makeup_results where label = 'a-puy'),
    'hidden-shop'
  ) ->> 'status') = 'invalid_shop'
  and (public.claim_makeup_stamp(
    (select (payload->>'token')::uuid from makeup_results where label = 'a-puy'),
    'roastery'
  ) ->> 'status') = 'invalid_shop'
  and (public.claim_makeup_stamp(
    (select (payload->>'token')::uuid from makeup_results where label = 'a-puy'),
    'no-pin'
  ) ->> 'status') = 'invalid_shop',
  'shops off this crawl map do not consume the link'
);
reset role;
select test.expect(
  (select used_at is null from public.makeup_claim_tokens
    where token = (select (payload->>'token')::uuid from makeup_results where label = 'a-puy')),
  'a rejected shop leaves the makeup link open'
);
select test.as_user(null, 'anon');
set role anon;

select test.expect(
  (public.claim_makeup_stamp(
    (select (payload->>'token')::uuid from makeup_results where label = 'a-puy'),
    'anthem'
  ) ->> 'status') = 'claimed'
  and (public.claim_makeup_stamp(
    (select (payload->>'token')::uuid from makeup_results where label = 'a-puy'),
    'anthem'
  ) ->> 'idempotent') = 'true',
  'first tap stamps and the same tap again is idempotent'
);

select test.expect(
  (public.claim_makeup_stamp(
    (select (payload->>'token')::uuid from makeup_results where label = 'a-puy'),
    'cedar'
  ) ->> 'status') = 'used'
  and (public.get_makeup_claim((select (payload->>'token')::uuid from makeup_results where label = 'a-puy')) ->> 'status') = 'used'
  and (public.get_makeup_claim((select (payload->>'token')::uuid from makeup_results where label = 'a-puy')) -> 'shops') = '[]'::jsonb
  and (public.get_makeup_claim((select (payload->>'token')::uuid from makeup_results where label = 'a-puy')) ->> 'business_name') = 'Anthem Coffee',
  'a used link and a second shop return used and no shop buttons'
);

reset role;

select test.expect(
  (select count(*) from public.stamps
    where user_id = '33333333-3333-4333-8333-333333333333' and crawl_id = 'puy-coffee') = 1
  and (select source from public.stamps
    where user_id = '33333333-3333-4333-8333-333333333333' and crawl_id = 'puy-coffee' and business_id = 'anthem') = 'makeup'
  and (select lat is null and lng is null from public.stamps
    where user_id = '33333333-3333-4333-8333-333333333333' and business_id = 'anthem'),
  'exactly one makeup stamp is stored without coordinates'
);

select test.raises(
  'insert into public.makeup_claim_tokens (crawl_id, user_id, expires_at) values (''puy-coffee'', ''33333333-3333-4333-8333-333333333333'', now() + interval ''72 hours'')',
  'One makeup stamp per guest on this crawl'
);

select test.as_user('11111111-1111-4111-8111-111111111111', 'authenticated');
select test.raises(
  'select public.issue_makeup_claim(''puy-coffee'', ''33333333-3333-4333-8333-333333333333''::uuid, 72)',
  'Makeup stamp already used for this crawl'
);

insert into public.stamps (user_id, crawl_id, business_id, source)
values ('44444444-4444-4444-8444-444444444444', 'puy-coffee', 'anthem', 'digital');

select test.as_user('11111111-1111-4111-8111-111111111111', 'authenticated');
insert into makeup_results (label, payload)
values (
  'b-puy',
  public.issue_makeup_claim('puy-coffee', '44444444-4444-4444-8444-444444444444'::uuid, 48)
);

select test.raises(
  'insert into public.makeup_claim_tokens (crawl_id, user_id, expires_at) values (''puy-coffee'', ''44444444-4444-4444-8444-444444444444'', now() + interval ''48 hours'')',
  'duplicate key'
);

select test.as_user(null, 'anon');
set role anon;
select test.expect(
  (public.claim_makeup_stamp(
    (select (payload->>'token')::uuid from makeup_results where label = 'b-puy'),
    'anthem'
  ) ->> 'status') = 'already_stamped',
  'an existing shop stamp does not use up the makeup link'
);
reset role;
select test.expect(
  (select used_at is null from public.makeup_claim_tokens
    where token = (select (payload->>'token')::uuid from makeup_results where label = 'b-puy')),
  'already stamped leaves the makeup link open'
);
select test.as_user(null, 'anon');
set role anon;
select test.expect(
  (public.claim_makeup_stamp(
    (select (payload->>'token')::uuid from makeup_results where label = 'b-puy'),
    'cedar'
  ) ->> 'status') = 'claimed',
  'the same guest can still makeup a different shop'
);
reset role;

select test.expect(
  (select count(*) from public.stamps
    where user_id = '44444444-4444-4444-8444-444444444444' and crawl_id = 'puy-coffee' and source = 'makeup') = 1
  and (select business_id from public.stamps
    where user_id = '44444444-4444-4444-8444-444444444444' and source = 'makeup') = 'cedar',
  'guest B keeps their own single makeup stamp'
);

select test.as_user('11111111-1111-4111-8111-111111111111', 'authenticated');
insert into makeup_results (label, payload)
values (
  'a-arl',
  public.issue_makeup_claim('arl-coffee', '33333333-3333-4333-8333-333333333333'::uuid, 72)
);

select test.as_user(null, 'anon');
set role anon;
select test.expect(
  (public.get_makeup_claim((select (payload->>'token')::uuid from makeup_results where label = 'a-arl')) -> 'shops')
    = '[{"id":"roastery","name":"Arlington Roastery"}]'::jsonb
  and (public.claim_makeup_stamp(
    (select (payload->>'token')::uuid from makeup_results where label = 'a-arl'),
    'anthem'
  ) ->> 'status') = 'invalid_shop'
  and (public.claim_makeup_stamp(
    (select (payload->>'token')::uuid from makeup_results where label = 'a-arl'),
    'roastery'
  ) ->> 'status') = 'claimed',
  'a second crawl is stamped on its own and ignores the other crawl shops'
);
reset role;

select test.expect(
  (select crawl_id from public.stamps
    where user_id = '33333333-3333-4333-8333-333333333333' and business_id = 'roastery') = 'arl-coffee'
  and (select count(*) from public.stamps
    where user_id = '33333333-3333-4333-8333-333333333333' and crawl_id = 'puy-coffee') = 1,
  'Arlington stamp does not land on the Puyallup passport'
);

with inserted as (
  insert into public.makeup_claim_tokens (crawl_id, user_id, expires_at)
  values ('puy-coffee', '66666666-6666-4666-8666-666666666666', now() + interval '72 hours')
  returning token
)
insert into makeup_results (label, payload)
select 'stranger', jsonb_build_object('token', inserted.token)
from inserted;

select test.as_user(null, 'anon');
set role anon;
select test.expect(
  (public.claim_makeup_stamp(
    (select (payload->>'token')::uuid from makeup_results where label = 'stranger'),
    'cedar'
  ) ->> 'status') = 'not_joined',
  'a guest who has not joined does not get a stamp'
);
reset role;
select test.expect(
  (select used_at is null from public.makeup_claim_tokens
    where token = (select (payload->>'token')::uuid from makeup_results where label = 'stranger')),
  'not joined leaves the makeup link open'
);

insert into public.crawl_joins (user_id, crawl_id)
values ('66666666-6666-4666-8666-666666666666', 'puy-coffee');

select test.as_user(null, 'anon');
set role anon;
select test.expect(
  (public.claim_makeup_stamp(
    (select (payload->>'token')::uuid from makeup_results where label = 'stranger'),
    'cedar'
  ) ->> 'status') = 'claimed',
  'the same link works after the guest joins'
);
reset role;

select test.as_user('11111111-1111-4111-8111-111111111111', 'authenticated');
insert into makeup_results (label, payload)
values (
  'c-puy',
  public.issue_makeup_claim('puy-coffee', '55555555-5555-4555-8555-555555555555'::uuid, 72)
);

update public.makeup_claim_tokens
  set expires_at = now() - interval '1 minute'
  where token = (select (payload->>'token')::uuid from makeup_results where label = 'c-puy');

select test.as_user(null, 'anon');
set role anon;
select test.expect(
  (public.get_makeup_claim((select (payload->>'token')::uuid from makeup_results where label = 'c-puy')) ->> 'status') = 'expired'
  and (public.get_makeup_claim((select (payload->>'token')::uuid from makeup_results where label = 'c-puy')) -> 'shops') = '[]'::jsonb
  and (public.claim_makeup_stamp(
    (select (payload->>'token')::uuid from makeup_results where label = 'c-puy'),
    'anthem'
  ) ->> 'status') = 'expired',
  'an expired link does not list shops or stamp'
);
reset role;
select test.expect(
  (select count(*) from public.stamps where user_id = '55555555-5555-4555-8555-555555555555') = 0
  and (select used_at is null from public.makeup_claim_tokens
       where token = (select (payload->>'token')::uuid from makeup_results where label = 'c-puy')),
  'expiry does not write a stamp'
);

select test.as_user('33333333-3333-4333-8333-333333333333', 'authenticated');
set role authenticated;
select test.expect(
  (select count(*) from public.makeup_claim_tokens) = 2,
  'guest A sees only their own makeup links'
);
reset role;

select test.as_user('44444444-4444-4444-8444-444444444444', 'authenticated');
set role authenticated;
select test.expect(
  (select count(*) from public.makeup_claim_tokens) = 1
  and (select user_id from public.makeup_claim_tokens) = '44444444-4444-4444-8444-444444444444'::uuid,
  'guest B cannot read another guest token'
);
reset role;

select test.expect(
  (select count(*) from public.makeup_claim_tokens) = 5,
  'table owner still sees every makeup link'
);
