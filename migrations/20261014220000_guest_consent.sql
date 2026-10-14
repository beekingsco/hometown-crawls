-- Guest contact consent on the profile. Apply manually. Do not run from the app.
-- Stamps do not check this flag. Guests who already joined can keep stamping.

set local lock_timeout = '5s';

alter table public.profiles
  add column if not exists contact_consent boolean not null default false,
  add column if not exists consented_at timestamptz;

create or replace function public.record_guest_consent()
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  update public.profiles
    set contact_consent = true,
        consented_at = coalesce(consented_at, now())
    where id = (select auth.uid());
  if not found then
    insert into public.profiles (id, name, contact_consent, consented_at)
    values ((select auth.uid()), '', true, now());
  end if;
end;
$function$;

revoke all on function public.record_guest_consent() from public;
revoke all on function public.record_guest_consent() from anon;
grant execute on function public.record_guest_consent() to authenticated;
