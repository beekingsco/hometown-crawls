-- NOT APPLIED. Checked 2026-10-06: public.crawl_signups has no address,
-- website, or hours columns. Do not run this against production from the app
-- deploy. The shop signup form sends these fields and, until this migration is
-- applied, retries the insert without any column PostgREST says is missing.

alter table public.crawl_signups
  add column if not exists address text;

alter table public.crawl_signups
  add column if not exists website text;

alter table public.crawl_signups
  add column if not exists hours text;

comment on column public.crawl_signups.address is 'Street address from the shop signup form.';
comment on column public.crawl_signups.website is 'Optional website from the shop signup form.';
comment on column public.crawl_signups.hours is 'Optional hours from the shop signup form.';
