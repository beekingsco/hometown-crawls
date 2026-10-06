-- Visit selfies: required photo check-in, private originals, public copies.
--
-- APPLY ORDER (do not run this against production until it has been reviewed):
--   1. Apply THIS file first. It adds tables, buckets, policies, and RPCs.
--      public.claim_stamp is intentionally left unchanged, so the live site
--      can still stamp if this lands before the new pages.
--   2. Deploy the new front end (it calls start_checkin / complete_checkin
--      and never calls claim_stamp).
--   3. Apply 20261006141000_close_claim_stamp_without_selfie.sql so a cached
--      copy of the old page cannot stamp without a selfie.
--
-- There is no minimum wait between stamps.
--
-- Staff flag: public.profiles.role = 'staff'. No staff rows exist today.
-- Set one from the SQL editor (this bypasses the API lock):
--   update public.profiles set role = 'staff' where id = '<user uuid>';
-- Authenticated clients cannot change profiles.role.
--
-- Organizer kind lives on public.crawl_organizers.kind
-- ('chamber' | 'person' | 'business'), default 'person'.
-- Existing rows become 'person' via that default.
-- Staff set a chamber with:
--   select public.staff_set_organizer_kind('<crawl id>', '<organizer uuid>', 'chamber');
-- or, from the SQL editor:
--   update public.crawl_organizers
--      set kind = 'chamber'
--    where crawl_id = '<crawl id>' and organizer_id = '<organizer uuid>';
-- Chamber organizers get no selfie reads and no moderation RPCs.
-- Person and business organizers of the event can moderate public-eligible
-- photos. The older role column (owner / organizer / viewer) is not a photo
-- gate: any non-chamber row on the event can moderate.
--
-- Retention: public.purge_expired_checkin_selfies() deletes selfie objects
-- and clears paths 90 days after crawls.ends_at, unless the photo is still
-- approved, publicly opted in, and meets the crawl age bar (18+ coffee,
-- 21+ pub). Crawls with a null ends_at are skipped. pg_cron is scheduled
-- when the extension is available. If it is not, enable pg_cron and run
-- the schedule statements printed below.
--
-- Pub crawls are crawls.type = 'pub' (see private.crawl_is_pub).
--   * The age tick is 21+. Coffee stays 18+.
--   * Only Hometown Crawls staff can read or moderate pub selfies.
--     Organizers of every kind, and shops, cannot.
--   * Nothing auto-publishes. A pub photo is public only after staff
--     approval, the public opt-in, and the 21+ tick.
--   * photo_publish_per_hour starts at 6. Approvals past the cap stay
--     queued, oldest decision first. Unpublishing does not free a slot.
--   * list_visit_photos starts false, so the public site lists no pub
--     photos until staff turn that flag on. Queued pub photos are not
--     promoted while the crawl is unlisted.

-- ---------------------------------------------------------------------------
-- Organizer kind
-- ---------------------------------------------------------------------------

alter table public.crawl_organizers
  add column if not exists kind text not null default 'person';

alter table public.crawl_organizers
  drop constraint if exists crawl_organizers_kind_check;

alter table public.crawl_organizers
  add constraint crawl_organizers_kind_check
  check (kind = any (array['chamber'::text, 'person'::text, 'business'::text]));

comment on column public.crawl_organizers.kind is
  'Per-event organizer kind: chamber (no selfie access), person, or business. Default person.';

