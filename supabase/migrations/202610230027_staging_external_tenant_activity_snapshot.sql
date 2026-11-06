-- STAGING ONLY: operational-company observation snapshot; never modify
-- source tenant permissions, production services, invoices or credentials.
-- All figures come from aggregated, read-only queries on source database.
alter table public.platform_external_tenant_registry
  add column if not exists commercial_plan_suggestion text null
    check (commercial_plan_suggestion is null or commercial_plan_suggestion in ('basico','eco','pro')),
  add column if not exists commercial_mode text not null default 'observe_only'
    check (commercial_mode='observe_only'),
  add column if not exists active_users_count integer null
    check(active_users_count is null or active_users_count >= 0),
  add column if not exists active_integration_records integer null
    check(active_integration_records is null or active_integration_records >= 0),
  add column if not exists messages_30d bigint null
    check(messages_30d is null or messages_30d >= 0),
  add column if not exists ai_response_records_30d bigint null
    check(ai_response_records_30d is null or ai_response_records_30d >= 0),
  add column if not exists last_message_at timestamptz null,
  add column if not exists activity_observed_at timestamptz null,
  add column if not exists ai_cost_status text not null default 'not_measured'
    check(ai_cost_status='not_measured'),
  add column if not exists recommended_plan_reason text not null default ''
    check(length(recommended_plan_reason) <= 500);

-- Read-only source observations. Suggested plans are labels, NEVER plan enforcement.
-- Source snapshot from 2026-10-23, UTC (rolling last 30 days).
update public.platform_external_tenant_registry
set commercial_plan_suggestion='pro',commercial_mode='observe_only',
    active_users_count=3,active_integration_records=4,
    messages_30d=11508,ai_response_records_30d=3102,
    last_message_at='2026-10-23 17:25:42.806495+00',
    activity_observed_at=now(),ai_cost_status='not_measured',
    recommended_plan_reason='4 integraciones registradas como activas (WhatsApp, Instagram, Messenger, Shopify), 3 usuarios y actividad elevada. Pro es recomendación comercial; no aplica límites ni cobros.'
where source_project_id='lttucfblydpaljfboxro' and company_slug='atogob';

update public.platform_external_tenant_registry
set commercial_plan_suggestion='eco',commercial_mode='observe_only',
    active_users_count=2,active_integration_records=1,
    messages_30d=94,ai_response_records_30d=26,
    last_message_at='2026-10-20 17:28:39.104308+00',
    activity_observed_at=now(),ai_cost_status='not_measured',
    recommended_plan_reason='2 usuarios, una integración WhatsApp activa y uso de IA registrado. Eco es recomendación comercial; conservar permisos operativos.'
where source_project_id='lttucfblydpaljfboxro' and company_slug='emprende-con-maogo';

comment on column public.platform_external_tenant_registry.commercial_plan_suggestion is 'Marketing recommendation only; never join as a tenant entitlement or invoice.';
comment on column public.platform_external_tenant_registry.ai_response_records_30d is 'Number of message rows with ai_response populated, NOT OpenAI requests or billed tokens.';
comment on column public.platform_external_tenant_registry.ai_cost_status is 'No verified per-tenant token/cost accounting; do not bill from message counts.';
