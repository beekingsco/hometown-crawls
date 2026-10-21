-- Guest phone and prize/photo consents. Apply manually in the Supabase SQL editor.
-- Guests still claim stamps through claim_stamp, which keeps the 50 m check.
-- No anonymous access. No service role is granted here.

set local lock_timeout = '5s';

alter table public.profiles
  add column if not exists phone text,
  add column if not exists photo_promo_consent boolean not null default false,
  add column if not exists photo_promo_consented_at timestamptz;

create or replace function public.record_guest_signup(
  p_crawl text,
  p_name text,
  p_phone text,
  p_contact boolean,
  p_photo boolean,
  p_shop text,
  p_paper boolean,
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
  v_phone text := left(btrim(coalesce(p_phone, '')), 40);
  v_digits text := regexp_replace(v_phone, '\D', '', 'g');
  v_shop text := btrim(coalesce(p_shop, ''));
  v_listing uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_contact is not true then
    raise exception 'Prize contact approval is required';
  end if;
  if p_photo is not true then
    raise exception 'Photo promotional approval is required';
  end if;
  if v_name = '' then
    raise exception 'Name is required';
  end if;
  if v_digits ~ '^1\d{10}$' then
    v_digits := substring(v_digits from 2);
  end if;
  if char_length(v_digits) < 10 or char_length(v_digits) > 15 then
    raise exception 'Enter a valid phone number';
  end if;
  if coalesce(p_paper, false) and p_terms is not true then
    raise exception 'Terms are required';
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
  values (
    v_uid,
    p_crawl,
    case when coalesce(p_paper, false) then 'paper' else 'digital' end,
    v_listing,
    case when coalesce(p_paper, false) then now() else null end
  )
  on conflict (user_id, crawl_id) do update
    set play_mode = case
          when public.guest_crawls.play_mode = 'paper' or excluded.play_mode = 'paper' then 'paper'
          else 'digital'
        end,
        signup_listing_id = coalesce(excluded.signup_listing_id, public.guest_crawls.signup_listing_id),
        terms_accepted_at = coalesce(public.guest_crawls.terms_accepted_at, excluded.terms_accepted_at);

  update public.profiles
    set name = v_name,
        phone = v_phone,
        contact_consent = true,
        consented_at = now(),
        photo_promo_consent = true,
        photo_promo_consented_at = now()
    where id = v_uid;
  if not found then
    insert into public.profiles (
      id, name, phone, contact_consent, consented_at, photo_promo_consent, photo_promo_consented_at
    )
    values (v_uid, v_name, v_phone, true, now(), true, now());
  end if;
end;
$function$;

revoke all on function public.record_guest_signup(text, text, text, boolean, boolean, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.record_guest_signup(text, text, text, boolean, boolean, text, boolean, boolean) to authenticated;

drop function if exists public.organizer_search_players(text, text);

create function public.organizer_search_players(p_crawl text, p_query text)
returns table (
  user_id uuid,
  player_name text,
  player_email text,
  player_phone text,
  contact_consent boolean,
  photo_promo_consent boolean,
  contact_consented_at timestamptz,
  photo_promo_consented_at timestamptz,
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
  v_digits text := regexp_replace(v_q, '\D', '', 'g');
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
    coalesce(u.email::text, ''),
    coalesce(p.phone, ''),
    coalesce(p.contact_consent, false),
    coalesce(p.photo_promo_consent, false),
    p.consented_at,
    p.photo_promo_consented_at,
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
      or coalesce(u.email::text, '') ilike '%' || v_q || '%'
      or coalesce(p.phone, '') ilike '%' || v_q || '%'
      or (
        char_length(v_digits) >= 2
        and regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') like '%' || v_digits || '%'
      )
    )
  order by coalesce(p.name, u.email::text)
  limit 25;
end;
$function$;

revoke all on function public.organizer_search_players(text, text) from public, anon, authenticated;
grant execute on function public.organizer_search_players(text, text) to authenticated;
