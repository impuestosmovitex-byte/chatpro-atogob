-- Staging only, private draft and published public descriptions.
alter table public.platform_commercial_plan_drafts
 add column if not exists ai_monthly_budget_cop integer null check(ai_monthly_budget_cop between 0 and 999999999),
 add column if not exists public_summary text null check(char_length(public_summary)<=300),
 add column if not exists public_features jsonb null check(public_features is null or jsonb_typeof(public_features)='array');
alter table public.platform_published_plan_prices
 add column if not exists ai_monthly_budget_cop integer null check(ai_monthly_budget_cop between 0 and 999999999),
 add column if not exists public_summary text null check(char_length(public_summary)<=300),
 add column if not exists public_features jsonb null check(public_features is null or jsonb_typeof(public_features)='array');
