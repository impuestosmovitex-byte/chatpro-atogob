-- MW1 ONLY: draft commercial pricing, staging environment, NEVER production.
-- This table is NOT coupled to company_entitlements or any payment webhook.
-- A plan draft cannot grant users, change quotas or publish a price.
create table if not exists public.platform_commercial_plan_drafts(
  plan_key text primary key check(plan_key in ('inicial','pro','empresa')),
  currency text not null default 'COP' check(currency='COP'),
  price_cop integer null check(price_cop between 1 and 999999999),
  max_users integer null check(max_users between 1 and 1000),
  max_whatsapp_lines integer null check(max_whatsapp_lines between 1 and 1000),
  ai_enabled boolean not null default false,
  whatsapp_enabled boolean not null default false,
  instagram_enabled boolean not null default false,
  messenger_enabled boolean not null default false,
  automations_enabled boolean not null default false,
  statistics_enabled boolean not null default false,
  notes text not null default '' check(char_length(notes)<=1400),
  review_status text not null default 'draft'
    check(review_status in ('draft','ready_for_review')),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id)
);
alter table public.platform_commercial_plan_drafts enable row level security;
revoke all on public.platform_commercial_plan_drafts from public,anon,authenticated;
grant all on public.platform_commercial_plan_drafts to service_role;
comment on table public.platform_commercial_plan_drafts is
  'Staging-only private proposals. Not customer entitlements, invoices, payment state or published pricing.';
