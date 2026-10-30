-- Organizer self-serve crawl creation and shop invites.
-- NOT APPLIED. Review and run on the staging Supabase project first.
-- Do not apply this to the live Puyallup project from the app or from CI.
-- This file does not send email. The Vercel function api/crawl-invites.js does.
-- It does not use or store a service role key.
--
-- New shop signups on every crawl, including Puyallup, start hidden.
-- An owner or organizer can show a shop on the passport only after it has a
-- map pin. Shops that are already visible stay visible.
-- A seat stays $49.99 (amount_cents 4999).
--
-- Rollback (run only after review; not automatic):
--   drop function if exists public.organizer_create_crawl(text, text, date, date, text, text, text, text, double precision, double precision);
--   drop function if exists public.organizer_save_shop_invites(text, text);
--   drop function if exists public.organizer_list_shop_invites(text);
--   drop function if exists public.organizer_mark_shop_invites(text, jsonb);
--   drop function if exists public.organizer_list_planned_shops(text);
--   drop function if exists public.organizer_set_payment_link(text, text);
--   drop function if exists public.shop_set_pin(uuid, double precision, double precision);
--   drop function if exists public.shop_signup_target(text, text);
--   drop function if exists private.is_crawl_owner_or_organizer(text);
--   drop table if exists public.crawl_shop_invites;
--   drop table if exists public.crawl_planned_shops;
--   Then restore private.crawl_signups_set_crawl_id, private.crawl_signups_create_listing,
--   public.organizer_set_shop_visible, and policy crawl_signups_anon_insert
--   from the previous definitions. The previous insert policy allowed only
--   the Puyallup holiday signup key.

set local lock_timeout = '5s';

create unique index if not exists organizers_email_key on public.organizers (email);

