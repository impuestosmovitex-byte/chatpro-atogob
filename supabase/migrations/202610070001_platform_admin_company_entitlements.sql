create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_entitlements (
  company_id uuid primary key references public.companies(id) on delete cascade,
  plan_key text not null default 'custom',
  ai_enabled boolean not null default false,
  whatsapp_enabled boolean not null default true,
  instagram_enabled boolean not null default false,
  messenger_enabled boolean not null default false,
  automations_enabled boolean not null default true,
  statistics_enabled boolean not null default true,
  max_users integer not null default 3 check (max_users >= 1),
  max_whatsapp_lines integer not null default 1 check (max_whatsapp_lines >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists platform_admins_active_idx
  on public.platform_admins(active);

comment on table public.platform_admins is
  'Usuarios autorizados para administrar todas las empresas de MW1.';

comment on table public.company_entitlements is
  'Plan, modulos habilitados y limites operativos por empresa.';

-- Las empresas existentes siguen funcionando aunque no tengan fila aqui.
-- El backend usa compatibilidad hacia atras (sin fila = funciones existentes habilitadas).
