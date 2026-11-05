-- Weekly prize drawing for one crawl at a time.
-- Review and apply manually. This file is not run against production by the app.
-- A static-site deploy does not run it.
--
-- Pool: every public.crawl_joins row for that crawl_id. Stamps are not required,
-- and the shop they joined at does not matter.
-- A person is stored once per crawl. Winning puy-coffee does not remove them
-- from any other crawl.
-- The pick is ORDER BY random() inside organizer_draw_winners. The browser
-- only sends the crawl id, how many winners, and an optional label.
--
-- Void and redraw are intentionally omitted. Deleting a winner would put that
-- person back in the pool, so someone could draw again until a chosen name
-- appeared.
--
-- Who can draw: owner, organizer, or co-organizer of THIS crawl, checked with
-- auth.uid() against public.crawl_organizers. Contributors and viewers cannot.
-- The same check gates the winner list, so emails from one crawl are not
-- returned to the team of another crawl.
--
-- Row level security is on and there are no policies. anon and authenticated
-- have no table privileges. Reads and writes go through the security definer
-- functions below, which are granted to authenticated only.
--
-- Rollback (run only after review; not automatic):
--   drop function if exists public.organizer_draw_winners(text, integer, text);
--   drop function if exists public.organizer_drawing_status(text);
--   drop function if exists private.drawing_winners_json(text);
--   drop function if exists private.assert_crawl_drawer(text);
--   drop table if exists public.crawl_drawing_winners;

set local lock_timeout = '5s';

create schema if not exists private;

create table if not exists public.crawl_drawing_winners (
  crawl_id text not null references public.crawls (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  display_name text not null,
  label text,
  drawn_at timestamptz not null default now(),
  drawn_by uuid not null,
  primary key (crawl_id, user_id),
  constraint crawl_drawing_winners_email_len check (char_length(email) <= 320),
  constraint crawl_drawing_winners_name_len check (char_length(display_name) between 1 and 200),
  constraint crawl_drawing_winners_label_len check (label is null or (char_length(label) between 1 and 80))
);

comment on table public.crawl_drawing_winners is
  'One row per person per crawl. email and display_name are copied at draw time so organizers can contact the winner. drawn_by is auth.uid() of the owner, organizer, or co-organizer who ran the draw.';

alter table public.crawl_drawing_winners enable row level security;

revoke all on table public.crawl_drawing_winners from public;
revoke all on table public.crawl_drawing_winners from anon;
revoke all on table public.crawl_drawing_winners from authenticated;

create or replace function private.assert_crawl_drawer(p_crawl text)
returns void
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
  if v_crawl = '' or not exists (
    select 1 from public.crawls c where c.id = v_crawl
  ) then
    raise exception 'Unknown crawl';
  end if;
  if not exists (
    select 1
    from public.crawl_organizers co
    join public.organizers o on o.id = co.organizer_id
    where co.crawl_id = v_crawl
      and o.user_id = (select auth.uid())
      and co.role in ('owner', 'organizer', 'co-organizer')
  ) then
    raise exception 'Only the owner, an organizer, or a co-organizer of this crawl can run the drawing'
      using errcode = '42501';
  end if;
end;
$function$;

revoke all on function private.assert_crawl_drawer(text) from public;
revoke all on function private.assert_crawl_drawer(text) from anon;
revoke all on function private.assert_crawl_drawer(text) from authenticated;

create or replace function private.drawing_winners_json(p_crawl text)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', dw.user_id,
        'display_name', dw.display_name,
        'email', dw.email,
        'label', dw.label,
        'drawn_at', dw.drawn_at
      )
      order by dw.drawn_at desc, dw.display_name
    ),
    '[]'::jsonb
  )
  from public.crawl_drawing_winners dw
  where dw.crawl_id = p_crawl;
$function$;

comment on function private.drawing_winners_json(text) is
  'Winner rows for one crawl_id. Callers must already have passed private.assert_crawl_drawer for that same id.';

revoke all on function private.drawing_winners_json(text) from public;
revoke all on function private.drawing_winners_json(text) from anon;
revoke all on function private.drawing_winners_json(text) from authenticated;

create or replace function public.organizer_drawing_status(p_crawl text)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_crawl text := btrim(coalesce(p_crawl, ''));
  v_participants bigint := 0;
  v_eligible bigint := 0;
