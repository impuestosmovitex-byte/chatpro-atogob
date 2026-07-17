begin;

create extension if not exists pgcrypto;

create table if not exists public.platform_health_states (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  component text not null,
  label text not null,
  status text not null default 'warning',
  summary text not null default '',
  detail text not null default '',
  latency_ms integer,
  metadata jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now(),
  changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_health_states_company_component_unique
    unique (company_id, component),
  constraint platform_health_states_status_check
    check (status in ('healthy', 'warning', 'critical'))
);

create table if not exists public.platform_health_incidents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  component text not null,
  label text not null,
  status text not null,
  title text not null,
  detail text not null default '',
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_detail text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_health_incidents_status_check
    check (status in ('warning', 'critical'))
);

create index if not exists platform_health_states_company_idx
  on public.platform_health_states (company_id, status, checked_at desc);

create index if not exists platform_health_incidents_company_idx
  on public.platform_health_incidents (
    company_id,
    started_at desc
  );

create index if not exists platform_health_incidents_open_idx
  on public.platform_health_incidents (
    company_id,
    component,
    started_at desc
  )
  where resolved_at is null;

alter table public.platform_health_states enable row level security;
alter table public.platform_health_incidents enable row level security;

commit;
