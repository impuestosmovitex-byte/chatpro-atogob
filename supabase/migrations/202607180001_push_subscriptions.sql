begin;

create extension if not exists pgcrypto;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  expiration_time timestamptz,
  user_agent text not null default '',
  platform text not null default '',
  enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_unique unique (endpoint)
);

create index if not exists push_subscriptions_user_enabled_idx
  on public.push_subscriptions (company_id, user_id, enabled);

create index if not exists push_subscriptions_company_enabled_idx
  on public.push_subscriptions (company_id, enabled);

alter table public.push_subscriptions enable row level security;

comment on table public.push_subscriptions is
  'Suscripciones Web Push de los dispositivos instalados por cada usuario de ChatPro.';

commit;
