-- MW1 staging: feature activation is separate from commercial entitlement.
-- The absence of a row means "not configured"; legacy functions remain unchanged.
create table if not exists public.mw1_company_feature_preferences (
  company_id uuid not null references public.companies(id) on delete cascade,
  feature_key text not null check (feature_key in (
    'ai_assistant','whatsapp','instagram','messenger','automations',
    'catalog_pdf','native_orders','merchant_payments','statistics'
  )),
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (company_id,feature_key)
);
alter table public.mw1_company_feature_preferences enable row level security;
revoke all on public.mw1_company_feature_preferences from public,anon,authenticated;
comment on table public.mw1_company_feature_preferences is
'Optional opt-in preferences; never doubles as plan entitlement or billing suspension. Existing integrations remain unchanged.';
