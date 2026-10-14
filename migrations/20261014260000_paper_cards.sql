-- Paper-card play and organizer manual stamps. Apply manually. Do not run from the app.
-- Guests still claim stamps through claim_stamp, which keeps the 50 m check.
-- Manual stamps are added only by owner, organizer, co-organizer, or contributor.
-- No anonymous access. No service role is granted here.

set local lock_timeout = '5s';

create table if not exists public.guest_crawls (
  user_id uuid not null references auth.users (id) on delete cascade,
  crawl_id text not null references public.crawls (id) on delete cascade,
  play_mode text not null default 'digital',
  signup_listing_id uuid references public.shop_listings (id) on delete set null,
  terms_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, crawl_id),
  constraint guest_crawls_play_mode_check check (play_mode = any (array['digital'::text, 'paper'::text]))
);

alter table public.guest_crawls enable row level security;
revoke all on public.guest_crawls from public, anon, authenticated;

alter table public.stamps
  add column if not exists source text not null default 'digital';

alter table public.stamps drop constraint if exists stamps_source_check;
alter table public.stamps
  add constraint stamps_source_check check (source = any (array['digital'::text, 'manual'::text]));

create or replace function private.is_crawl_staff(p_crawl text)
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
      and co.role in ('owner', 'organizer', 'co-organizer', 'contributor')
  );
$function$;

revoke all on function private.is_crawl_staff(text) from public, anon, authenticated;

