begin;

create extension if not exists pgcrypto;

create table if not exists public.shopify_webhook_events (
  id uuid primary key default gen_random_uuid(),
  webhook_id text not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  shop_domain text not null,
  topic text not null,
  api_version text,
  status text not null default 'received',
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processing_started_at timestamptz,
  processed_at timestamptz,
  failed_at timestamptz,
  attempt_count integer not null default 0,
  next_retry_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shopify_webhook_events_webhook_unique unique (webhook_id),
  constraint shopify_webhook_events_status_check
    check (status in ('received','processing','processed','failed','ignored')),
  constraint shopify_webhook_events_attempt_check
    check (attempt_count >= 0)
);

create index if not exists shopify_webhook_events_company_received_idx
  on public.shopify_webhook_events (company_id, received_at desc);

create index if not exists shopify_webhook_events_pending_idx
  on public.shopify_webhook_events (status, next_retry_at)
  where status in ('received', 'failed');

alter table public.shopify_webhook_events enable row level security;

commit;
