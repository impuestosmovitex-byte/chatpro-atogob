-- Financial forecasting configuration for MW1 superadmin in STAGING only.
-- A scenario is NOT an invoice, paid revenue, verified cloud bill, or entitlement.
create table if not exists public.platform_finance_scenarios (
 scenario_key text primary key check (scenario_key='current'),
 assumptions jsonb not null check (jsonb_typeof(assumptions)='object'),
 updated_by uuid null references auth.users(id),
 updated_at timestamptz not null default now()
);
alter table public.platform_finance_scenarios enable row level security;
revoke all on public.platform_finance_scenarios from public,anon,authenticated;
grant select,insert,update on public.platform_finance_scenarios to service_role;
comment on table public.platform_finance_scenarios is 'Private, staging-only profitability what-if scenario. Never use for invoices, actual payments, AI limits, company entitlements or production.';

create table if not exists public.platform_finance_monthly_actuals (
 period_month date primary key check (extract(day from period_month)=1),
 received_cop numeric(16,2) null check(received_cop>=0),
 railway_cop numeric(16,2) null check(railway_cop>=0),
 supabase_cop numeric(16,2) null check(supabase_cop>=0),
 openai_cop numeric(16,2) null check(openai_cop>=0),
 technical_support_cop numeric(16,2) null check(technical_support_cop>=0),
 personnel_cop numeric(16,2) null check(personnel_cop>=0),
 marketing_cop numeric(16,2) null check(marketing_cop>=0),
 other_cop numeric(16,2) null check(other_cop>=0),
 evidence_note text not null default '' check(length(evidence_note)<=1000),
 updated_by uuid null references auth.users(id),
 updated_at timestamptz not null default now()
);
alter table public.platform_finance_monthly_actuals enable row level security;
revoke all on public.platform_finance_monthly_actuals from public,anon,authenticated;
grant select,insert,update on public.platform_finance_monthly_actuals to service_role;
comment on table public.platform_finance_monthly_actuals is 'Manual actuals, nullable until verified. Unknown is NULL, never zero. No automated billing or tenant changes.';
