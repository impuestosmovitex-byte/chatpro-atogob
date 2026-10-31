alter table public.platform_finance_company_monthly
add column if not exists include_in_allocation boolean not null default true;
comment on column public.platform_finance_company_monthly.include_in_allocation
 is 'For illustrative distribution of shared costs only. Does not control billing, subscriptions, permissions or channels.';