create table if not exists public.crawl_planned_shops (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  crawl_id text not null references public.crawls (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint crawl_planned_shops_name_len check (char_length(name) between 1 and 200)
);

create table if not exists public.crawl_shop_invites (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  crawl_id text not null references public.crawls (id) on delete cascade,
  email text not null,
  token text not null,
  status text not null default 'pending',
  created_by uuid,
  created_at timestamptz not null default pg_catalog.now(),
  sent_at timestamptz,
  constraint crawl_shop_invites_email_lower check (email = lower(btrim(email))),
  constraint crawl_shop_invites_status_check check (status = any (array['pending'::text, 'sent'::text, 'failed'::text])),
  constraint crawl_shop_invites_email_key unique (crawl_id, email),
  constraint crawl_shop_invites_token_key unique (token)
);

alter table public.crawl_planned_shops enable row level security;
alter table public.crawl_shop_invites enable row level security;

revoke all on public.crawl_planned_shops from public, anon, authenticated;
revoke all on public.crawl_shop_invites from public, anon, authenticated;

create or replace function private.is_crawl_owner_or_organizer(p_crawl text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1
    from public.crawl_organizers co
    join public.organizers o on o.id = co.organizer_id
    where co.crawl_id = p_crawl
      and o.user_id = (select auth.uid())
      and co.role in ('owner', 'organizer')
  );
$function$;

revoke all on function private.is_crawl_owner_or_organizer(text) from public, anon, authenticated;

-- Match a signup to its crawl by signup key or by crawl id.
create or replace function private.crawl_signups_set_crawl_id()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  new.crawl_id := (
    select c.id
    from public.crawls c
    where c.signup_key = new.crawl
       or c.id = new.crawl
    order by case when c.signup_key = new.crawl then 0 else 1 end
    limit 1
  );
  return new;
end;
$function$;

revoke all on function private.crawl_signups_set_crawl_id() from public, anon, authenticated;

-- New listings stay off the passport until they have a pin and an owner or
-- organizer shows them. Existing rows are not updated.
create or replace function private.crawl_signups_create_listing()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.crawl_id is not null then
    begin
      insert into public.shop_listings (
        crawl_id, signup_id, owner_email, display_name, contact_name, phone, address, website, hours, is_visible
      )
      values (
        new.crawl_id,
        new.id,
        lower(btrim(new.email)),
        left(btrim(new.business_name), 200),
        new.contact_name,
        new.phone,
        nullif(left(btrim(coalesce(new.address, '')), 300), ''),
        nullif(left(btrim(coalesce(new.website, '')), 300), ''),
        nullif(left(btrim(coalesce(new.hours, '')), 500), ''),
        false
      )
      on conflict (signup_id) do nothing;
    exception when others then
      raise warning 'crawl_signups_create_listing failed for %: %', new.id, sqlerrm;
    end;
  end if;
  return null;
end;
$function$;

revoke all on function private.crawl_signups_create_listing() from public, anon, authenticated;

drop policy if exists crawl_signups_anon_insert on public.crawl_signups;

create policy crawl_signups_anon_insert on public.crawl_signups
  for insert
  to anon, authenticated
  with check (
    status = 'started'
    and amount_cents = 4999
    and stripe_session_id is null
    and exists (
      select 1
      from public.crawls c
      where c.signup_key = crawl
         or c.id = crawl
    )
    and char_length(btrim(business_name)) > 0
    and char_length(btrim(contact_name)) > 0
    and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  );

create or replace function public.organizer_create_crawl(
  p_name text,
  p_city text,
  p_starts date,
  p_ends date,
  p_state text default null,
  p_shops text default null,
  p_organizer_name text default null,
  p_organization text default null,
  p_lat double precision default null,
  p_lng double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_confirmed timestamptz;
  v_name text := btrim(coalesce(p_name, ''));
  v_city text := btrim(coalesce(p_city, ''));
  v_state text := nullif(upper(btrim(coalesce(p_state, ''))), '');
  v_org_name text := nullif(btrim(coalesce(p_organizer_name, '')), '');
  v_organization text := nullif(btrim(coalesce(p_organization, '')), '');
  v_base text;
  v_id text;
  v_try integer := 0;
  v_org_id uuid;
  v_shop text;
  v_shops integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select lower(btrim(u.email)), u.email_confirmed_at
    into v_email, v_confirmed
  from auth.users u
  where u.id = v_uid
    and coalesce(u.is_anonymous, false) = false;

  if v_email is null or v_confirmed is null then
    raise exception 'Confirm your email, then start the crawl' using errcode = '42501';
  end if;
  if v_name = '' or char_length(v_name) > 120 then
    raise exception 'Crawl name needs 1 to 120 characters';
  end if;
  if v_city = '' or char_length(v_city) > 80 then
    raise exception 'City or area needs 1 to 80 characters';
  end if;
  if v_state is not null and v_state !~ '^[A-Z]{2}$' then
    raise exception 'State needs to be two letters';
  end if;
  if v_org_name is not null and char_length(v_org_name) > 200 then
    raise exception 'Your name needs to be 200 characters or fewer';
  end if;
  if v_organization is not null and char_length(v_organization) > 200 then
    raise exception 'Organization needs to be 200 characters or fewer';
  end if;
  if p_starts is null or p_ends is null or p_ends < p_starts then
    raise exception 'End date needs to be on or after the start date';
  end if;
  if (p_lat is null) <> (p_lng is null)
     or (p_lat is not null and (p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180)) then
    raise exception 'Location pin is not valid';
  end if;

  v_base := pg_catalog.regexp_replace(pg_catalog.lower(v_city || '-' || v_name), '[^a-z0-9]+', '-', 'g');
  v_base := pg_catalog.trim(both '-' from v_base);
  v_base := left(v_base, 40);
  if v_base = '' then
    v_base := 'crawl';
  end if;
  v_id := v_base;
  while v_try < 6 and (
    exists (select 1 from public.crawls c where c.id = v_id or c.signup_key = v_id)
    or v_id in ('puy-coffee', 'puy-pub')
  ) loop
    v_try := v_try + 1;
    v_id := left(v_base, 34) || '-' || pg_catalog.substr(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 4);
  end loop;
  if exists (select 1 from public.crawls c where c.id = v_id or c.signup_key = v_id) then
    raise exception 'Could not reserve a crawl id';
  end if;

  select o.id
    into v_org_id
  from public.organizers o
  where o.user_id = v_uid
  limit 1;

  if v_org_id is null then
    insert into public.organizers as o (email, name, user_id)
    values (v_email, v_org_name, v_uid)
    on conflict (email) do update
      set name = coalesce(o.name, excluded.name),
          user_id = coalesce(o.user_id, excluded.user_id)
    returning o.id into v_org_id;
  elsif v_org_name is not null then
    update public.organizers
      set name = coalesce(name, v_org_name)
      where id = v_org_id;
  end if;

  insert into public.crawls (
    id, name, city, state, type, lat, lng, blurb, starts_at, ends_at,
    signup_key, price_cents, is_listed
  )
  values (
    v_id,
    v_name,
    v_city,
    v_state,
    'coffee',
    p_lat,
    p_lng,
    case when v_organization is null then null else left('Organized by ' || v_organization, 600) end,
    p_starts::timestamptz,
    p_ends::timestamptz,
    v_id,
    4999,
    true
  );

  insert into public.crawl_organizers (crawl_id, organizer_id, role)
  values (v_id, v_org_id, 'owner');

  if p_shops is not null and btrim(p_shops) <> '' then
    for v_shop in
      select distinct left(btrim(part), 200)
      from pg_catalog.regexp_split_to_table(p_shops, E'[\n,]+') as part
      where btrim(part) <> ''
      limit 40
    loop
      insert into public.crawl_planned_shops (crawl_id, name)
      values (v_id, v_shop);
      v_shops := v_shops + 1;
    end loop;
  end if;

  return jsonb_build_object(
    'crawl_id', v_id,
    'name', v_name,
    'city', v_city,
    'signup_key', v_id,
    'price_cents', 4999,
    'signup_path', '/crawls/join?crawl=' || v_id,
    'planned_shops', v_shops,
    'role', 'owner'
  );
end;
$function$;

comment on function public.organizer_create_crawl(text, text, date, date, text, text, text, text, double precision, double precision) is
  'Signed-in confirmed user creates a crawl and becomes its owner. Seat price is 4999 cents. Does not send email.';

create or replace function public.organizer_save_shop_invites(
  p_crawl text,
  p_emails text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_crawl text := btrim(coalesce(p_crawl, ''));
  v_email text;
  v_count integer := 0;
  v_token text;
  v_saved text[] := '{}'::text[];
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not private.is_crawl_owner_or_organizer(v_crawl) then
    raise exception 'Only the crawl owner or an organizer can invite shops' using errcode = '42501';
  end if;

  select count(*) into v_count
  from (
    select distinct lower(btrim(part)) as email
    from pg_catalog.regexp_split_to_table(coalesce(p_emails, ''), '[,;[:space:]]+') as part
    where btrim(part) <> ''
  ) emails;

  if v_count = 0 then
    raise exception 'Paste at least one email';
  end if;
  if v_count > 50 then
    raise exception 'Paste up to 50 emails at a time';
  end if;

  for v_email in
    select distinct lower(btrim(part))
    from pg_catalog.regexp_split_to_table(coalesce(p_emails, ''), '[,;[:space:]]+') as part
    where btrim(part) <> ''
  loop
    if char_length(v_email) > 320
       or v_email !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' then
      raise exception 'Enter a valid email address: %', v_email;
    end if;
    if (select count(*) from public.crawl_shop_invites i where i.crawl_id = v_crawl) >= 200
       and not exists (
         select 1 from public.crawl_shop_invites i
         where i.crawl_id = v_crawl and i.email = v_email
       ) then
      raise exception 'This crawl already has 200 shop invites';
    end if;
    v_token := pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')
      || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
    insert into public.crawl_shop_invites (crawl_id, email, token, created_by)
    values (v_crawl, v_email, v_token, v_uid)
    on conflict (crawl_id, email) do nothing;
    v_saved := v_saved || v_email;
  end loop;

  return (
    select jsonb_build_object(
      'crawl_id', v_crawl,
      'invites', coalesce(jsonb_agg(jsonb_build_object(
        'email', i.email,
        'status', i.status,
        'token', i.token,
        'sent_at', i.sent_at
      ) order by i.email), '[]'::jsonb)
    )
    from public.crawl_shop_invites i
    where i.crawl_id = v_crawl
      and i.email = any (v_saved)
  );
end;
$function$;

comment on function public.organizer_save_shop_invites(text, text) is
  'Owner or organizer saves shop invite emails and unique join tokens. Does not send email.';

create or replace function public.organizer_list_shop_invites(p_crawl text)
returns table (
  email text,
  status text,
  token text,
  sent_at timestamptz,
  crawl_name text,
  city text
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_crawl text := btrim(coalesce(p_crawl, ''));
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not private.is_crawl_owner_or_organizer(v_crawl) then
    raise exception 'Only the crawl owner or an organizer can view shop invites' using errcode = '42501';
  end if;

  return query
  select i.email, i.status, i.token, i.sent_at, c.name, c.city
  from public.crawl_shop_invites i
  join public.crawls c on c.id = i.crawl_id
  where i.crawl_id = v_crawl
  order by i.email;
end;
$function$;

comment on function public.organizer_list_shop_invites(text) is
  'Owner or organizer lists shop invites, including the unique join token. Does not send email.';

create or replace function public.organizer_mark_shop_invites(
  p_crawl text,
  p_results jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_crawl text := btrim(coalesce(p_crawl, ''));
  v_row record;
  v_updated integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not private.is_crawl_owner_or_organizer(v_crawl) then
    raise exception 'Only the crawl owner or an organizer can update shop invites' using errcode = '42501';
  end if;
  if p_results is null or jsonb_typeof(p_results) <> 'array' then
    raise exception 'Invite results are missing';
  end if;

  for v_row in
    select lower(btrim(item->>'email')) as email, item->>'status' as status
    from jsonb_array_elements(p_results) as item
  loop
    if v_row.status not in ('sent', 'failed') then
      continue;
    end if;
    update public.crawl_shop_invites
      set status = v_row.status,
          sent_at = case when v_row.status = 'sent' then coalesce(sent_at, pg_catalog.now()) else sent_at end
      where crawl_id = v_crawl
        and email = v_row.email;
    if found then
      v_updated := v_updated + 1;
    end if;
  end loop;

  return jsonb_build_object('crawl_id', v_crawl, 'updated', v_updated);
end;
$function$;

comment on function public.organizer_mark_shop_invites(text, jsonb) is
  'Owner or organizer records which shop invite emails were sent. Does not send email.';

create or replace function public.organizer_list_planned_shops(p_crawl text)
returns table (
  name text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_crawl text := btrim(coalesce(p_crawl, ''));
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not private.is_crawl_organizer(v_crawl) then
    raise exception 'Not an organizer of this crawl' using errcode = '42501';
  end if;

  return query
  select s.name, s.created_at
  from public.crawl_planned_shops s
  where s.crawl_id = v_crawl
  order by s.name;
end;
$function$;

create or replace function public.organizer_set_payment_link(
  p_crawl text,
  p_link text
)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_crawl text := btrim(coalesce(p_crawl, ''));
  v_link text := nullif(btrim(coalesce(p_link, '')), '');
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not private.is_crawl_owner_or_organizer(v_crawl) then
    raise exception 'Only the crawl owner or an organizer can save the payment link' using errcode = '42501';
  end if;
  if v_link is not null and (
    char_length(v_link) > 400
    or v_link !~ '^https://(buy\.stripe\.com|checkout\.stripe\.com)/'
  ) then
    raise exception 'Paste a Stripe Payment Link that starts with https://buy.stripe.com/';
  end if;

  update public.crawls
    set payment_link = v_link
    where id = v_crawl;

  return v_link;
end;
$function$;

comment on function public.organizer_set_payment_link(text, text) is
  'Owner or organizer stores a manual Stripe Payment Link. Does not create a Checkout Session.';

create or replace function public.shop_set_pin(
  p_listing uuid,
  p_lat double precision,
  p_lng double precision
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_crawl text;
  v_owner uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_lat is null or p_lng is null or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'Map pin is not valid';
  end if;

  select l.crawl_id, l.owner_user_id
    into v_crawl, v_owner
  from public.shop_listings l
  where l.id = p_listing;

  if v_crawl is null then
    raise exception 'Unknown shop';
  end if;
  if v_owner is distinct from (select auth.uid())
     and not private.is_crawl_owner_or_organizer(v_crawl) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  update public.shop_listings
    set lat = p_lat,
        lng = p_lng,
        updated_at = pg_catalog.now()
    where id = p_listing;

  return jsonb_build_object('listing_id', p_listing, 'lat', p_lat, 'lng', p_lng);
end;
$function$;

comment on function public.shop_set_pin(uuid, double precision, double precision) is
  'Shop owner, crawl owner, or organizer saves a map pin. Does not show the shop by itself.';

create or replace function public.organizer_set_shop_visible(p_listing uuid, p_visible boolean)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_crawl text;
  v_lat double precision;
  v_lng double precision;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated';
  end if;

  select l.crawl_id, l.lat, l.lng
    into v_crawl, v_lat, v_lng
  from public.shop_listings l
  where l.id = p_listing;

  if v_crawl is null then
    raise exception 'Unknown listing';
  end if;
  if not private.is_crawl_owner_or_organizer(v_crawl) then
    raise exception 'Only the crawl owner or an organizer can show or hide a shop' using errcode = '42501';
  end if;
  if coalesce(p_visible, false) and (v_lat is null or v_lng is null) then
    raise exception 'Add a map pin before this shop can show on the passport';
  end if;

  update public.shop_listings
    set is_visible = coalesce(p_visible, false),
        updated_at = pg_catalog.now()
    where id = p_listing;
end;
$function$;

create or replace function public.shop_signup_target(
  p_crawl text default null,
  p_invite text default null
)
returns table (
  crawl_id text,
  name text,
  city text,
  state text,
  starts_at timestamptz,
  ends_at timestamptz,
  price_cents integer,
  payment_link text,
  signup_key text,
  invite_email text
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_invite text := nullif(btrim(coalesce(p_invite, '')), '');
  v_crawl text := nullif(btrim(coalesce(p_crawl, '')), '');
begin
  if v_invite is not null then
    return query
    select c.id, c.name, c.city, c.state, c.starts_at, c.ends_at, c.price_cents,
           c.payment_link, coalesce(c.signup_key, c.id), i.email
    from public.crawl_shop_invites i
    join public.crawls c on c.id = i.crawl_id
    where i.token = v_invite
    limit 1;
    return;
  end if;

  if v_crawl is null then
    return;
  end if;

  return query
  select c.id, c.name, c.city, c.state, c.starts_at, c.ends_at, c.price_cents,
         c.payment_link, coalesce(c.signup_key, c.id), null::text
  from public.crawls c
  where c.id = v_crawl
     or c.signup_key = v_crawl
  order by case when c.id = v_crawl then 0 else 1 end
  limit 1;
end;
$function$;

comment on function public.shop_signup_target(text, text) is
  'Public shop signup details for a crawl id or a unique invite token. Does not reveal other invites.';

revoke all on function public.organizer_create_crawl(text, text, date, date, text, text, text, text, double precision, double precision) from public, anon;
grant execute on function public.organizer_create_crawl(text, text, date, date, text, text, text, text, double precision, double precision) to authenticated;

revoke all on function public.organizer_save_shop_invites(text, text) from public, anon;
grant execute on function public.organizer_save_shop_invites(text, text) to authenticated;

revoke all on function public.organizer_list_shop_invites(text) from public, anon;
grant execute on function public.organizer_list_shop_invites(text) to authenticated;

revoke all on function public.organizer_mark_shop_invites(text, jsonb) from public, anon;
grant execute on function public.organizer_mark_shop_invites(text, jsonb) to authenticated;

revoke all on function public.organizer_list_planned_shops(text) from public, anon;
grant execute on function public.organizer_list_planned_shops(text) to authenticated;

revoke all on function public.organizer_set_payment_link(text, text) from public, anon;
grant execute on function public.organizer_set_payment_link(text, text) to authenticated;

revoke all on function public.shop_set_pin(uuid, double precision, double precision) from public, anon;
grant execute on function public.shop_set_pin(uuid, double precision, double precision) to authenticated;

revoke all on function public.shop_signup_target(text, text) from public;
grant execute on function public.shop_signup_target(text, text) to anon, authenticated;

revoke all on function public.organizer_set_shop_visible(uuid, boolean) from public, anon;
grant execute on function public.organizer_set_shop_visible(uuid, boolean) to authenticated;