create or replace function public.record_paper_play(
  p_crawl text,
  p_name text,
  p_shop text,
  p_terms boolean
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_name text := left(btrim(coalesce(p_name, '')), 80);
  v_shop text := btrim(coalesce(p_shop, ''));
  v_listing uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_terms is not true then
    raise exception 'Terms are required';
  end if;
  if v_name = '' then
    raise exception 'Name is required';
  end if;
  if not exists (select 1 from public.crawls c where c.id = p_crawl) then
    raise exception 'Unknown crawl';
  end if;

  if v_shop ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select l.id into v_listing
    from public.shop_listings l
    where l.id = v_shop::uuid
      and l.crawl_id = p_crawl;
  end if;
  if v_listing is null and v_shop <> '' then
    select l.id into v_listing
    from public.shop_listings l
    where l.crawl_id = p_crawl
      and l.business_id = v_shop
    order by l.is_paid desc, l.is_visible desc, l.created_at
    limit 1;
  end if;

  perform public.join_crawl(p_crawl);

  insert into public.guest_crawls (user_id, crawl_id, play_mode, signup_listing_id, terms_accepted_at)
  values (v_uid, p_crawl, 'paper', v_listing, now())
  on conflict (user_id, crawl_id) do update
    set play_mode = 'paper',
        signup_listing_id = coalesce(excluded.signup_listing_id, public.guest_crawls.signup_listing_id),
        terms_accepted_at = coalesce(public.guest_crawls.terms_accepted_at, now());

  update public.profiles
    set name = v_name
    where id = v_uid;
  if not found then
    insert into public.profiles (id, name)
    values (v_uid, v_name);
  end if;
end;
$function$;

revoke all on function public.record_paper_play(text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.record_paper_play(text, text, text, boolean) to authenticated;

create or replace function public.my_paper_card(p_crawl text)
returns table (
  crawl_name text,
  player_name text,
  player_email text,
  signup_shop text,
  play_mode text
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  return query
  select
    c.name,
    coalesce(p.name, ''),
    coalesce(u.email, ''),
    coalesce(l.display_name, ''),
    coalesce(g.play_mode, 'digital')
  from public.crawls c
  left join public.profiles p on p.id = (select auth.uid())
  left join auth.users u on u.id = (select auth.uid())
  left join public.guest_crawls g on g.user_id = (select auth.uid()) and g.crawl_id = c.id
  left join public.shop_listings l on l.id = g.signup_listing_id
  where c.id = p_crawl;
end;
$function$;

revoke all on function public.my_paper_card(text) from public, anon, authenticated;
grant execute on function public.my_paper_card(text) to authenticated;

create or replace function public.card_turn_in_shops(p_crawl text)
returns table (
  listing_id uuid,
  display_name text
)
language sql
stable
security definer
set search_path to ''
as $function$
  select distinct on (lower(l.display_name))
    l.id,
    l.display_name
  from public.shop_listings l
  join public.organizers o
    on (
      (l.owner_user_id is not null and o.user_id = l.owner_user_id)
      or lower(o.email) = lower(l.owner_email)
    )
  join public.crawl_organizers co
    on co.organizer_id = o.id
   and co.crawl_id = l.crawl_id
  where l.crawl_id = p_crawl
    and l.is_visible
    and co.role in ('owner', 'organizer', 'co-organizer')
  order by lower(l.display_name), l.is_paid desc, l.display_name;
$function$;

revoke all on function public.card_turn_in_shops(text) from public, anon, authenticated;
grant execute on function public.card_turn_in_shops(text) to authenticated;

create or replace function public.organizer_search_players(p_crawl text, p_query text)
returns table (
  user_id uuid,
  player_name text,
  player_email text,
  play_mode text,
  stamp_count bigint
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_q text := replace(replace(btrim(coalesce(p_query, '')), '%', ''), '_', '');
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not private.is_crawl_staff(p_crawl) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if char_length(v_q) < 2 then
    raise exception 'Enter at least 2 characters';
  end if;
  return query
  select
    j.user_id,
    coalesce(p.name, ''),
    coalesce(u.email, ''),
    coalesce(g.play_mode, 'digital'),
    (
      select count(*)
      from public.stamps s
      where s.user_id = j.user_id
        and s.crawl_id = j.crawl_id
    )
  from public.crawl_joins j
  join auth.users u on u.id = j.user_id
  left join public.profiles p on p.id = j.user_id
  left join public.guest_crawls g on g.user_id = j.user_id and g.crawl_id = j.crawl_id
  where j.crawl_id = p_crawl
    and (
      coalesce(p.name, '') ilike '%' || v_q || '%'
      or coalesce(u.email, '') ilike '%' || v_q || '%'
    )
  order by coalesce(p.name, u.email)
  limit 25;
end;
$function$;

revoke all on function public.organizer_search_players(text, text) from public, anon, authenticated;
grant execute on function public.organizer_search_players(text, text) to authenticated;

create or replace function public.organizer_player_shops(p_crawl text, p_user uuid)
returns table (
  business_id text,
  display_name text,
  stamp_source text
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not private.is_crawl_staff(p_crawl) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
  select
    l.business_id,
    l.display_name,
    s.source
  from public.shop_listings l
  left join public.stamps s
    on s.crawl_id = l.crawl_id
   and s.business_id = l.business_id
   and s.user_id = p_user
  where l.crawl_id = p_crawl
    and l.is_paid
    and l.is_visible
    and l.business_id is not null
  order by l.display_name;
end;
$function$;

revoke all on function public.organizer_player_shops(text, uuid) from public, anon, authenticated;
grant execute on function public.organizer_player_shops(text, uuid) to authenticated;

create or replace function public.organizer_player_card(p_crawl text, p_user uuid)
returns table (
  crawl_name text,
  player_name text,
  player_email text,
  signup_shop text,
  play_mode text
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not private.is_crawl_staff(p_crawl) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
  select
    c.name,
    coalesce(p.name, ''),
    coalesce(u.email, ''),
    coalesce(l.display_name, ''),
    coalesce(g.play_mode, 'digital')
  from public.crawls c
  left join public.profiles p on p.id = p_user
  left join auth.users u on u.id = p_user
  left join public.guest_crawls g on g.user_id = p_user and g.crawl_id = c.id
  left join public.shop_listings l on l.id = g.signup_listing_id
  where c.id = p_crawl;
end;
$function$;

revoke all on function public.organizer_player_card(text, uuid) from public, anon, authenticated;
grant execute on function public.organizer_player_card(text, uuid) to authenticated;

-- Adds or removes a manual stamp. Does not call claim_stamp and does not check the 50 m radius.
-- A digital stamp is left in place.
create or replace function public.organizer_set_manual_stamp(
  p_crawl text,
  p_user uuid,
  p_business text,
  p_on boolean
)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_source text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_user is null or btrim(coalesce(p_business, '')) = '' then
    raise exception 'Player and shop are required';
  end if;
  if not private.is_crawl_staff(p_crawl) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.shop_listings l
    where l.crawl_id = p_crawl
      and l.business_id = p_business
      and l.is_paid
      and l.is_visible
  ) then
    raise exception 'Unknown shop';
  end if;
  if not exists (
    select 1 from public.crawl_joins j
    where j.user_id = p_user and j.crawl_id = p_crawl
  ) then
    raise exception 'That player has not joined this crawl';
  end if;

  select s.source into v_source
  from public.stamps s
  where s.user_id = p_user
    and s.crawl_id = p_crawl
    and s.business_id = p_business;

  if coalesce(p_on, false) then
    if v_source is null then
      insert into public.stamps (user_id, crawl_id, business_id, source)
      values (p_user, p_crawl, p_business, 'manual');
      v_source := 'manual';
    end if;
  elsif v_source = 'manual' then
    delete from public.stamps s
    where s.user_id = p_user
      and s.crawl_id = p_crawl
      and s.business_id = p_business
      and s.source = 'manual';
    v_source := null;
  end if;

  return v_source;
end;
$function$;

revoke all on function public.organizer_set_manual_stamp(text, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.organizer_set_manual_stamp(text, uuid, text, boolean) to authenticated;
