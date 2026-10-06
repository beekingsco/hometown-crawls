-- Co-organizer invites for Hometown Crawls.
-- Review and apply manually. This file is not run against production by the app.
-- It does not send email.
--
-- Rollback (run only after review; not automatic):
--   drop trigger if exists organizers_link_auth_user on auth.users;
--   drop function if exists private.link_organizer_on_auth_user();
--   drop function if exists public.organizer_add_co_organizer(text, text, text);
--   drop function if exists public.organizer_list_co_organizers(text);
--   drop function if exists public.organizer_remove_co_organizer(text, uuid);
--   drop function if exists public.organizer_claim_by_email();
--   -- Restore hc_link_account from a backup if this migration replaced it.
--   delete from public.crawl_organizers where role = 'co-organizer';
--   alter table public.crawl_organizers drop constraint if exists crawl_organizers_role_check;
--   alter table public.crawl_organizers add constraint crawl_organizers_role_check
--     check (role = any (array['owner'::text, 'organizer'::text, 'viewer'::text]));
--   -- Do not drop organizers_email_key; production already has that unique index.
--   -- The backfill below sets organizers.user_id. That is not reversible from this file.

create schema if not exists private;

-- Production already has this unique index. A fresh database needs it for
-- ON CONFLICT (email). Emails are already stored lower(trim) by check constraint.
create unique index if not exists organizers_email_key on public.organizers (email);

alter table public.crawl_organizers drop constraint if exists crawl_organizers_role_check;
alter table public.crawl_organizers
  add constraint crawl_organizers_role_check
  check (role = any (array['owner'::text, 'organizer'::text, 'co-organizer'::text, 'viewer'::text]));

-- Links a confirmed auth user onto an unlinked organizer row with the same email.
-- Failures are swallowed so a bug here cannot block sign-up or email confirmation.
create or replace function private.link_organizer_on_auth_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.email is null
     or btrim(new.email) = ''
     or new.email_confirmed_at is null
     or coalesce(new.is_anonymous, false) then
    return new;
  end if;

  update public.organizers o
  set user_id = new.id
  where o.user_id is null
    and o.email = lower(btrim(new.email))
    and not exists (
      select 1 from public.organizers taken
      where taken.user_id = new.id
    );

  return new;
exception
  when others then
    raise warning 'link_organizer_on_auth_user skipped: %', sqlerrm;
    return new;
end;
$function$;

revoke all on function private.link_organizer_on_auth_user() from public;
revoke all on function private.link_organizer_on_auth_user() from anon;
revoke all on function private.link_organizer_on_auth_user() from authenticated;

drop trigger if exists organizers_link_auth_user on auth.users;
create trigger organizers_link_auth_user
  after insert or update of email, email_confirmed_at
  on auth.users
  for each row
  execute function private.link_organizer_on_auth_user();

