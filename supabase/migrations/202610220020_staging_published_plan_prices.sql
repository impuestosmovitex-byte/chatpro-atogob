-- MW1 staging only. Separate public catalog from private plan drafts and company entitlements.
-- No legacy tenant pricing, payment state or subscription permissions are changed.
create table if not exists public.platform_published_plan_prices (
 plan_key text primary key check (plan_key in ('inicial','pro','empresa')),
 price_cop integer not null check (price_cop between 1 and 999999999),
 max_users integer not null check (max_users between 1 and 1000),
 max_whatsapp_lines integer not null check (max_whatsapp_lines between 1 and 1000),
 published_at timestamptz not null default now(),
 published_by uuid references auth.users(id)
);
alter table public.platform_published_plan_prices enable row level security;
revoke all on public.platform_published_plan_prices from public,anon,authenticated;
grant select,insert,update on public.platform_published_plan_prices to service_role;
comment on table public.platform_published_plan_prices is 'Staging-only public price snapshot. Not subscription billing or tenant entitlements.';
