-- Payment columns for the Stripe webhook.
-- crawl_signups.stripe_session_id already exists (text, nullable). This adds the
-- missing paid timestamp and charged amount, and makes the session id unique so
-- a Checkout Session can be recorded once.
-- shop_listings already has is_paid, paid_at, amount_paid_cents, and
-- payment_source. stripe_session_id was not on that table; add it so the
-- webhook can store the same Checkout Session on the linked listing.

alter table public.crawl_signups
  add column if not exists paid_at timestamptz;

alter table public.crawl_signups
  add column if not exists amount_paid_cents integer;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.crawl_signups'::regclass
      and conname = 'crawl_signups_stripe_session_id_key'
  ) then
    alter table public.crawl_signups
      add constraint crawl_signups_stripe_session_id_key unique (stripe_session_id);
  end if;
end $$;

alter table public.shop_listings
  add column if not exists stripe_session_id text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.shop_listings'::regclass
      and conname = 'shop_listings_stripe_session_id_key'
  ) then
    alter table public.shop_listings
      add constraint shop_listings_stripe_session_id_key unique (stripe_session_id);
  end if;
end $$;