create or replace function public.organizer_add_co_organizer(
  p_crawl_id text,
  p_email text,
  p_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_crawl text := btrim(coalesce(p_crawl_id, ''));
  v_org_id uuid;
  v_auth_id uuid;
  v_role text;
  v_linked boolean;
  v_rows integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_crawl = '' or not exists (select 1 from public.crawls c where c.id = v_crawl) then
    raise exception 'Unknown crawl';
  end if;
  if not private.is_crawl_organizer(v_crawl) then
    raise exception 'Not an organizer of this crawl' using errcode = '42501';
  end if;
  if v_name is not null and char_length(v_name) > 200 then
    raise exception 'Name needs to be 200 characters or fewer';
  end if;
  if char_length(v_email) > 320
     or v_email !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' then
    raise exception 'Enter a valid email address';
  end if;

  select u.id
    into v_auth_id
  from auth.users u
  where lower(btrim(u.email)) = v_email
    and u.email_confirmed_at is not null
    and coalesce(u.is_anonymous, false) = false
  order by u.created_at nulls last
  limit 1;

  if v_auth_id is not null and exists (
    select 1 from public.organizers taken
    where taken.user_id = v_auth_id
      and taken.email <> v_email
  ) then
    v_auth_id := null;
  end if;

  insert into public.organizers as o (email, name, user_id)
  values (v_email, v_name, v_auth_id)
  on conflict (email) do update
    set name = coalesce(o.name, excluded.name),
        user_id = coalesce(o.user_id, excluded.user_id)
  returning o.id into v_org_id;

  insert into public.crawl_organizers (crawl_id, organizer_id, role)
  values (v_crawl, v_org_id, 'co-organizer')
  on conflict (crawl_id, organizer_id) do nothing;
  get diagnostics v_rows = row_count;

  select co.role, (o.user_id is not null)
    into v_role, v_linked
  from public.crawl_organizers co
  join public.organizers o on o.id = co.organizer_id
  where co.crawl_id = v_crawl
    and co.organizer_id = v_org_id;

  return jsonb_build_object(
    'organizer_id', v_org_id,
    'email', v_email,
    'name', (select o.name from public.organizers o where o.id = v_org_id),
    'role', v_role,
    'linked', coalesce(v_linked, false),
    'status', case when v_rows > 0 then 'added' else 'already_on_crawl' end
  );
end;
$function$;

comment on function public.organizer_add_co_organizer(text, text, text) is
  'Adds a co-organizer by email for a crawl the caller already organizes. Does not send email.';

create or replace function public.organizer_list_co_organizers(p_crawl_id text)
returns table (
  organizer_id uuid,
  name text,
  email text,
  role text,
  linked boolean
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_crawl text := btrim(coalesce(p_crawl_id, ''));
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not private.is_crawl_organizer(v_crawl) then
    raise exception 'Not an organizer of this crawl' using errcode = '42501';
  end if;

  return query
  select o.id, o.name, o.email, co.role, (o.user_id is not null)
  from public.crawl_organizers co
  join public.organizers o on o.id = co.organizer_id
  where co.crawl_id = v_crawl
  order by case co.role
    when 'owner' then 0
    when 'organizer' then 1
    when 'co-organizer' then 2
    else 3
  end, o.email;
end;
$function$;

comment on function public.organizer_list_co_organizers(text) is
  'Lists organizers on a crawl for a linked organizer. Does not send email.';

create or replace function public.organizer_remove_co_organizer(
  p_crawl_id text,
  p_organizer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_crawl text := btrim(coalesce(p_crawl_id, ''));
  v_my_id uuid;
  v_my_role text;
  v_target_role text;
  v_email text;
  v_remaining integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select o.id, co.role
    into v_my_id, v_my_role
  from public.crawl_organizers co
  join public.organizers o on o.id = co.organizer_id
  where co.crawl_id = v_crawl
    and o.user_id = v_uid;

  if v_my_role is distinct from 'owner' then
    raise exception 'Only the crawl owner can remove a co-organizer' using errcode = '42501';
  end if;

  select co.role, o.email
    into v_target_role, v_email
  from public.crawl_organizers co
  join public.organizers o on o.id = co.organizer_id
  where co.crawl_id = v_crawl
    and co.organizer_id = p_organizer_id;

  if v_target_role is null then
    raise exception 'That person is not on this crawl';
  end if;
  if v_target_role = 'owner' then
    raise exception 'An owner cannot be removed';
  end if;

  if p_organizer_id = v_my_id then
    select count(*)::integer
      into v_remaining
    from public.crawl_organizers co
    where co.crawl_id = v_crawl
      and co.organizer_id <> p_organizer_id
      and co.role in ('owner', 'organizer');
    if coalesce(v_remaining, 0) = 0 then
      raise exception 'You are the last owner or organizer on this crawl';
    end if;
  end if;

  if v_target_role <> 'co-organizer' then
    raise exception 'Only a co-organizer can be removed';
  end if;

  delete from public.crawl_organizers
  where crawl_id = v_crawl
    and organizer_id = p_organizer_id
    and role = 'co-organizer';

  return jsonb_build_object(
    'removed', true,
    'organizer_id', p_organizer_id,
    'email', v_email,
    'crawl_id', v_crawl
  );
end;
$function$;

comment on function public.organizer_remove_co_organizer(text, uuid) is
  'Owner-only removal of a co-organizer membership. Does not delete the person or send email.';

create or replace function public.organizer_claim_by_email()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_jwt_email text := lower(btrim(coalesce((select auth.jwt()) ->> 'email', '')));
  v_user_email text;
  v_confirmed timestamptz;
  v_anon boolean := false;
  v_org_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_jwt_email = '' then
    return jsonb_build_object('linked', false, 'organizer_id', null, 'email', null, 'reason', 'no_email');
  end if;

  select lower(btrim(u.email)), u.email_confirmed_at, coalesce(u.is_anonymous, false)
    into v_user_email, v_confirmed, v_anon
  from auth.users u
  where u.id = v_uid;

  if v_anon or v_user_email is null or v_user_email <> v_jwt_email or v_confirmed is null then
    return jsonb_build_object(
      'linked', false,
      'organizer_id', null,
      'email', v_jwt_email,
      'reason', case
        when v_confirmed is null then 'email_not_confirmed'
        else 'email_mismatch'
      end
    );
  end if;

  update public.organizers o
  set user_id = v_uid
  where o.user_id is null
    and o.email = v_user_email
    and not exists (
      select 1 from public.organizers taken
      where taken.user_id = v_uid
    )
  returning o.id into v_org_id;

  if v_org_id is null then
    select o.id
      into v_org_id
    from public.organizers o
    where o.user_id = v_uid;
  end if;

  return jsonb_build_object(
    'linked', v_org_id is not null,
    'organizer_id', v_org_id,
    'email', v_user_email,
    'reason', case when v_org_id is null then 'no_organizer_row' else null end
  );
end;
$function$;

comment on function public.organizer_claim_by_email() is
  'Links the signed-in confirmed user to an organizer row with the same email. Does not send email.';

revoke all on function public.organizer_add_co_organizer(text, text, text) from public;
revoke all on function public.organizer_add_co_organizer(text, text, text) from anon;
grant execute on function public.organizer_add_co_organizer(text, text, text) to authenticated;

revoke all on function public.organizer_list_co_organizers(text) from public;
revoke all on function public.organizer_list_co_organizers(text) from anon;
grant execute on function public.organizer_list_co_organizers(text) to authenticated;

revoke all on function public.organizer_remove_co_organizer(text, uuid) from public;
revoke all on function public.organizer_remove_co_organizer(text, uuid) from anon;
grant execute on function public.organizer_remove_co_organizer(text, uuid) to authenticated;

revoke all on function public.organizer_claim_by_email() from public;
revoke all on function public.organizer_claim_by_email() from anon;
grant execute on function public.organizer_claim_by_email() to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.organizer_add_co_organizer(text, text, text) to service_role;
    grant execute on function public.organizer_list_co_organizers(text) to service_role;
    grant execute on function public.organizer_remove_co_organizer(text, uuid) to service_role;
    grant execute on function public.organizer_claim_by_email() to service_role;
  end if;
end $$;

-- The shop and organizer dashboards call this on load. It previously linked
-- only when auth.users.encrypted_password was empty, so a confirmed person
-- with a password hash never received organizers.user_id or
-- shop_listings.owner_user_id. Link any confirmed, non-anonymous email.
create or replace function public.hc_link_account()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_ok boolean;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  select lower(btrim(u.email)),
         (u.email_confirmed_at is not null and coalesce(u.is_anonymous, false) = false)
    into v_email, v_ok
  from auth.users u
  where u.id = v_uid;
  if v_email is null then
    return jsonb_build_object('email', null, 'eligible', false, 'is_organizer', false, 'listings', 0);
  end if;
  if v_ok then
    update public.organizers
    set user_id = v_uid
    where email = v_email
      and user_id is null
      and not exists (
        select 1 from public.organizers taken
        where taken.user_id = v_uid
      );
    update public.shop_listings
    set owner_user_id = v_uid
    where owner_user_id is null
      and lower(btrim(owner_email)) = v_email;
  end if;
  return jsonb_build_object(
    'email', v_email,
    'eligible', v_ok,
    'is_organizer', exists (select 1 from public.organizers o where o.user_id = v_uid),
    'listings', (select count(*) from public.shop_listings l where l.owner_user_id = v_uid)
  );
end;
$function$;

comment on function public.hc_link_account() is
  'Links the signed-in confirmed user to organizer and shop rows with the same email. Does not send email.';

-- One-time backfill. Runs when this migration is applied.
-- Sets organizers.user_id where it is still null and exactly one confirmed,
-- non-anonymous auth.users row has the same email. Does not create auth users,
-- does not email anyone, and does not change shop_listings.
-- Re-running is a no-op for rows that are already linked.
-- People who confirm their email later are linked by organizers_link_auth_user
-- and by public.organizer_claim_by_email().
update public.organizers o
set user_id = picked.id
from (
  select o2.id as organizer_id, u.id
  from public.organizers o2
  join auth.users u
    on lower(btrim(u.email)) = o2.email
   and u.email_confirmed_at is not null
   and coalesce(u.is_anonymous, false) = false
  where o2.user_id is null
    and not exists (
      select 1 from public.organizers taken
      where taken.user_id = u.id
    )
    and (
      select count(*)
      from auth.users u2
      where lower(btrim(u2.email)) = o2.email
        and u2.email_confirmed_at is not null
        and coalesce(u2.is_anonymous, false) = false
    ) = 1
) picked
where o.id = picked.organizer_id;
