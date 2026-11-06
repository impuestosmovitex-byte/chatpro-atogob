-- Staging-only configurable cost rates; no guesses about actual OpenAI prices.
create table if not exists public.platform_ai_model_rates (
 model text primary key check(char_length(model) between 1 and 120),
 input_usd_per_million numeric(14,6) not null check(input_usd_per_million>=0),
 cached_input_usd_per_million numeric(14,6) not null check(cached_input_usd_per_million>=0),
 output_usd_per_million numeric(14,6) not null check(output_usd_per_million>=0),
 effective_from timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.platform_ai_model_rates enable row level security;
revoke all on public.platform_ai_model_rates from public,anon,authenticated;
grant select,insert,update on public.platform_ai_model_rates to service_role;
comment on table public.platform_ai_model_rates is 'Staging-only manually verified per-model USD prices. Blank until reviewed; never used for billing.';
