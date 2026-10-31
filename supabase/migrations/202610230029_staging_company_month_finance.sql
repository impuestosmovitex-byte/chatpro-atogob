-- Staging private ledger for monthly tenant profitability observations.
-- An operational tenant is only referenced by slug/source. Do not replicate
-- production conversations, tokens, keys, entitlements, or payments here.
create table if not exists public.platform_finance_company_monthly (
  period_month date not null check(extract(day from period_month)=1),
  company_source text not null check(company_source in ('operational','staging')),
  company_slug text not null check(company_slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  billed_cop numeric(16,2) null check(billed_cop>=0),
  received_cop numeric(16,2) null check(received_cop>=0),
  openai_cop numeric(16,2) null check(openai_cop>=0),
  support_cop numeric(16,2) null check(support_cop>=0),
  onboarding_cop numeric(16,2) null check(onboarding_cop>=0),
  other_direct_cop numeric(16,2) null check(other_direct_cop>=0),
  allocation_weight numeric(10,3) not null default 1 check(allocation_weight>0 and allocation_weight<=1000),
  evidence_note text not null default '' check(length(evidence_note)<=1000),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id),
  primary key(period_month,company_source,company_slug)
);
create index if not exists platform_finance_company_monthly_slug_idx
 on public.platform_finance_company_monthly(company_source,company_slug,period_month desc);
alter table public.platform_finance_company_monthly enable row level security;
revoke all on public.platform_finance_company_monthly from public,anon,authenticated;
grant select,insert,update on public.platform_finance_company_monthly to service_role;
comment on table public.platform_finance_company_monthly is
'Superadmin staging manual company-month records. Null is unknown. Do not treat billed as received, or this table as a paid invoice/tenant plan.';