-- ---------------------------------------------------------------------------
-- Staff flag lock. Signup metadata must not mint staff.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.profiles (id, name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    'crawler'
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;

create or replace function public.profiles_lock_role()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if tg_op = 'INSERT'
     and auth.role() in ('anon', 'authenticated')
     and new.role is distinct from 'crawler' then
    new.role := 'crawler';
  end if;
  if tg_op = 'UPDATE'
     and new.role is distinct from old.role
     and auth.role() in ('anon', 'authenticated') then
    raise exception 'Role cannot be changed here';
  end if;
  return new;
end;
$function$;

drop trigger if exists profiles_lock_role on public.profiles;
create trigger profiles_lock_role
  before insert or update on public.profiles
  for each row execute function public.profiles_lock_role();

-- ---------------------------------------------------------------------------
-- Stamp photo columns. Nullable selfie_path so the old claim_stamp insert
-- still succeeds until the follow-up migration.
-- ---------------------------------------------------------------------------

alter table public.stamps
  add column if not exists selfie_path text,
  add column if not exists public_opt_in boolean not null default false,
  add column if not exists age_confirmed boolean not null default false,
  add column if not exists min_age smallint not null default 18,
  add column if not exists social_opt_in boolean not null default false,
  add column if not exists moderation_status text not null default 'staff_only',
  add column if not exists public_display_path text,
  add column if not exists shop_hidden boolean not null default false,
  add column if not exists display_label text,
  add column if not exists decided_at timestamptz,
  add column if not exists published_at timestamptz;

alter table public.stamps
  drop constraint if exists stamps_moderation_status_check;

alter table public.stamps
  add constraint stamps_moderation_status_check
  check (moderation_status = any (array[
    'staff_only'::text, 'pending'::text, 'queued'::text, 'approved'::text, 'hidden'::text, 'rejected'::text, 'deleted'::text
  ]));

create unique index if not exists stamps_selfie_path_key
  on public.stamps (selfie_path)
  where selfie_path is not null;

create index if not exists stamps_crawl_moderation_idx
  on public.stamps (crawl_id, moderation_status);

comment on column public.stamps.selfie_path is
  'Private object path in the checkin-selfies bucket. Null only for legacy rows.';
comment on column public.stamps.social_opt_in is
  'Stored consent for Instagram/Facebook reposts. No automation reads this.';
comment on column public.stamps.shop_hidden is
  'When true, an approved public photo is hidden on that shop page only. Ignored for pub crawls; shops never see those photos.';
comment on column public.stamps.age_confirmed is
  'Guest ticked the age box for this crawl. Coffee is 18+. Pub is 21+. The stamp is not public without it.';
comment on column public.stamps.min_age is
  'Age bar copied from the crawl at check-in. 21 when crawls.type is pub, otherwise 18.';
comment on column public.stamps.published_at is
  'When a photo actually went on the public site. Counts toward the hourly publish cap even after it is hidden.';

alter table public.crawls
  add column if not exists photo_publish_per_hour integer,
  add column if not exists list_visit_photos boolean;

update public.crawls
set list_visit_photos = lower(btrim(coalesce(type, ''))) is distinct from 'pub'
where list_visit_photos is null;

alter table public.crawls
  alter column list_visit_photos set default true;

alter table public.crawls
  alter column list_visit_photos set not null;

update public.crawls
set photo_publish_per_hour = 6
where lower(btrim(coalesce(type, ''))) = 'pub'
  and photo_publish_per_hour is null;

comment on column public.crawls.photo_publish_per_hour is
  'Max visit photos newly published per hour. Null means no cap (coffee). Pub crawls start at 6. Staff can change it. 0 holds the queue.';
comment on column public.crawls.list_visit_photos is
  'When false, public_visit_photos returns nothing for this crawl. Pub crawls stay false until staff turn them on.';

alter table public.crawls
  drop constraint if exists crawls_photo_publish_per_hour_check;

alter table public.crawls
  add constraint crawls_photo_publish_per_hour_check
  check (photo_publish_per_hour is null or photo_publish_per_hour >= 0);

create or replace function public.crawls_hide_new_pub_photos()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if tg_op = 'INSERT' and lower(btrim(coalesce(new.type, ''))) = 'pub' then
    new.list_visit_photos := false;
    if new.photo_publish_per_hour is null then
      new.photo_publish_per_hour := 6;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists crawls_hide_new_pub_photos on public.crawls;
create trigger crawls_hide_new_pub_photos
  before insert on public.crawls
  for each row execute function public.crawls_hide_new_pub_photos();

-- ---------------------------------------------------------------------------
-- Pending check-ins and reports
-- ---------------------------------------------------------------------------

create table if not exists public.checkin_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  crawl_id text not null references public.crawls (id) on delete cascade,
  business_id text not null references public.businesses (id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  completed_at timestamptz
);

create index if not exists checkin_sessions_user_idx
  on public.checkin_sessions (user_id, crawl_id, business_id);

create table if not exists public.photo_reports (
  id uuid primary key default gen_random_uuid(),
  stamp_id uuid not null references public.stamps (id) on delete cascade,
  reporter_id uuid references public.profiles (id) on delete set null,
  note text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  constraint photo_reports_status_check check (status = any (array['open'::text, 'reviewed'::text])),
  constraint photo_reports_note_len check (note is null or char_length(note) <= 500)
);

create index if not exists photo_reports_stamp_idx
  on public.photo_reports (stamp_id, status);

alter table public.checkin_sessions enable row level security;
alter table public.photo_reports enable row level security;

revoke all on table public.checkin_sessions from public, anon, authenticated;
revoke all on table public.photo_reports from public, anon, authenticated;
grant select, insert, update, delete on table public.checkin_sessions to service_role;
grant select, insert, update, delete on table public.photo_reports to service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.photo_display_label(p_name text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select case
    when nullif(btrim(coalesce(p_name, '')), '') is null then 'Guest'
    else left(split_part(btrim(p_name), ' ', 1), 40)
  end;
$function$;

create or replace function private.is_hc_staff()
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'staff'
  );
$function$;

create or replace function private.crawl_is_pub(p_crawl text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1
    from public.crawls c
    where c.id = p_crawl
      and lower(btrim(coalesce(c.type, ''))) = 'pub'
  );
$function$;

create or replace function private.crawl_min_age(p_crawl text)
returns integer
language sql
stable
security definer
set search_path to ''
as $function$
  select case when private.crawl_is_pub(p_crawl) then 21 else 18 end;
$function$;

create or replace function private.visit_photo_eligible(
  p_crawl text,
  p_opt_in boolean,
  p_age boolean,
  p_min_age integer
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(p_opt_in, false)
    and coalesce(p_age, false)
    and coalesce(p_min_age, 0) >= private.crawl_min_age(p_crawl);
$function$;

-- Coffee: staff, or a person/business organizer. Chamber organizers are excluded.
-- Pub: staff only. Organizers of every kind, and shops, cannot moderate pub photos.
create or replace function private.can_moderate_visit_photos(p_crawl text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select private.is_hc_staff()
    or (
      not private.crawl_is_pub(p_crawl)
      and exists (
        select 1
        from public.crawl_organizers co
        join public.organizers o on o.id = co.organizer_id
        where co.crawl_id = p_crawl
          and o.user_id = (select auth.uid())
          and co.kind in ('person', 'business')
      )
    );
$function$;

create or replace function private.owns_business(p_business text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1 from public.businesses b
    where b.id = p_business
      and b.owner_user_id = (select auth.uid())
  )
  or exists (
    select 1 from public.shop_listings l
    where l.business_id = p_business
      and l.owner_user_id = (select auth.uid())
  );
$function$;

create or replace function private.shop_label(p_crawl text, p_business text)
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(
    (
      select l.display_name
      from public.shop_listings l
      where l.crawl_id = p_crawl
        and l.business_id = p_business
      order by l.is_paid desc, l.updated_at desc nulls last
      limit 1
    ),
    (select b.name from public.businesses b where b.id = p_business),
    'Shop'
  );
$function$;

-- Same code, membership, location, and 150 m rules as public.claim_stamp.
-- Does not insert a stamp and does not impose a wait between stamps.
create or replace function private.validate_checkin(
  p_crawl text,
  p_business text,
  p_code text,
  p_lat double precision,
  p_lng double precision
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  c_radius_m constant double precision := 150;
  v_uid uuid := auth.uid();
  v_biz jsonb;
  v_listing jsonb;
  v_code text := btrim(coalesce(p_code, ''));
  v_store_biz text;
  v_store_listing text;
  v_qr_biz text;
  v_qr_listing text;
  v_shop_lat double precision;
  v_shop_lng double precision;
  v_dist_m double precision;
  v_member boolean := false;
  v_match boolean := false;
  v_shop_name text;
  v_crawl_name text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.crawl_joins j
    where j.user_id = v_uid
      and j.crawl_id = p_crawl
  ) then
    perform public.join_crawl(p_crawl);
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
  order by (l.lat is not null and l.lng is not null) desc
  limit 1;

  v_member := exists (
    select 1
    from public.memberships m
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

  if not v_match then
    raise exception 'Invalid code';
  end if;

  if p_lat is null or p_lng is null then
    raise exception 'Location required';
  end if;

  if v_listing is not null
     and nullif(v_listing->>'lat', '') is not null
     and nullif(v_listing->>'lng', '') is not null then
    v_shop_lat := (v_listing->>'lat')::double precision;
    v_shop_lng := (v_listing->>'lng')::double precision;
  elsif v_biz is not null
     and nullif(v_biz->>'lat', '') is not null
     and nullif(v_biz->>'lng', '') is not null then
    v_shop_lat := (v_biz->>'lat')::double precision;
    v_shop_lng := (v_biz->>'lng')::double precision;
  end if;

  if v_shop_lat is not null and v_shop_lng is not null then
    v_dist_m := 6371000 * 2 * asin(sqrt(
      power(sin(radians(p_lat - v_shop_lat) / 2), 2) +
      cos(radians(v_shop_lat)) * cos(radians(p_lat)) *
      power(sin(radians(p_lng - v_shop_lng) / 2), 2)
    ));
    if v_dist_m > c_radius_m then
      raise exception 'You need to be at the shop';
    end if;
  end if;

  if exists (
    select 1
    from public.stamps s
    where s.user_id = v_uid
      and s.crawl_id = p_crawl
      and s.business_id = p_business
  ) then
    raise exception 'Already stamped';
  end if;

  v_shop_name := coalesce(nullif(btrim(v_listing->>'display_name'), ''), nullif(btrim(v_biz->>'name'), ''), 'Shop');
  select c.name into v_crawl_name from public.crawls c where c.id = p_crawl;

  return jsonb_build_object(
    'shop_name', v_shop_name,
    'crawl_name', coalesce(v_crawl_name, 'Hometown Crawl')
  );
end;
$function$;

create or replace function private.checkin_selfie_path_ok(p_name text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1
    from public.checkin_sessions s
    where s.user_id = (select auth.uid())
      and s.completed_at is null
      and s.expires_at > now()
      and p_name = (s.user_id::text || '/' || s.id::text || '.jpg')
  );
$function$;

create or replace function private.display_photo_path_ok(p_name text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1
    from public.stamps s
    where p_name = (s.crawl_id || '/' || s.id::text || '.jpg')
      and private.visit_photo_eligible(s.crawl_id, s.public_opt_in, s.age_confirmed, s.min_age)
      and s.moderation_status in ('pending', 'queued', 'approved', 'hidden', 'rejected')
      and private.can_moderate_visit_photos(s.crawl_id)
  );
$function$;

create or replace function private.can_read_checkin_selfie(p_name text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select
    split_part(coalesce(p_name, ''), '/', 1) = (select auth.uid())::text
    or private.is_hc_staff()
    or exists (
      select 1
      from public.stamps s
      where s.selfie_path = p_name
        and private.visit_photo_eligible(s.crawl_id, s.public_opt_in, s.age_confirmed, s.min_age)
        and private.can_moderate_visit_photos(s.crawl_id)
        and not private.crawl_is_pub(s.crawl_id)
    );
$function$;

create or replace function private.unpublish_visit_photo(p_stamp uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_path text;
begin
  select s.public_display_path into v_path
  from public.stamps s
  where s.id = p_stamp;

  if v_path is not null and btrim(v_path) <> '' then
    begin
      delete from storage.objects
      where bucket_id = 'checkin-display'
        and name = v_path;
    exception
      when others then
        raise warning 'Could not delete display object %: %', v_path, sqlerrm;
    end;
  end if;

  update public.stamps
  set public_display_path = null
  where id = p_stamp;
end;
$function$;

revoke all on function public.photo_display_label(text) from public;
revoke all on function private.is_hc_staff() from public;
revoke all on function private.crawl_is_pub(text) from public;
revoke all on function private.crawl_min_age(text) from public;
revoke all on function private.visit_photo_eligible(text, boolean, boolean, integer) from public;
revoke all on function private.can_moderate_visit_photos(text) from public;
revoke all on function private.owns_business(text) from public;
revoke all on function private.shop_label(text, text) from public;
revoke all on function private.validate_checkin(text, text, text, double precision, double precision) from public;
revoke all on function private.checkin_selfie_path_ok(text) from public;
revoke all on function private.display_photo_path_ok(text) from public;
revoke all on function private.can_read_checkin_selfie(text) from public;
revoke all on function private.unpublish_visit_photo(uuid) from public;

grant execute on function private.is_hc_staff() to authenticated, service_role;
grant execute on function private.crawl_is_pub(text) to authenticated, service_role;
grant execute on function private.crawl_min_age(text) to authenticated, service_role;
grant execute on function private.visit_photo_eligible(text, boolean, boolean, integer) to authenticated, service_role;
grant execute on function private.can_moderate_visit_photos(text) to authenticated, service_role;
grant execute on function private.owns_business(text) to authenticated, service_role;
grant execute on function private.checkin_selfie_path_ok(text) to authenticated, service_role;
grant execute on function private.display_photo_path_ok(text) to authenticated, service_role;
grant execute on function private.can_read_checkin_selfie(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Buckets. Originals are private. Display copies are public and contain
-- only the already-resized JPEG (no EXIF / location).
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('checkin-selfies', 'checkin-selfies', false, 2097152, array['image/jpeg']::text[]),
  ('checkin-display', 'checkin-display', true, 2097152, array['image/jpeg']::text[])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists checkin_selfies_insert on storage.objects;
create policy checkin_selfies_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'checkin-selfies'
    and private.checkin_selfie_path_ok(name)
  );

drop policy if exists checkin_selfies_select on storage.objects;
create policy checkin_selfies_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'checkin-selfies'
    and private.can_read_checkin_selfie(name)
  );

drop policy if exists checkin_selfies_delete_own on storage.objects;
create policy checkin_selfies_delete_own
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'checkin-selfies'
    and split_part(name, '/', 1) = (select auth.uid())::text
  );

drop policy if exists checkin_display_insert on storage.objects;
create policy checkin_display_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'checkin-display'
    and private.display_photo_path_ok(name)
  );

drop policy if exists checkin_display_update on storage.objects;
create policy checkin_display_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'checkin-display'
    and private.display_photo_path_ok(name)
  )
  with check (
    bucket_id = 'checkin-display'
    and private.display_photo_path_ok(name)
  );

drop policy if exists checkin_display_select on storage.objects;
create policy checkin_display_select
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'checkin-display');

create or replace function private.can_delete_display_photo(p_name text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1
    from public.stamps s
    where s.public_display_path = p_name
      and (
        s.user_id = (select auth.uid())
        or private.can_moderate_visit_photos(s.crawl_id)
      )
  );
$function$;

revoke all on function private.can_delete_display_photo(text) from public;
grant execute on function private.can_delete_display_photo(text) to authenticated, service_role;

drop policy if exists checkin_display_delete on storage.objects;
create policy checkin_display_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'checkin-display'
    and private.can_delete_display_photo(name)
  );

