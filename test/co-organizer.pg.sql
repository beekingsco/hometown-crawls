-- Local stub of the Hometown Crawls organizer tables plus auth.users.
-- Applies the co-organizer migration twice, then checks access rules.
-- Not run against production.

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
end $$;

create table auth.users (
  id uuid primary key,
  email text,
  email_confirmed_at timestamptz,
  encrypted_password text not null default '',
  is_anonymous boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb
$$;

grant execute on function auth.uid() to public;
grant execute on function auth.jwt() to public;

create table public.crawls (
  id text primary key,
  name text not null
);

create table public.organizers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text,
  user_id uuid unique references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint organizers_email_lower check (email = lower(btrim(email)))
);

create table public.crawl_organizers (
  crawl_id text not null references public.crawls (id) on delete cascade,
  organizer_id uuid not null references public.organizers (id) on delete cascade,
  role text not null default 'organizer',
  created_at timestamptz not null default now(),
  primary key (crawl_id, organizer_id),
  constraint crawl_organizers_role_check check (role = any (array['owner', 'organizer', 'viewer']))
);

create table public.shop_listings (
  id uuid primary key default gen_random_uuid(),
  crawl_id text not null references public.crawls (id),
  owner_user_id uuid references auth.users (id),
  owner_email text not null,
  display_name text not null
);

grant select on public.crawls, public.organizers, public.crawl_organizers, public.shop_listings to authenticated;

create or replace function private.is_crawl_organizer(p_crawl text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1
    from public.crawl_organizers co
    join public.organizers o on o.id = co.organizer_id
    where co.crawl_id = p_crawl
      and o.user_id = (select auth.uid())
  );
$$;

insert into public.crawls (id, name) values ('puy-coffee', 'Puyallup Coffee');

insert into auth.users (id, email, email_confirmed_at, encrypted_password) values
  ('11111111-1111-4111-8111-111111111111', 'chris@beekings.com', now(), 'hash'),
  ('22222222-2222-4222-8222-222222222222', 'bryan@myanthemcoffee.com', now(), 'hash'),
  ('33333333-3333-4333-8333-333333333333', 'guest@example.com', now(), 'hash'),
  ('44444444-4444-4444-8444-444444444444', 'shop@example.com', now(), 'hash'),
  ('66666666-6666-4666-8666-666666666666', 'fill@example.com', now(), 'hash');

insert into public.organizers (id, email, name, user_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'chris@beekings.com', 'Chris Miller', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'bryan@myanthemcoffee.com', 'Bryan Reynolds', null),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'keep@example.com', 'Keep Me', null),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', 'fill@example.com', null, null);

insert into public.crawl_organizers (crawl_id, organizer_id, role) values
  ('puy-coffee', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'owner'),
  ('puy-coffee', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'organizer');

insert into public.shop_listings (crawl_id, owner_email, display_name) values
  ('puy-coffee', 'shop@example.com', 'Anthem'),
  ('puy-coffee', 'Bryan@MyAnthemCoffee.com', 'Anthem Coffee');

