-- Optional shop bonus entries. Apply manually. Do not run from the app.
-- One claim per guest per action. Guests cannot change status.

set local lock_timeout = '5s';

create table if not exists public.bonus_actions (
  id uuid primary key default extensions.gen_random_uuid(),
  listing_id uuid not null references public.shop_listings (id) on delete cascade,
  crawl_id text not null references public.crawls (id) on delete cascade,
  kind text not null,
  label text not null,
  url text not null,
  entries integer not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint bonus_actions_kind_check check (kind = any (array['tag'::text, 'follow'::text, 'review'::text])),
  constraint bonus_actions_entries_check check (entries >= 1 and entries <= 20),
  constraint bonus_actions_label_check check (char_length(label) between 1 and 140),
  constraint bonus_actions_url_check check (url ~* '^https?://')
);

create table if not exists public.bonus_claims (
  id uuid primary key default extensions.gen_random_uuid(),
  action_id uuid not null references public.bonus_actions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  proof_url text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint bonus_claims_status_check check (status = any (array['pending'::text, 'approved'::text, 'hidden'::text])),
  constraint bonus_claims_one unique (action_id, user_id)
);

alter table public.bonus_actions enable row level security;
alter table public.bonus_claims enable row level security;

drop policy if exists bonus_actions_public_read on public.bonus_actions;
create policy bonus_actions_public_read on public.bonus_actions
  for select to anon, authenticated
  using (active = true);

drop policy if exists bonus_actions_owner_write on public.bonus_actions;
create policy bonus_actions_owner_write on public.bonus_actions
  for all to authenticated
  using (listing_id in (select l.id from public.shop_listings l where l.owner_user_id = (select auth.uid())))
  with check (listing_id in (select l.id from public.shop_listings l where l.owner_user_id = (select auth.uid())));

drop policy if exists bonus_claims_own_read on public.bonus_claims;
create policy bonus_claims_own_read on public.bonus_claims
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists bonus_claims_owner_read on public.bonus_claims;
create policy bonus_claims_owner_read on public.bonus_claims
  for select to authenticated
  using (action_id in (
    select a.id from public.bonus_actions a
    join public.shop_listings l on l.id = a.listing_id
    where l.owner_user_id = (select auth.uid())
  ));

revoke all on public.bonus_actions from anon, authenticated;
grant select on public.bonus_actions to anon, authenticated;
grant insert, update, delete on public.bonus_actions to authenticated;

revoke all on public.bonus_claims from anon, authenticated;
grant select on public.bonus_claims to authenticated;

create or replace function public.guest_submit_bonus(p_action uuid, p_proof text)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id uuid;
  v_url text := nullif(btrim(coalesce(p_proof, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (select 1 from public.bonus_actions a where a.id = p_action and a.active) then
    raise exception 'That bonus is not available';
  end if;
  if v_url is not null and v_url !~* '^https?://' then
    raise exception 'Proof needs to be a link';
  end if;
  insert into public.bonus_claims (action_id, user_id, proof_url, status)
  values (p_action, (select auth.uid()), v_url, 'pending')
  on conflict (action_id, user_id) do nothing
  returning id into v_id;
  if v_id is null then
    raise exception 'Already submitted';
  end if;
  return v_id;
end;
$function$;

revoke all on function public.guest_submit_bonus(uuid, text) from public, anon;
grant execute on function public.guest_submit_bonus(uuid, text) to authenticated;

create or replace function public.shop_review_bonus(p_claim uuid, p_status text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_status text := lower(btrim(coalesce(p_status, '')));
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if v_status not in ('approved', 'hidden') then
    raise exception 'Unknown status';
  end if;
  update public.bonus_claims c
    set status = v_status
    where c.id = p_claim
      and exists (
        select 1
        from public.bonus_actions a
        join public.shop_listings l on l.id = a.listing_id
        where a.id = c.action_id
          and l.owner_user_id = (select auth.uid())
      );
  if not found then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
end;
$function$;

revoke all on function public.shop_review_bonus(uuid, text) from public, anon;
grant execute on function public.shop_review_bonus(uuid, text) to authenticated;
