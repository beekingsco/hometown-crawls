-- Guest crawl photos. Apply manually. Do not run from the app.
-- Guests insert a pending row and can delete their own row.
-- They cannot change status. Organizers and contributors moderate
-- through moderate_guest_photo.

set local lock_timeout = '5s';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'guest-photos',
  'guest-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = false,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

create table if not exists public.guest_photos (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  crawl_id text not null references public.crawls (id) on delete cascade,
  shop_id text,
  path text not null unique,
  consent_at timestamptz not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint guest_photos_status_check check (status = any (array['pending'::text, 'approved'::text, 'hidden'::text])),
  constraint guest_photos_path_check check (
    path like user_id::text || '/%'
    and path not like '%..%'
    and path ~* '\.(png|jpe?g|webp|gif)$'
  )
);

alter table public.guest_photos enable row level security;

drop policy if exists guest_photos_select_own on public.guest_photos;
create policy guest_photos_select_own on public.guest_photos
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists guest_photos_insert_own on public.guest_photos;
create policy guest_photos_insert_own on public.guest_photos
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
    and consent_at is not null
    and path like (select auth.uid())::text || '/%'
  );

drop policy if exists guest_photos_delete_own on public.guest_photos;
create policy guest_photos_delete_own on public.guest_photos
  for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.guest_photos from anon, authenticated;
grant select, insert, delete on public.guest_photos to authenticated;

drop policy if exists guest_photos_owner_insert on storage.objects;
create policy guest_photos_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'guest-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists guest_photos_owner_update on storage.objects;
create policy guest_photos_owner_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'guest-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'guest-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists guest_photos_owner_delete on storage.objects;
create policy guest_photos_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'guest-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists guest_photos_owner_select on storage.objects;
create policy guest_photos_owner_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'guest-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists guest_photos_approved_select on storage.objects;
create policy guest_photos_approved_select on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'guest-photos'
    and exists (
      select 1 from public.guest_photos g
      where g.path = name and g.status = 'approved'
    )
  );

create or replace function public.get_public_crawl_photos(p_crawl text)
returns table (id uuid, shop_id text, path text, created_at timestamptz)
language sql
stable
security definer
set search_path to ''
as $function$
  select g.id, g.shop_id, g.path, g.created_at
  from public.guest_photos g
  where g.crawl_id = p_crawl
    and g.status = 'approved'
  order by g.created_at desc
  limit 60;
$function$;

revoke all on function public.get_public_crawl_photos(text) from public;
grant execute on function public.get_public_crawl_photos(text) to anon, authenticated;

create or replace function public.organizer_list_guest_photos(p_crawl text)
returns table (id uuid, shop_id text, path text, status text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select co.role into v_role
  from public.crawl_organizers co
  join public.organizers o on o.id = co.organizer_id
  where co.crawl_id = p_crawl
    and o.user_id = (select auth.uid());
  if v_role is null or v_role not in ('owner', 'organizer', 'co-organizer', 'contributor') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
  select g.id, g.shop_id, g.path, g.status, g.created_at
  from public.guest_photos g
  where g.crawl_id = p_crawl
  order by g.created_at desc
  limit 100;
end;
$function$;

revoke all on function public.organizer_list_guest_photos(text) from public, anon;
grant execute on function public.organizer_list_guest_photos(text) to authenticated;

create or replace function public.moderate_guest_photo(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_crawl text;
  v_role text;
  v_status text := lower(btrim(coalesce(p_status, '')));
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if v_status not in ('approved', 'hidden') then
    raise exception 'Unknown status';
  end if;
  select g.crawl_id into v_crawl from public.guest_photos g where g.id = p_id;
  if v_crawl is null then
    raise exception 'Unknown photo';
  end if;
  select co.role into v_role
  from public.crawl_organizers co
  join public.organizers o on o.id = co.organizer_id
  where co.crawl_id = v_crawl
    and o.user_id = (select auth.uid());
  if v_role is null or v_role not in ('owner', 'organizer', 'co-organizer', 'contributor') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  update public.guest_photos set status = v_status where id = p_id;
end;
$function$;

revoke all on function public.moderate_guest_photo(uuid, text) from public, anon;
grant execute on function public.moderate_guest_photo(uuid, text) to authenticated;