-- ---------------------------------------------------------------------------
-- Check-in RPCs
-- ---------------------------------------------------------------------------

create or replace function public.start_checkin(
  p_crawl text,
  p_business text,
  p_code text,
  p_lat double precision default null,
  p_lng double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_meta jsonb;
  v_id uuid;
  v_expires timestamptz;
begin
  v_meta := private.validate_checkin(p_crawl, p_business, p_code, p_lat, p_lng);

  delete from storage.objects o
  using public.checkin_sessions s
  where o.bucket_id = 'checkin-selfies'
    and s.user_id = v_uid
    and s.crawl_id = p_crawl
    and s.business_id = p_business
    and s.completed_at is null
    and o.name = (s.user_id::text || '/' || s.id::text || '.jpg');

  delete from public.checkin_sessions s
  where s.user_id = v_uid
    and s.crawl_id = p_crawl
    and s.business_id = p_business
    and s.completed_at is null;

  insert into public.checkin_sessions (user_id, crawl_id, business_id, lat, lng)
  values (v_uid, p_crawl, p_business, p_lat, p_lng)
  returning id, expires_at into v_id, v_expires;

  return jsonb_build_object(
    'checkin_id', v_id,
    'selfie_path', v_uid::text || '/' || v_id::text || '.jpg',
    'crawl_id', p_crawl,
    'crawl_name', v_meta->>'crawl_name',
    'business_id', p_business,
    'shop_name', v_meta->>'shop_name',
    'expires_at', v_expires,
    'min_age', private.crawl_min_age(p_crawl),
    'crawl_type', case when private.crawl_is_pub(p_crawl) then 'pub' else 'coffee' end
  );
end;
$function$;

create or replace function public.complete_checkin(
  p_checkin uuid,
  p_selfie_path text,
  p_public_opt_in boolean,
  p_age_confirmed boolean,
  p_social_opt_in boolean
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_session public.checkin_sessions%rowtype;
  v_public boolean := coalesce(p_public_opt_in, false);
  v_age boolean := coalesce(p_age_confirmed, false);
  v_social boolean := coalesce(p_social_opt_in, false);
  v_status text;
  v_label text;
  v_name text;
  v_stamp uuid;
  v_shop text;
  v_crawl text;
  v_min_age integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_session
  from public.checkin_sessions s
  where s.id = p_checkin
    and s.user_id = v_uid;

  if not found then
    raise exception 'Check-in expired';
  end if;

  if v_session.completed_at is not null then
    raise exception 'Check-in expired';
  end if;

  if v_session.expires_at <= now() then
    raise exception 'Check-in expired';
  end if;

  if p_selfie_path is distinct from (v_uid::text || '/' || v_session.id::text || '.jpg') then
    raise exception 'Selfie required';
  end if;

  if not exists (
    select 1
    from storage.objects o
    where o.bucket_id = 'checkin-selfies'
      and o.name = p_selfie_path
      and (
        o.metadata->>'mimetype' is null
        or o.metadata->>'mimetype' in ('image/jpeg', 'image/jpg')
      )
      and (
        o.owner is null
        or o.owner = v_uid
        or o.owner_id = v_uid::text
      )
  ) then
    raise exception 'Selfie required';
  end if;

  if exists (
    select 1
    from public.stamps s
    where s.user_id = v_uid
      and s.crawl_id = v_session.crawl_id
      and s.business_id = v_session.business_id
  ) then
    raise exception 'Already stamped';
  end if;

  -- Nothing is public at check-in. Pub and coffee both wait for a person to approve.
  -- The age tick does not grant the stamp. Missing opt-in or age keeps the photo staff-only.
  v_min_age := private.crawl_min_age(v_session.crawl_id);
  if v_public and v_age then
    v_status := 'pending';
  else
    v_status := 'staff_only';
  end if;

  select p.name into v_name from public.profiles p where p.id = v_uid;
  v_label := public.photo_display_label(v_name);

  begin
    insert into public.stamps (
      user_id, crawl_id, business_id, lat, lng,
      selfie_path, public_opt_in, age_confirmed, min_age, social_opt_in,
      moderation_status, display_label
    )
    values (
      v_uid, v_session.crawl_id, v_session.business_id, v_session.lat, v_session.lng,
      p_selfie_path, v_public and v_age, v_age, v_min_age, v_social,
      v_status, v_label
    )
    returning id into v_stamp;
  exception
    when unique_violation then
      raise exception 'Already stamped';
  end;

  update public.checkin_sessions
  set completed_at = now()
  where id = v_session.id;

  v_shop := private.shop_label(v_session.crawl_id, v_session.business_id);
  select c.name into v_crawl from public.crawls c where c.id = v_session.crawl_id;

  return jsonb_build_object(
    'stamp_id', v_stamp,
    'crawl_id', v_session.crawl_id,
    'crawl_name', coalesce(v_crawl, 'Hometown Crawl'),
    'business_id', v_session.business_id,
    'shop_name', v_shop,
    'moderation_status', v_status,
    'public_opt_in', v_public and v_age,
    'age_confirmed', v_age,
    'min_age', v_min_age,
    'social_opt_in', v_social,
    'display_label', v_label
  );
end;
$function$;

create or replace function public.my_visit_photos(p_crawl text default null)
returns table (
  stamp_id uuid,
  crawl_id text,
  crawl_name text,
  business_id text,
  shop_name text,
  claimed_at timestamptz,
  selfie_path text,
  public_opt_in boolean,
  age_confirmed boolean,
  min_age integer,
  crawl_type text,
  social_opt_in boolean,
  moderation_status text,
  public_display_path text,
  display_label text
)
language sql
stable
security definer
set search_path to ''
as $function$
  select
    s.id,
    s.crawl_id,
    c.name,
    s.business_id,
    private.shop_label(s.crawl_id, s.business_id),
    s.claimed_at,
    s.selfie_path,
    s.public_opt_in,
    s.age_confirmed,
    s.min_age::integer,
    case when lower(btrim(coalesce(c.type, ''))) = 'pub' then 'pub' else 'coffee' end,
    s.social_opt_in,
    s.moderation_status,
    s.public_display_path,
    s.display_label
  from public.stamps s
  join public.crawls c on c.id = s.crawl_id
  where s.user_id = (select auth.uid())
    and s.selfie_path is not null
    and (p_crawl is null or p_crawl = '' or s.crawl_id = p_crawl)
  order by s.claimed_at desc;
$function$;

create or replace function public.set_my_photo_choices(
  p_stamp uuid,
  p_public boolean,
  p_age boolean,
  p_social boolean
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_row public.stamps%rowtype;
  v_public boolean := coalesce(p_public, false);
  v_age boolean := coalesce(p_age, false);
  v_social boolean := coalesce(p_social, false);
  v_status text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_row
  from public.stamps s
  where s.id = p_stamp
    and s.user_id = v_uid;

  if not found then
    raise exception 'Unknown photo';
  end if;

  if not (v_public and v_age) then
    perform private.unpublish_visit_photo(p_stamp);
    v_status := 'staff_only';
    v_public := false;
  elsif v_row.moderation_status = 'approved'
     and v_row.public_opt_in
     and v_row.age_confirmed
     and v_row.public_display_path is not null then
    v_status := 'approved';
  elsif v_row.moderation_status = 'queued'
     and v_row.public_opt_in
     and v_row.age_confirmed then
    v_status := 'queued';
  elsif v_row.moderation_status = 'hidden'
     and v_row.public_opt_in
     and v_row.age_confirmed then
    v_status := 'hidden';
  elsif v_row.moderation_status = 'rejected'
     and v_row.public_opt_in
     and v_row.age_confirmed then
    v_status := 'rejected';
  else
    perform private.unpublish_visit_photo(p_stamp);
    v_status := 'pending';
  end if;

  update public.stamps
  set public_opt_in = (v_status <> 'staff_only') and v_public and v_age,
      age_confirmed = v_age,
      social_opt_in = v_social,
      moderation_status = v_status
  where id = p_stamp;

  return jsonb_build_object(
    'stamp_id', p_stamp,
    'public_opt_in', (v_status <> 'staff_only') and v_public and v_age,
    'age_confirmed', v_age,
    'social_opt_in', v_social,
    'moderation_status', v_status
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Public gallery and reports
-- ---------------------------------------------------------------------------

create or replace function public.public_visit_photos(
  p_crawl text,
  p_business text default null
)
returns table (
  stamp_id uuid,
  business_id text,
  shop_name text,
  display_label text,
  public_path text,
  claimed_at timestamptz,
  show_on_shop boolean
)
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform private.release_queued_visit_photos(p_crawl);
  return query
  select
    s.id,
    s.business_id,
    private.shop_label(s.crawl_id, s.business_id),
    coalesce(s.display_label, 'Guest'),
    s.public_display_path,
    s.claimed_at,
    not s.shop_hidden
  from public.stamps s
  join public.crawls c on c.id = s.crawl_id
  where s.crawl_id = p_crawl
    and c.list_visit_photos
    and s.moderation_status = 'approved'
    and private.visit_photo_eligible(s.crawl_id, s.public_opt_in, s.age_confirmed, s.min_age)
    and s.public_display_path is not null
    and (
      p_business is null
      or p_business = ''
      or (s.business_id = p_business and s.shop_hidden = false)
    )
    order by s.claimed_at desc
  limit 80;
end;
$function$;

create or replace function public.report_visit_photo(
  p_stamp uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 500);
begin
  if v_uid is null then
    raise exception 'Sign in to report this photo';
  end if;

  if not exists (
    select 1
    from public.stamps s
    join public.crawls c on c.id = s.crawl_id
    where s.id = p_stamp
      and c.list_visit_photos
      and s.moderation_status = 'approved'
      and private.visit_photo_eligible(s.crawl_id, s.public_opt_in, s.age_confirmed, s.min_age)
      and s.public_display_path is not null
  ) then
    raise exception 'Unknown photo';
  end if;

  if exists (
    select 1
    from public.photo_reports r
    where r.stamp_id = p_stamp
      and r.reporter_id = v_uid
      and r.status = 'open'
  ) then
    return jsonb_build_object('stamp_id', p_stamp, 'reported', true);
  end if;

  insert into public.photo_reports (stamp_id, reporter_id, note)
  values (p_stamp, v_uid, v_note);

  return jsonb_build_object('stamp_id', p_stamp, 'reported', true);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Moderation. Chamber organizers fail closed. Staff can moderate every crawl.
-- ---------------------------------------------------------------------------

create or replace function public.visit_photo_access(p_crawl text)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_kind text;
begin
  if (select auth.uid()) is null then
    return jsonb_build_object('allowed', false, 'staff', false);
  end if;

  if private.is_hc_staff() then
    return jsonb_build_object(
      'allowed', true,
      'staff', true,
      'pub', private.crawl_is_pub(p_crawl),
      'min_age', private.crawl_min_age(p_crawl),
      'photo_publish_per_hour', (select c.photo_publish_per_hour from public.crawls c where c.id = p_crawl),
      'published_last_hour', private.photos_published_last_hour(p_crawl),
      'list_visit_photos', (select c.list_visit_photos from public.crawls c where c.id = p_crawl)
    );
  end if;

  -- Pub photos are staff-only. Organizers of any kind get no queue and no selfie access.
  if private.crawl_is_pub(p_crawl) then
    return jsonb_build_object('allowed', false, 'staff', false, 'pub', true, 'min_age', 21);
  end if;

  select co.kind into v_kind
  from public.crawl_organizers co
  join public.organizers o on o.id = co.organizer_id
  where co.crawl_id = p_crawl
    and o.user_id = (select auth.uid());

  if v_kind in ('person', 'business') then
    return jsonb_build_object('allowed', true, 'staff', false, 'pub', false, 'min_age', 18, 'kind', v_kind);
  end if;

  if v_kind = 'chamber' then
    return jsonb_build_object('allowed', false, 'staff', false, 'kind', 'chamber');
  end if;

  return jsonb_build_object('allowed', false, 'staff', false);
end;
$function$;

create or replace function public.am_hc_staff()
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select private.is_hc_staff();
$function$;

create or replace function public.staff_photo_crawls()
returns table (
  crawl_id text,
  name text,
  city text,
  starts_at timestamptz,
  ends_at timestamptz
)
language sql
stable
security definer
set search_path to ''
as $function$
  select c.id, c.name, c.city, c.starts_at, c.ends_at
  from public.crawls c
  where private.is_hc_staff()
  order by c.starts_at nulls last, c.name;
$function$;

create or replace function public.staff_list_organizers(p_crawl text)
returns table (
  organizer_id uuid,
  email text,
  name text,
  role text,
  kind text
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not private.is_hc_staff() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
  select o.id, o.email, o.name, co.role, co.kind
  from public.crawl_organizers co
  join public.organizers o on o.id = co.organizer_id
  where co.crawl_id = p_crawl
  order by o.email;
end;
$function$;

create or replace function public.staff_set_organizer_kind(
  p_crawl text,
  p_organizer uuid,
  p_kind text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_kind text := lower(btrim(coalesce(p_kind, '')));
begin
  if not private.is_hc_staff() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if v_kind not in ('chamber', 'person', 'business') then
    raise exception 'Unknown organizer kind';
  end if;

  update public.crawl_organizers
  set kind = v_kind
  where crawl_id = p_crawl
    and organizer_id = p_organizer;

  if not found then
    raise exception 'Unknown organizer';
  end if;

  return jsonb_build_object('crawl_id', p_crawl, 'organizer_id', p_organizer, 'kind', v_kind);
end;
$function$;

create or replace function public.visit_photo_queue(
  p_crawl text,
  p_filter text
)
returns table (
  stamp_id uuid,
  crawl_id text,
  business_id text,
  shop_name text,
  display_label text,
  claimed_at timestamptz,
  moderation_status text,
  public_opt_in boolean,
  age_confirmed boolean,
  social_opt_in boolean,
  selfie_path text,
  public_display_path text,
  shop_hidden boolean,
  report_count bigint,
  latest_report_note text
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_filter text := lower(btrim(coalesce(p_filter, '')));
begin
  if v_filter = 'staff_only' then
    if not private.is_hc_staff() then
      raise exception 'Not authorized' using errcode = '42501';
    end if;
  elsif not private.can_moderate_visit_photos(p_crawl) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if v_filter not in ('pending', 'queued', 'approved', 'hidden', 'rejected', 'reported', 'staff_only') then
    raise exception 'Unknown filter';
  end if;

  return query
  select
    s.id,
    s.crawl_id,
    s.business_id,
    private.shop_label(s.crawl_id, s.business_id),
    coalesce(s.display_label, 'Guest'),
    s.claimed_at,
    s.moderation_status,
    s.public_opt_in,
    s.age_confirmed,
    s.social_opt_in,
    s.selfie_path,
    s.public_display_path,
    s.shop_hidden,
    (
      select count(*)
      from public.photo_reports r
      where r.stamp_id = s.id
        and r.status = 'open'
    ),
    (
      select r.note
      from public.photo_reports r
      where r.stamp_id = s.id
        and r.status = 'open'
      order by r.created_at desc
      limit 1
    )
  from public.stamps s
  where s.crawl_id = p_crawl
    and s.selfie_path is not null
    and (
      (
        v_filter = 'staff_only'
        and (
          s.moderation_status = 'staff_only'
          or not private.visit_photo_eligible(s.crawl_id, s.public_opt_in, s.age_confirmed, s.min_age)
        )
      )
      or (
        v_filter = 'reported'
        and private.visit_photo_eligible(s.crawl_id, s.public_opt_in, s.age_confirmed, s.min_age)
        and exists (
          select 1 from public.photo_reports r
          where r.stamp_id = s.id
            and r.status = 'open'
        )
      )
      or (
        v_filter in ('pending', 'queued', 'approved', 'hidden', 'rejected')
        and s.moderation_status = v_filter
        and private.visit_photo_eligible(s.crawl_id, s.public_opt_in, s.age_confirmed, s.min_age)
      )
    )
  order by s.decided_at nulls last, s.claimed_at desc
  limit 100;
end;
$function$;

create or replace function private.photos_published_last_hour(p_crawl text)
returns integer
language sql
stable
security definer
set search_path to ''
as $function$
  select count(*)::integer
  from public.stamps s
  where s.crawl_id = p_crawl
    and s.published_at is not null
    and s.published_at > now() - interval '1 hour';
$function$;

-- Promotes queued photos in decided_at order until the hourly cap is full.
-- A null cap publishes the whole queue. Zero publishes nothing.
create or replace function private.release_queued_visit_photos(p_crawl text)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_cap integer;
  v_listed boolean;
  v_slots integer;
  n integer := 0;
  r record;
begin
  perform pg_advisory_xact_lock(hashtext('visit-photo:' || coalesce(p_crawl, '')));

  select c.photo_publish_per_hour, c.list_visit_photos
    into v_cap, v_listed
  from public.crawls c
  where c.id = p_crawl;

  -- An unlisted crawl (every pub crawl until staff turn photos on) must
  -- not promote the queue. That keeps a hidden crawl from building a
  -- backlog that would all appear the moment it is listed.
  if not coalesce(v_listed, false) then
    return 0;
  end if;

  if v_cap is null then
    update public.stamps s
    set moderation_status = 'approved',
        published_at = now()
    where s.crawl_id = p_crawl
      and s.moderation_status = 'queued'
      and s.public_display_path is not null
      and private.visit_photo_eligible(s.crawl_id, s.public_opt_in, s.age_confirmed, s.min_age);
    get diagnostics n = row_count;
    return n;
  end if;

  v_slots := greatest(v_cap - private.photos_published_last_hour(p_crawl), 0);

  for r in
    select s.id
    from public.stamps s
    where s.crawl_id = p_crawl
      and s.moderation_status = 'queued'
      and s.public_display_path is not null
      and private.visit_photo_eligible(s.crawl_id, s.public_opt_in, s.age_confirmed, s.min_age)
    order by s.decided_at nulls last, s.claimed_at
    limit v_slots
  loop
    update public.stamps
    set moderation_status = 'approved',
        published_at = now()
    where id = r.id
      and moderation_status = 'queued';
    n := n + 1;
  end loop;

  return n;
end;
$function$;

-- Staff (or a coffee organizer) already checked the caller. This only places the photo.
create or replace function private.place_approved_visit_photo(p_stamp uuid, p_path text)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_crawl text;
  v_cap integer;
  v_listed boolean;
  v_status text;
begin
  select s.crawl_id into v_crawl from public.stamps s where s.id = p_stamp;
  if v_crawl is null then
    raise exception 'Unknown photo';
  end if;

  perform pg_advisory_xact_lock(hashtext('visit-photo:' || v_crawl));
  perform private.release_queued_visit_photos(v_crawl);

  select c.photo_publish_per_hour, c.list_visit_photos
    into v_cap, v_listed
  from public.crawls c
  where c.id = v_crawl;

  if not coalesce(v_listed, false) then
    v_status := 'queued';
  elsif v_cap is null or private.photos_published_last_hour(v_crawl) < v_cap then
    v_status := 'approved';
  else
    v_status := 'queued';
  end if;

  update public.stamps
  set moderation_status = v_status,
      public_display_path = p_path,
      decided_at = now(),
      published_at = case when v_status = 'approved' then now() else null end
  where id = p_stamp;

  return v_status;
end;
$function$;

create or replace function public.moderate_visit_photo(
  p_stamp uuid,
  p_action text,
  p_display_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_row public.stamps%rowtype;
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_expected text;
  v_placed text;
begin
  select * into v_row from public.stamps where id = p_stamp;
  if not found then
    raise exception 'Unknown photo';
  end if;

  if v_action = 'dismiss_reports' and private.is_hc_staff() then
    null;
  elsif not private.can_moderate_visit_photos(v_row.crawl_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if v_action <> 'dismiss_reports' or not private.is_hc_staff() then
    if not private.visit_photo_eligible(v_row.crawl_id, v_row.public_opt_in, v_row.age_confirmed, v_row.min_age) then
      raise exception 'Not authorized' using errcode = '42501';
    end if;
  end if;

  v_expected := v_row.crawl_id || '/' || v_row.id::text || '.jpg';

  if v_action = 'approve' then
    if p_display_path is distinct from v_expected then
      raise exception 'Invalid selfie path';
    end if;
    if not exists (
      select 1
      from storage.objects o
      where o.bucket_id = 'checkin-display'
        and o.name = v_expected
    ) then
      raise exception 'Selfie required';
    end if;
    v_placed := private.place_approved_visit_photo(p_stamp, v_expected);
  elsif v_action in ('hide', 'unpublish') then
    perform private.unpublish_visit_photo(p_stamp);
    update public.stamps
    set moderation_status = 'hidden',
        decided_at = now()
    where id = p_stamp;
  elsif v_action = 'reject' then
    perform private.unpublish_visit_photo(p_stamp);
    update public.stamps
    set moderation_status = 'rejected',
        decided_at = now()
    where id = p_stamp;
  elsif v_action = 'delete' then
    perform private.unpublish_visit_photo(p_stamp);
    update public.stamps
    set moderation_status = 'deleted',
        public_opt_in = false
    where id = p_stamp;
  elsif v_action = 'dismiss_reports' then
    update public.photo_reports
    set status = 'reviewed'
    where stamp_id = p_stamp
      and status = 'open';
  else
    raise exception 'Unknown action';
  end if;

  return jsonb_build_object(
    'stamp_id', p_stamp,
    'action', v_action,
    'moderation_status', coalesce(v_placed, (select s.moderation_status from public.stamps s where s.id = p_stamp))
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Shop portal: approved public photos at their shop only
-- ---------------------------------------------------------------------------

create or replace function public.shop_visit_photos(p_business text)
returns table (
  stamp_id uuid,
  crawl_id text,
  crawl_name text,
  display_label text,
  public_display_path text,
  claimed_at timestamptz,
  shop_hidden boolean
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not private.owns_business(p_business) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
  select
    s.id,
    s.crawl_id,
    c.name,
    coalesce(s.display_label, 'Guest'),
    s.public_display_path,
    s.claimed_at,
    s.shop_hidden
  from public.stamps s
  join public.crawls c on c.id = s.crawl_id
  where s.business_id = p_business
    and not private.crawl_is_pub(s.crawl_id)
    and s.moderation_status = 'approved'
    and private.visit_photo_eligible(s.crawl_id, s.public_opt_in, s.age_confirmed, s.min_age)
    and s.public_display_path is not null
  order by s.claimed_at desc
  limit 40;
end;
$function$;

create or replace function public.shop_set_photo_hidden(
  p_stamp uuid,
  p_hidden boolean
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_row public.stamps%rowtype;
begin
  select * into v_row from public.stamps where id = p_stamp;
  if not found then
    raise exception 'Unknown photo';
  end if;

  if private.crawl_is_pub(v_row.crawl_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if not private.owns_business(v_row.business_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if v_row.moderation_status <> 'approved'
     or not private.visit_photo_eligible(v_row.crawl_id, v_row.public_opt_in, v_row.age_confirmed, v_row.min_age)
     or v_row.public_display_path is null then
    raise exception 'Unknown photo';
  end if;

  update public.stamps
  set shop_hidden = coalesce(p_hidden, false)
  where id = p_stamp;

  return jsonb_build_object('stamp_id', p_stamp, 'shop_hidden', coalesce(p_hidden, false));
end;
$function$;

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------

create or replace function public.purge_expired_checkin_selfies()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  r record;
  n integer := 0;
begin
  for r in
    select s.id, s.selfie_path, s.public_display_path
    from public.stamps s
    join public.crawls c on c.id = s.crawl_id
    where s.selfie_path is not null
      and c.ends_at is not null
      and c.ends_at < now() - interval '90 days'
      and not (
        s.moderation_status = 'approved'
        and private.visit_photo_eligible(s.crawl_id, s.public_opt_in, s.age_confirmed, s.min_age)
        and s.public_display_path is not null
      )
  loop
    begin
      delete from storage.objects
      where bucket_id = 'checkin-selfies'
        and name = r.selfie_path;
      if r.public_display_path is not null then
        delete from storage.objects
        where bucket_id = 'checkin-display'
          and name = r.public_display_path;
      end if;
    exception
      when others then
        raise warning 'Could not delete selfie %: %', r.selfie_path, sqlerrm;
    end;

    update public.stamps
    set selfie_path = null,
        public_display_path = null
    where id = r.id;
    n := n + 1;
  end loop;

  begin
    delete from storage.objects o
    using public.checkin_sessions s
    where o.bucket_id = 'checkin-selfies'
      and s.completed_at is null
      and s.expires_at < now() - interval '2 days'
      and o.name = (s.user_id::text || '/' || s.id::text || '.jpg');
  exception
    when others then
      raise warning 'Could not delete abandoned selfies: %', sqlerrm;
  end;

  delete from public.checkin_sessions
  where completed_at is null
    and expires_at < now() - interval '2 days';

  return n;
end;
$function$;

comment on function public.purge_expired_checkin_selfies() is
  'Deletes selfie storage rows and paths 90 days after crawls.ends_at unless the photo is still approved, opted in, and meets the crawl age bar (18+ coffee, 21+ pub). Queued and unlisted photos are deleted with everything else that is not still public. Also drops abandoned check-in uploads after 2 days.';

-- Staff controls for the publish cap and the public listing flag.
-- A null cap means no throttle (coffee). Zero holds every new approval in queue.

create or replace function public.staff_set_photo_publish_cap(
  p_crawl text,
  p_cap integer
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not private.is_hc_staff() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if p_cap is not null and p_cap < 0 then
    raise exception 'Cap must be zero or more';
  end if;

  update public.crawls
  set photo_publish_per_hour = p_cap
  where id = p_crawl;

  if not found then
    raise exception 'Unknown crawl';
  end if;

  return jsonb_build_object(
    'crawl_id', p_crawl,
    'photo_publish_per_hour', p_cap,
    'published_last_hour', private.photos_published_last_hour(p_crawl)
  );
end;
$function$;

create or replace function public.staff_set_visit_photos_listed(
  p_crawl text,
  p_listed boolean
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_listed boolean := coalesce(p_listed, false);
begin
  if not private.is_hc_staff() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  update public.crawls
  set list_visit_photos = v_listed
  where id = p_crawl;

  if not found then
    raise exception 'Unknown crawl';
  end if;

  if v_listed then
    perform private.release_queued_visit_photos(p_crawl);
  end if;

  return jsonb_build_object(
    'crawl_id', p_crawl,
    'list_visit_photos', v_listed,
    'published_last_hour', private.photos_published_last_hour(p_crawl)
  );
end;
$function$;

-- Cron entry point. Promotes queued photos on every crawl that has some,
-- still subject to each crawl's cap and listing flag.
create or replace function public.release_all_queued_visit_photos()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  r record;
  n integer := 0;
begin
  for r in
    select distinct s.crawl_id
    from public.stamps s
    where s.moderation_status = 'queued'
  loop
    n := n + private.release_queued_visit_photos(r.crawl_id);
  end loop;
  return n;
end;
$function$;

revoke all on function private.photos_published_last_hour(text) from public;
revoke all on function private.release_queued_visit_photos(text) from public;
revoke all on function private.place_approved_visit_photo(uuid, text) from public;

revoke all on function public.start_checkin(text, text, text, double precision, double precision) from public;
revoke all on function public.complete_checkin(uuid, text, boolean, boolean, boolean) from public;
revoke all on function public.my_visit_photos(text) from public;
revoke all on function public.set_my_photo_choices(uuid, boolean, boolean, boolean) from public;
revoke all on function public.public_visit_photos(text, text) from public;
revoke all on function public.report_visit_photo(uuid, text) from public;
revoke all on function public.visit_photo_access(text) from public;
revoke all on function public.am_hc_staff() from public;
revoke all on function public.staff_photo_crawls() from public;
revoke all on function public.staff_list_organizers(text) from public;
revoke all on function public.staff_set_organizer_kind(text, uuid, text) from public;
revoke all on function public.visit_photo_queue(text, text) from public;
revoke all on function public.moderate_visit_photo(uuid, text, text) from public;
revoke all on function public.shop_visit_photos(text) from public;
revoke all on function public.shop_set_photo_hidden(uuid, boolean) from public;
revoke all on function public.purge_expired_checkin_selfies() from public;
revoke all on function public.staff_set_photo_publish_cap(text, integer) from public;
revoke all on function public.staff_set_visit_photos_listed(text, boolean) from public;
revoke all on function public.release_all_queued_visit_photos() from public;

grant execute on function public.start_checkin(text, text, text, double precision, double precision) to authenticated, service_role;
grant execute on function public.complete_checkin(uuid, text, boolean, boolean, boolean) to authenticated, service_role;
grant execute on function public.my_visit_photos(text) to authenticated, service_role;
grant execute on function public.set_my_photo_choices(uuid, boolean, boolean, boolean) to authenticated, service_role;
grant execute on function public.public_visit_photos(text, text) to anon, authenticated, service_role;
grant execute on function public.report_visit_photo(uuid, text) to authenticated, service_role;
grant execute on function public.visit_photo_access(text) to authenticated, service_role;
grant execute on function public.am_hc_staff() to authenticated, service_role;
grant execute on function public.staff_photo_crawls() to authenticated, service_role;
grant execute on function public.staff_list_organizers(text) to authenticated, service_role;
grant execute on function public.staff_set_organizer_kind(text, uuid, text) to authenticated, service_role;
grant execute on function public.visit_photo_queue(text, text) to authenticated, service_role;
grant execute on function public.moderate_visit_photo(uuid, text, text) to authenticated, service_role;
grant execute on function public.shop_visit_photos(text) to authenticated, service_role;
grant execute on function public.shop_set_photo_hidden(uuid, boolean) to authenticated, service_role;
grant execute on function public.purge_expired_checkin_selfies() to service_role;
grant execute on function public.staff_set_photo_publish_cap(text, integer) to authenticated, service_role;
grant execute on function public.staff_set_visit_photos_listed(text, boolean) to authenticated, service_role;
grant execute on function public.release_all_queued_visit_photos() to service_role;

-- Schedule the daily purge when pg_cron is available. A failure here must
-- not roll back the rest of this migration.
do $cron$
declare
  v_schema text;
begin
  begin
    create extension if not exists pg_cron;
  exception
    when others then
      raise notice 'pg_cron is not available (%). After enabling it, schedule both jobs: select cron.schedule(''purge-checkin-selfies'', ''15 8 * * *'', ''select public.purge_expired_checkin_selfies()''); select cron.schedule(''release-queued-visit-photos'', ''*/10 * * * *'', ''select public.release_all_queued_visit_photos()'');', sqlerrm;
      return;
  end;

  select n.nspname into v_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_cron';

  if v_schema is null then
    raise notice 'pg_cron extension was not created. Schedule both jobs once it is available: select cron.schedule(''purge-checkin-selfies'', ''15 8 * * *'', ''select public.purge_expired_checkin_selfies()''); select cron.schedule(''release-queued-visit-photos'', ''*/10 * * * *'', ''select public.release_all_queued_visit_photos()'');';
    return;
  end if;

  begin
    execute format('select %I.unschedule($1)', v_schema) using 'purge-checkin-selfies';
  exception
    when others then
      null;
  end;

  begin
    execute format('select %I.unschedule($1)', v_schema) using 'release-queued-visit-photos';
  exception
    when others then
      null;
  end;

  execute format('select %I.schedule($1, $2, $3)', v_schema)
    using 'purge-checkin-selfies', '15 8 * * *', 'select public.purge_expired_checkin_selfies()';

  execute format('select %I.schedule($1, $2, $3)', v_schema)
    using 'release-queued-visit-photos', '*/10 * * * *', 'select public.release_all_queued_visit_photos()';
exception
  when others then
    raise notice 'Could not schedule selfie jobs (%). Run: select cron.schedule(''purge-checkin-selfies'', ''15 8 * * *'', ''select public.purge_expired_checkin_selfies()''); select cron.schedule(''release-queued-visit-photos'', ''*/10 * * * *'', ''select public.release_all_queued_visit_photos()'');', sqlerrm;
end
$cron$;
