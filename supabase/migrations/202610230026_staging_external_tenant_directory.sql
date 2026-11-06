-- STAGING ONLY. External company directory is a reference to real operational
-- tenants, not a copy of their conversations or an active subscription.
create table if not exists public.platform_external_tenant_registry (
  id uuid primary key default gen_random_uuid(),
  source_project_id text not null check (source_project_id in ('lttucfblydpaljfboxro','ynmwgerlfidwsihmzgkw')),
  source_company_id uuid not null,
  company_name text not null check (length(company_name) between 2 and 160),
  company_slug text not null check (company_slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  environment_label text not null default 'Operación MW1 existente',
  billing_status text not null default 'not_configured' check (billing_status in ('not_configured','pending_validation')),
  verified_at timestamptz not null default now(),
  unique (source_project_id,source_company_id)
);
create index if not exists platform_external_tenant_registry_slug_idx
  on public.platform_external_tenant_registry(company_slug);
alter table public.platform_external_tenant_registry enable row level security;
revoke all on public.platform_external_tenant_registry from public,anon,authenticated;
grant select,insert,update on public.platform_external_tenant_registry to service_role;
comment on table public.platform_external_tenant_registry is
  'Read-only directory for staging superadmin of operational tenants. Not a replica, no company login, billing, payment or entitlements.';

-- Verified by read-only queries against the operational Supabase project.
insert into public.platform_external_tenant_registry
  (source_project_id,source_company_id,company_name,company_slug)
values
  ('lttucfblydpaljfboxro','15614ebe-87b9-40eb-96f7-a5c00c20bf5b','Atogob Group','atogob'),
  ('lttucfblydpaljfboxro','d55817a3-d104-48e7-8efb-c7736e9c8aa4','Emprende con Maogo','emprende-con-maogo')
on conflict (source_project_id,source_company_id) do update
set company_name=excluded.company_name,company_slug=excluded.company_slug,verified_at=now();
