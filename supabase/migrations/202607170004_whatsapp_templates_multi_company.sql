begin;

create extension if not exists pgcrypto;

create table if not exists public.company_whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  integration_id uuid references public.company_integrations(id) on delete set null,
  meta_template_id text,
  name text not null,
  language text not null,
  category text not null default '',
  status text not null default '',
  components jsonb not null default '[]'::jsonb,
  quality_score jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_whatsapp_templates_company_name_language_unique
    unique (company_id, name, language)
);

create table if not exists public.company_template_bindings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  event_key text not null,
  template_id uuid references public.company_whatsapp_templates(id) on delete set null,
  enabled boolean not null default false,
  variable_mapping jsonb not null default '{}'::jsonb,
  button_actions jsonb not null default '{}'::jsonb,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_template_bindings_company_event_unique
    unique (company_id, event_key)
);

create index if not exists company_whatsapp_templates_company_status_idx
  on public.company_whatsapp_templates (company_id, status, name);

create index if not exists company_template_bindings_company_idx
  on public.company_template_bindings (company_id, event_key);

alter table public.company_whatsapp_templates enable row level security;
alter table public.company_template_bindings enable row level security;

commit;
