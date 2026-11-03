-- Post-stamp reward for one shop listing.
-- Review and apply manually on tatwbjuwufeqynpufodq as one transaction.
-- This file is not run against production by the app.
-- A static-site deploy does not run it.
--
-- Each listing stores its own reward. Shops do not share a row.
-- reward_enabled stays false until that listing's owner turns it on.
-- shop_save_reward updates only a listing owned by auth.uid().
-- shop_my_listings appends the three reward columns at the end.
-- Issued and redeemed counts are not stored here.
--
-- Rollback (run only after review; not automatic):
--   drop function if exists public.shop_save_reward(uuid, boolean, text, integer);
--   drop function if exists public.shop_my_listings();
--   alter table public.shop_listings drop constraint if exists shop_listings_reward_text_check;
--   alter table public.shop_listings drop constraint if exists shop_listings_reward_expiry_days_check;
--   alter table public.shop_listings drop column if exists reward_enabled;
--   alter table public.shop_listings drop column if exists reward_text;
--   alter table public.shop_listings drop column if exists reward_expiry_days;
--   Then restore shop_my_listings from migrations/20261027150000_shop_crawl_video_url.sql.

set local lock_timeout = '5s';

alter table public.shop_listings
  add column if not exists reward_enabled boolean not null default false;

alter table public.shop_listings
  add column if not exists reward_text text;

alter table public.shop_listings
  add column if not exists reward_expiry_days integer not null default 30;

alter table public.shop_listings
  drop constraint if exists shop_listings_reward_text_check;

alter table public.shop_listings
  add constraint shop_listings_reward_text_check
  check (reward_text is null or char_length(reward_text) between 1 and 140);

alter table public.shop_listings
  drop constraint if exists shop_listings_reward_expiry_days_check;

alter table public.shop_listings
  add constraint shop_listings_reward_expiry_days_check
  check (reward_expiry_days between 1 and 365);

comment on column public.shop_listings.reward_enabled is
  'When true, this listing offers a post-stamp reward. Off until the owner turns it on.';

comment on column public.shop_listings.reward_text is
  'Guest-facing reward for this listing only, up to 140 characters.';

comment on column public.shop_listings.reward_expiry_days is
  'Days after a stamp that this listing reward can be shown. Between 1 and 365.';

create or replace function public.shop_save_reward(
  p_listing uuid,
  p_enabled boolean,
  p_reward text,
  p_expiry_days integer
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_reward text := nullif(btrim(coalesce(p_reward, '')), '');
  v_days integer := coalesce(p_expiry_days, 30);
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (
    select 1
    from public.shop_listings l
    where l.id = p_listing
      and l.owner_user_id = (select auth.uid())
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if v_reward is not null and char_length(v_reward) > 140 then
    raise exception 'Enter a reward, up to 140 characters';
  end if;
  if v_days < 1 or v_days > 365 then
    raise exception 'Expiry needs to be between 1 and 365 days';
  end if;
  update public.shop_listings
    set reward_enabled = coalesce(p_enabled, false),
        reward_text = v_reward,
        reward_expiry_days = v_days,
        updated_at = now()
    where id = p_listing
      and owner_user_id = (select auth.uid());
end;
$function$;

revoke all on function public.shop_save_reward(uuid, boolean, text, integer) from public;
revoke all on function public.shop_save_reward(uuid, boolean, text, integer) from anon;
grant execute on function public.shop_save_reward(uuid, boolean, text, integer) to authenticated;

drop function if exists public.shop_my_listings();

create function public.shop_my_listings()
returns table (
  listing_id uuid,
  crawl_id text,
  crawl_name text,
  crawl_starts_at timestamp with time zone,
  crawl_ends_at timestamp with time zone,
  signup_id uuid,
  display_name text,
  contact_name text,
  owner_email text,
  address text,
  lat double precision,
  lng double precision,
  hours text,
  blurb text,
  website text,
  instagram text,
  phone text,
  photo_paths text[],
  is_paid boolean,
  paid_at timestamp with time zone,
  is_approved boolean,
  price_cents integer,
  payment_link text,
  business_id text,
  store_code text,
  qr_secret text,
  stamp_image_path text,
  logo_path text,
  stamp_label text,
  postal_code text,
  video_url text,
  reward_enabled boolean,
  reward_text text,
  reward_expiry_days integer
)
language sql
stable
security definer
set search_path to ''
as $function$
  select l.id, l.crawl_id, c.name, c.starts_at, c.ends_at, l.signup_id, l.display_name, l.contact_name,
         l.owner_email, l.address, l.lat, l.lng, l.hours, l.blurb, l.website, l.instagram, l.phone,
         l.photo_paths, l.is_paid, l.paid_at, l.is_approved, c.price_cents, c.payment_link, l.business_id,
         coalesce(k.store_code, case when l.is_paid then b.store_code end),
         coalesce(k.qr_secret, case when l.is_paid then b.qr_secret end),
         l.stamp_image_path, l.logo_path, l.stamp_label, l.postal_code, l.video_url,
         l.reward_enabled, l.reward_text, l.reward_expiry_days
  from public.shop_listings l
  join public.crawls c on c.id = l.crawl_id
  left join public.businesses b on b.id = l.business_id
  left join public.crawl_shop_codes k on k.listing_id = l.id and k.crawl_id = l.crawl_id
  where l.owner_user_id = (select auth.uid())
  order by l.created_at desc;
$function$;

revoke all on function public.shop_my_listings() from public;
revoke all on function public.shop_my_listings() from anon;
grant execute on function public.shop_my_listings() to authenticated;
