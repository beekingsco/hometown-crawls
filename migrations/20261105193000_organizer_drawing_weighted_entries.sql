-- Weighted weekly drawing. Apply manually after 20261105180000_organizer_weekly_drawing.sql.
-- This file is not run against production by the app. A static-site deploy does not run it.
--
-- It does not drop public.crawl_drawing_winners. It adds entry_count and replaces
-- organizer_drawing_status and organizer_draw_winners.
--
-- Weight for a person on one crawl:
--   1 for the crawl_joins row
--   + 1 for each distinct stamps.business_id on that same crawl_id
-- Stamps of every source count, including manual and paper. A second stamp at the
-- same shop does not add another entry. Stamps on a different crawl do not count.
--
-- The pick is Efraimidis-Spirakis sampling without replacement:
--   order by -ln(random()) / weight
-- Smaller keys are drawn first. Each person is one row, so nobody can be picked
-- twice in the same draw. Prior winners of this crawl stay out.
-- greatest(random(), 1e-12) is only there so ln() cannot see zero.
--
-- entry_count is the weight used for that draw. Older winner rows stay null.
-- Do not backfill them: those draws were uniform, and a later stamp would
-- change a recomputed weight.
--
-- Rollback (run only after review; not automatic):
--   Restore organizer_drawing_status, organizer_draw_winners, and
--   private.drawing_winners_json from 20261105180000_organizer_weekly_drawing.sql.
--   alter table public.crawl_drawing_winners drop constraint if exists crawl_drawing_winners_entry_count_check;
--   alter table public.crawl_drawing_winners drop column if exists entry_count;
--   drop function if exists private.drawing_entry_count(text, uuid);
--   Do not drop public.crawl_drawing_winners.

set local lock_timeout = '5s';

alter table public.crawl_drawing_winners
  add column if not exists entry_count integer;

alter table public.crawl_drawing_winners
  drop constraint if exists crawl_drawing_winners_entry_count_check;

alter table public.crawl_drawing_winners
  add constraint crawl_drawing_winners_entry_count_check
  check (entry_count is null or entry_count >= 1);

comment on column public.crawl_drawing_winners.entry_count is
  'Entries used when this person was drawn: 1 for joining this crawl, plus 1 per distinct shop stamped on this crawl. Null on draws from before weighted entries.';

create or replace function private.drawing_entry_count(p_crawl text, p_user uuid)
returns integer
language sql
stable
security definer
set search_path to ''
as $function$
  select (
    1 + coalesce((
      select count(distinct s.business_id)::integer
      from public.stamps s
      where s.crawl_id = p_crawl
        and s.user_id = p_user
        and nullif(btrim(s.business_id), '') is not null
    ), 0)
  )::integer;
$function$;

comment on function private.drawing_entry_count(text, uuid) is
  '1 base entry plus 1 per distinct business_id stamped on this crawl. Every stamp source counts. Other crawls are ignored.';

revoke all on function private.drawing_entry_count(text, uuid) from public;
revoke all on function private.drawing_entry_count(text, uuid) from anon;
revoke all on function private.drawing_entry_count(text, uuid) from authenticated;

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
        'entry_count', dw.entry_count,
        'drawn_at', dw.drawn_at
      )
      order by dw.drawn_at desc, dw.display_name
    ),
    '[]'::jsonb
  )
  from public.crawl_drawing_winners dw
  where dw.crawl_id = p_crawl;
$function$;

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
  v_entries bigint := 0;
begin
  perform private.assert_crawl_drawer(v_crawl);

  select count(*)
    into v_participants
  from public.crawl_joins j
  where j.crawl_id = v_crawl;

  select count(*), coalesce(sum(private.drawing_entry_count(v_crawl, j.user_id)), 0)
    into v_eligible, v_entries
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
    'entry_count', v_entries,
    'winners', private.drawing_winners_json(v_crawl)
  );
end;
$function$;

comment on function public.organizer_drawing_status(text) is
  'Pool size, entries still in the drawing, and past winners for one crawl. Entries are 1 per joined person plus 1 per distinct shop stamped on that crawl. Prior winners of this crawl are not eligible.';

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
  v_entries bigint := 0;
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

  select count(*), coalesce(sum(private.drawing_entry_count(v_crawl, j.user_id)), 0)
    into v_eligible, v_entries
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

  with base as (
    select
      j.user_id,
      left(coalesce(nullif(btrim(u.email::text), ''), ''), 320) as email,
      left(
        coalesce(nullif(btrim(p.name), ''), nullif(btrim(u.email::text), ''), 'Guest'),
        200
      ) as display_name,
      private.drawing_entry_count(v_crawl, j.user_id) as entry_count
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
  ),
  weighted as (
    select
      base.user_id,
      base.email,
      base.display_name,
      base.entry_count,
      (-ln(greatest(random(), 1e-12::double precision))) / base.entry_count::double precision as draw_key
    from base
  ),
  picked as (
    select weighted.user_id, weighted.email, weighted.display_name, weighted.entry_count
    from weighted
    order by weighted.draw_key, weighted.user_id
    limit v_count
  ),
  inserted as (
    insert into public.crawl_drawing_winners (
      crawl_id, user_id, email, display_name, label, drawn_by, entry_count
    )
    select v_crawl, picked.user_id, picked.email, picked.display_name, v_label, v_uid, picked.entry_count
    from picked
    returning user_id, display_name, email, label, entry_count, drawn_at
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', inserted.user_id,
        'display_name', inserted.display_name,
        'email', inserted.email,
        'label', inserted.label,
        'entry_count', inserted.entry_count,
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

  select count(*), coalesce(sum(private.drawing_entry_count(v_crawl, j.user_id)), 0)
    into v_eligible, v_entries
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
    'entry_count', v_entries,
    'drawn', v_drawn,
    'winners', private.drawing_winners_json(v_crawl)
  );
end;
$function$;

comment on function public.organizer_draw_winners(text, integer, text) is
  'Weighted pick without replacement from crawl_joins for this crawl only. Weight is 1 plus distinct shops stamped on this crawl. Prior winners of this crawl are skipped.';

revoke all on function public.organizer_draw_winners(text, integer, text) from public;
revoke all on function public.organizer_draw_winners(text, integer, text) from anon;
revoke all on function public.organizer_draw_winners(text, integer, text) from authenticated;
grant execute on function public.organizer_draw_winners(text, integer, text) to authenticated;
