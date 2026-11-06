-- Staging only: editable add-on prices for commercial plan proposals.
-- Never changes company entitlements, payments or production tenants.
alter table public.platform_commercial_plan_drafts
  add column if not exists extra_user_cop integer null check(extra_user_cop between 0 and 999999999),
  add column if not exists extra_connection_cop integer null check(extra_connection_cop between 0 and 999999999);
alter table public.platform_published_plan_prices
  add column if not exists extra_user_cop integer null check(extra_user_cop between 0 and 999999999),
  add column if not exists extra_connection_cop integer null check(extra_connection_cop between 0 and 999999999);
