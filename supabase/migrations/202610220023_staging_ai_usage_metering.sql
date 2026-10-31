-- MW1 staging: tenant-scoped AI metering foundation, not a billing ledger.
-- Do not backfill estimated usage or block any existing production AI requests.
create table if not exists public.platform_ai_usage_events (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 source_event_id text not null check(char_length(source_event_id) between 1 and 180),
 provider text not null default 'openai' check(provider='openai'),
 model text not null check(char_length(model) between 1 and 120),
 operation text not null check(char_length(operation) between 1 and 120),
 input_tokens bigint not null default 0 check(input_tokens >= 0),
 output_tokens bigint not null default 0 check(output_tokens >= 0),
 cached_input_tokens bigint not null default 0 check(cached_input_tokens >= 0),
 estimated_cost_usd numeric(16,8) null check(estimated_cost_usd >= 0),
 recorded_at timestamptz not null default now(),
 unique(company_id,source_event_id)
);
create index if not exists platform_ai_usage_events_company_date_idx
 on public.platform_ai_usage_events(company_id,recorded_at desc);
alter table public.platform_ai_usage_events enable row level security;
revoke all on public.platform_ai_usage_events from public,anon,authenticated;
grant select,insert on public.platform_ai_usage_events to service_role;
comment on table public.platform_ai_usage_events is 'Staging-only, verified per-call AI token metrics; estimated costs optional. Not invoicing or automatic quota enforcement.';