begin
  perform private.assert_crawl_drawer(v_crawl);

  select count(*)
    into v_participants
  from public.crawl_joins j
  where j.crawl_id = v_crawl;

  select count(*)
    into v_eligible
  from public.crawl_joins j
  where j.crawl_id = v_crawl
    and not exists (
      select 1
      from public.crawl_drawing_winners w
      where w.crawl_id = v_crawl
        and w.user_id = j.user_id
    );

  return jsonb_build_object(
    'crawl_id', v_crawl,
    'participant_count', v_participants,
    'eligible_count', v_eligible,
    'winners', private.drawing_winners_json(v_crawl)
  );
end;
$function$;

comment on function public.organizer_drawing_status(text) is
  'Pool size and past winners for one crawl. Stamps are not required. Prior winners of this crawl are not eligible.';

revoke all on function public.organizer_drawing_status(text) from public;
revoke all on function public.organizer_drawing_status(text) from anon;
revoke all on function public.organizer_drawing_status(text) from authenticated;
grant execute on function public.organizer_drawing_status(text) to authenticated;

create or replace function public.organizer_draw_winners(
  p_crawl text,
  p_count integer default 1,
  p_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_crawl text := btrim(coalesce(p_crawl, ''));
  v_count integer := coalesce(p_count, 1);
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_participants bigint := 0;
  v_eligible bigint := 0;
  v_drawn jsonb := '[]'::jsonb;
begin
  perform private.assert_crawl_drawer(v_crawl);

  if v_count < 1 or v_count > 25 then
    raise exception 'Pick between 1 and 25 winners';
  end if;
  if v_label is not null and char_length(v_label) > 80 then
    raise exception 'Label needs to be 80 characters or fewer';
  end if;

  -- One drawing at a time for this crawl. A different crawl uses a different lock.
  perform pg_catalog.pg_advisory_xact_lock(hashtext('hc-drawing'), hashtext(v_crawl));

  select count(*)
    into v_participants
  from public.crawl_joins j
  where j.crawl_id = v_crawl;

  select count(*)
    into v_eligible
  from public.crawl_joins j
  where j.crawl_id = v_crawl
    and not exists (
      select 1
      from public.crawl_drawing_winners w
      where w.crawl_id = v_crawl
        and w.user_id = j.user_id
    );

  if v_eligible = 0 then
    raise exception 'No one is left in this drawing';
  end if;
  if v_count > v_eligible then
    raise exception 'Only % people are still in this drawing', v_eligible;
  end if;

  with picked as (
    select
      j.user_id,
      left(coalesce(nullif(btrim(u.email::text), ''), ''), 320) as email,
      left(
        coalesce(nullif(btrim(p.name), ''), nullif(btrim(u.email::text), ''), 'Guest'),
        200
      ) as display_name
    from public.crawl_joins j
    join auth.users u on u.id = j.user_id
    left join public.profiles p on p.id = j.user_id
    where j.crawl_id = v_crawl
      and not exists (
        select 1
        from public.crawl_drawing_winners w
        where w.crawl_id = v_crawl
          and w.user_id = j.user_id
      )
    order by random()
    limit v_count
  ),
  inserted as (
    insert into public.crawl_drawing_winners (
      crawl_id, user_id, email, display_name, label, drawn_by
    )
    select v_crawl, picked.user_id, picked.email, picked.display_name, v_label, v_uid
    from picked
    returning user_id, display_name, email, label, drawn_at
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', inserted.user_id,
        'display_name', inserted.display_name,
        'email', inserted.email,
        'label', inserted.label,
        'drawn_at', inserted.drawn_at
      )
    ),
    '[]'::jsonb
  )
    into v_drawn
  from inserted;

  if jsonb_array_length(v_drawn) <> v_count then
    raise exception 'The drawing could not pick that many people';
  end if;

  select count(*)
    into v_eligible
  from public.crawl_joins j
  where j.crawl_id = v_crawl
    and not exists (
      select 1
      from public.crawl_drawing_winners w
      where w.crawl_id = v_crawl
        and w.user_id = j.user_id
    );

  return jsonb_build_object(
    'crawl_id', v_crawl,
    'participant_count', v_participants,
    'eligible_count', v_eligible,
    'drawn', v_drawn,
    'winners', private.drawing_winners_json(v_crawl)
  );
end;
$function$;

comment on function public.organizer_draw_winners(text, integer, text) is
  'Picks winners at random from crawl_joins for this crawl only, skipping anyone already in crawl_drawing_winners for the same crawl_id.';

revoke all on function public.organizer_draw_winners(text, integer, text) from public;
revoke all on function public.organizer_draw_winners(text, integer, text) from anon;
revoke all on function public.organizer_draw_winners(text, integer, text) from authenticated;
grant execute on function public.organizer_draw_winners(text, integer, text) to authenticated;