create or replace function test.as_user(p_id uuid, p_email text)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_id::text, ''), false);
  perform set_config(
    'request.jwt.claims',
    case
      when p_email is null then ''
      else json_build_object('sub', p_id, 'email', p_email, 'role', 'authenticated')::text
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

grant usage on schema test to authenticated;
grant execute on all functions in schema test to authenticated;

create or replace function test.raises(stmt text, needle text)
returns void
language plpgsql
as $$
begin
  begin
    execute stmt;
    raise exception 'FAIL: expected error containing "%", but it succeeded', needle;
  exception
    when others then
      if sqlerrm like 'FAIL:%' then
        raise;
      end if;
      if position(needle in sqlerrm) = 0 then
        raise exception 'FAIL: expected "%" in error, got "%"', needle, sqlerrm;
      end if;
  end;
end;
$$;

grant usage on schema test to authenticated;
grant execute on all functions in schema test to authenticated;

\ir ../migrations/20261006150000_organizer_co_organizers.sql
\ir ../migrations/20261006150000_organizer_co_organizers.sql

select test.expect(
  (select user_id::text from public.organizers where email = 'bryan@myanthemcoffee.com')
    = '22222222-2222-4222-8222-222222222222',
  'backfill links a confirmed auth user'
);
select test.expect(
  (select user_id::text from public.organizers where email = 'chris@beekings.com')
    = '11111111-1111-4111-8111-111111111111',
  'backfill leaves an existing user_id alone'
);
select test.expect(
  (select user_id::text from public.organizers where email = 'fill@example.com')
    = '66666666-6666-4666-8666-666666666666',
  'backfill links the nameless organizer'
);
select test.expect(
  (select owner_user_id is null from public.shop_listings where owner_email = 'shop@example.com'),
  'backfill does not touch shop listings'
);
select test.expect(
  pg_get_constraintdef(oid) like '%co-organizer%',
  'role check allows co-organizer'
)
from pg_constraint
where conname = 'crawl_organizers_role_check';
select test.expect(
  exists (
    select 1 from pg_trigger
    where tgname = 'organizers_link_auth_user' and not tgisinternal
  ),
  'auth link trigger exists'
);
select test.expect(
  not has_function_privilege('anon', 'public.organizer_add_co_organizer(text,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.organizer_list_co_organizers(text)', 'execute')
  and not has_function_privilege('anon', 'public.organizer_remove_co_organizer(text,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.organizer_claim_by_email()', 'execute')
  and not has_function_privilege('public', 'public.organizer_add_co_organizer(text,text,text)', 'execute'),
  'anon and public cannot execute the new RPCs'
);
select test.expect(
  has_function_privilege('authenticated', 'public.organizer_add_co_organizer(text,text,text)', 'execute')
  and has_function_privilege('authenticated', 'public.organizer_list_co_organizers(text)', 'execute')
  and has_function_privilege('authenticated', 'public.organizer_remove_co_organizer(text,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.organizer_claim_by_email()', 'execute'),
  'authenticated can execute the new RPCs'
);

set role authenticated;
select test.raises(
  $$select public.organizer_add_co_organizer('puy-coffee', 'guest@example.com', 'Guest')$$,
  'Not authenticated'
);
reset role;

select test.as_user('11111111-1111-4111-8111-111111111111'::uuid, 'chris@beekings.com');
set role authenticated;
select test.expect(
  (public.organizer_add_co_organizer('puy-coffee', '  Guest@Example.com ', 'Guest Person') ->> 'status') = 'added',
  'owner can add a confirmed co-organizer'
);
select test.expect(
  (public.organizer_add_co_organizer('puy-coffee', 'guest@example.com', 'Other Name') ->> 'status') = 'already_on_crawl'
  and (public.organizer_add_co_organizer('puy-coffee', 'guest@example.com', null) ->> 'role') = 'co-organizer'
  and (public.organizer_add_co_organizer('puy-coffee', 'guest@example.com', null) ->> 'linked') = 'true',
  'adding the same email again does not change the role'
);
select test.expect(
  (select name from public.organizers where email = 'guest@example.com') = 'Guest Person',
  'new organizer keeps the supplied name'
);
select test.expect(
  (public.organizer_add_co_organizer('puy-coffee', 'chris@beekings.com', 'Not Chris') ->> 'status') = 'already_on_crawl'
  and (public.organizer_add_co_organizer('puy-coffee', 'chris@beekings.com', 'Not Chris') ->> 'role') = 'owner'
  and (select name from public.organizers where email = 'chris@beekings.com') = 'Chris Miller'
  and (select user_id::text from public.organizers where email = 'chris@beekings.com') = '11111111-1111-4111-8111-111111111111',
  'adding an existing owner does not overwrite name, user_id, or role'
);
select test.expect(
  (select name from public.organizers where email = 'keep@example.com') = 'Keep Me',
  'seed name is unchanged before the keep-name call'
);
select public.organizer_add_co_organizer('puy-coffee', 'keep@example.com', 'Changed Name');
select test.expect(
  (select name from public.organizers where email = 'keep@example.com') = 'Keep Me',
  'existing name is not overwritten'
);
select public.organizer_add_co_organizer('puy-coffee', 'fill@example.com', 'Filled In');
select test.expect(
  (select name from public.organizers where email = 'fill@example.com') = 'Filled In',
  'null name is filled'
);
select test.expect(
  (public.organizer_add_co_organizer('puy-coffee', 'new.person@example.com', null) ->> 'linked') = 'false',
  'unknown email is returned unlinked'
);
select test.expect(
  (select user_id is null from public.organizers where email = 'new.person@example.com'),
  'unknown email is stored unlinked'
);
select test.raises(
  $$select public.organizer_add_co_organizer('puy-coffee', 'not-an-email', null)$$,
  'Enter a valid email address'
);
select test.raises(
  $$select public.organizer_add_co_organizer('missing-crawl', 'person@example.com', null)$$,
  'Unknown crawl'
);
select test.expect(
  (select count(*) from public.organizer_list_co_organizers('puy-coffee')) >= 4,
  'owner can list organizers'
);
select test.expect(
  exists (
    select 1 from public.organizer_list_co_organizers('puy-coffee') row
    where row.email = 'new.person@example.com' and row.linked = false and row.role = 'co-organizer'
  ),
  'list reports unlinked co-organizers'
);
select test.raises(
  $$select public.organizer_remove_co_organizer('puy-coffee', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')$$,
  'An owner cannot be removed'
);
select test.raises(
  $$select public.organizer_remove_co_organizer('puy-coffee', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2')$$,
  'Only a co-organizer can be removed'
);
reset role;

select test.as_user('22222222-2222-4222-8222-222222222222'::uuid, 'bryan@myanthemcoffee.com');
set role authenticated;
select test.raises(
  $$select public.organizer_remove_co_organizer('puy-coffee', (select id from public.organizers where email = 'guest@example.com'))$$,
  'Only the crawl owner can remove a co-organizer'
);
select test.expect(
  (select count(*) from public.organizer_list_co_organizers('puy-coffee')) >= 1,
  'linked organizer can list'
);
reset role;

select test.as_user('33333333-3333-4333-8333-333333333333'::uuid, 'guest@example.com');
set role authenticated;
select test.expect(
  (public.organizer_add_co_organizer('puy-coffee', 'second@example.com', 'Second') ->> 'status') = 'added',
  'co-organizer passes is_crawl_organizer and can add'
);
select test.raises(
  $$select public.organizer_remove_co_organizer('puy-coffee', (select id from public.organizers where email = 'second@example.com'))$$,
  'Only the crawl owner can remove a co-organizer'
);
reset role;

select test.as_user('44444444-4444-4444-8444-444444444444'::uuid, 'shop@example.com');
set role authenticated;
select test.raises(
  $$select public.organizer_list_co_organizers('puy-coffee')$$,
  'Not an organizer of this crawl'
);
select public.hc_link_account() as first_link \gset
select test.expect(
  :'first_link'::jsonb ->> 'eligible' = 'true'
  and (:'first_link'::jsonb ->> 'listings') = '1'
  and (:'first_link'::jsonb ->> 'is_organizer') = 'false',
  'confirmed shop owner with a password hash is linked'
);
reset role;
select test.expect(
  (select owner_user_id::text from public.shop_listings where owner_email = 'shop@example.com')
    = '44444444-4444-4444-8444-444444444444',
  'shop listing owner_user_id was set'
);

select test.as_user('22222222-2222-4222-8222-222222222222'::uuid, 'bryan@myanthemcoffee.com');
set role authenticated;
select public.hc_link_account();
reset role;
select test.expect(
  (select count(*) from public.shop_listings where owner_user_id = '22222222-2222-4222-8222-222222222222'::uuid) = 1,
  'mixed-case shop email links to the confirmed organizer'
);

-- Unconfirmed sign-up does not link. Confirming the email does.
insert into public.organizers (email, name) values ('pending@example.com', 'Pending');
insert into auth.users (id, email, email_confirmed_at, encrypted_password)
values ('55555555-5555-4555-8555-555555555555', 'pending@example.com', null, 'hash');
select test.expect(
  (select user_id is null from public.organizers where email = 'pending@example.com'),
  'unconfirmed insert does not link'
);
update auth.users
set email_confirmed_at = now()
where id = '55555555-5555-4555-8555-555555555555';
select test.expect(
  (select user_id::text from public.organizers where email = 'pending@example.com')
    = '55555555-5555-4555-8555-555555555555',
  'confirming the email links the organizer'
);

-- Claim is the dashboard backup, and it trusts auth.jwt() email only when it matches.
update public.organizers set user_id = null where email = 'pending@example.com';
select test.as_user('55555555-5555-4555-8555-555555555555'::uuid, 'someone-else@example.com');
set role authenticated;
select test.expect(
  (public.organizer_claim_by_email() ->> 'linked') = 'false'
  and (public.organizer_claim_by_email() ->> 'reason') = 'email_mismatch',
  'claim refuses a jwt email that does not match auth.users'
);
reset role;
select test.expect(
  (select user_id is null from public.organizers where email = 'pending@example.com'),
  'mismatched claim did not link'
);
select test.as_user('55555555-5555-4555-8555-555555555555'::uuid, 'Pending@Example.com');
set role authenticated;
select test.expect(
  (public.organizer_claim_by_email() ->> 'linked') = 'true',
  'claim links the confirmed jwt email'
);
select test.expect(
  (public.organizer_claim_by_email() ->> 'linked') = 'true'
  and (public.organizer_claim_by_email() ->> 'reason') is null,
  'claim is idempotent when already linked'
);
reset role;

-- A trigger error must not block auth.users inserts.
insert into public.organizers (email, name) values ('boom@example.com', 'Boom');
create or replace function public._fail_org()
returns trigger
language plpgsql
as $$
begin
  raise exception 'boom';
end;
$$;
create trigger fail_org before update on public.organizers
for each row execute function public._fail_org();
insert into auth.users (id, email, email_confirmed_at, encrypted_password)
values ('77777777-7777-4777-8777-777777777777', 'boom@example.com', now(), 'hash');
select test.expect(
  exists (select 1 from auth.users where email = 'boom@example.com')
  and (select user_id is null from public.organizers where email = 'boom@example.com'),
  'auth insert survives a failed organizer link'
);
drop trigger fail_org on public.organizers;
update auth.users
set email_confirmed_at = now()
where email = 'boom@example.com';
select test.expect(
  (select user_id::text from public.organizers where email = 'boom@example.com')
    = '77777777-7777-4777-8777-777777777777',
  'a later confirmation update links after the failure'
);

insert into auth.users (id, email, email_confirmed_at, encrypted_password, is_anonymous)
values ('88888888-8888-4888-8888-888888888888', 'anon@example.com', now(), 'hash', true);
insert into public.organizers (email, name) values ('anon@example.com', 'Anon');
update auth.users set email = 'anon@example.com' where id = '88888888-8888-4888-8888-888888888888';
select test.expect(
  (select user_id is null from public.organizers where email = 'anon@example.com'),
  'anonymous users are not linked'
);

insert into auth.users (id, email, email_confirmed_at, encrypted_password)
values ('99999999-9999-4999-8999-999999999999', 'Upper@Example.com', now(), 'hash');
insert into public.organizers (email, name) values ('upper@example.com', 'Upper');
update auth.users set email_confirmed_at = now() where id = '99999999-9999-4999-8999-999999999999';
select test.expect(
  (select user_id::text from public.organizers where email = 'upper@example.com')
    = '99999999-9999-4999-8999-999999999999',
  'trigger matches email case-insensitively'
);

select test.as_user('11111111-1111-4111-8111-111111111111'::uuid, 'chris@beekings.com');
set role authenticated;
select public.organizer_remove_co_organizer(
  'puy-coffee',
  (select id from public.organizers where email = 'guest@example.com')
);
select test.expect(
  not exists (
    select 1 from public.crawl_organizers co
    join public.organizers o on o.id = co.organizer_id
    where o.email = 'guest@example.com'
  )
  and exists (select 1 from public.organizers where email = 'guest@example.com'),
  'owner can remove a co-organizer without deleting the person'
);
reset role;
