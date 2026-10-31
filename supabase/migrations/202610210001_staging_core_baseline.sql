-- MW1 SaaS / isolated staging baseline, 2026-10-21
-- This migration is intentionally run ONLY on Supabase project zqfbxqszfnrbwpfukwak.
-- No production data or credentials are used. Existing MW1-specific triggers/RPCs
-- will be audited and migrated separately.
create extension if not exists pgcrypto;

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  name text not null check (length(btrim(name)) >= 2),
  status text not null default 'active' check (status in ('active','trial','suspended','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.company_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  assistant_name text,
  ai_instructions text not null default '',
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.company_entitlements (
  company_id uuid primary key references public.companies(id) on delete cascade,
  plan_key text not null default 'crm',
  ai_enabled boolean not null default false,
  whatsapp_enabled boolean not null default true,
  instagram_enabled boolean not null default false,
  messenger_enabled boolean not null default false,
  automations_enabled boolean not null default false,
  statistics_enabled boolean not null default true,
  max_users integer not null default 2 check (max_users >= 1),
  max_whatsapp_lines integer not null default 1 check (max_whatsapp_lines >= 0),
  commerce_enabled boolean not null default false,
  native_orders_enabled boolean not null default false,
  max_catalog_items integer not null default 100 check (max_catalog_items >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.app_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text,
  avatar_url text,
  active boolean not null default true,
  login_identifier text unique,
  password_hash text,
  contact_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.app_roles (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  name text not null,
  description text,
  is_system boolean not null default false,
  company_id uuid references public.companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index app_roles_tenant_key_unique on public.app_roles(company_id,key) where company_id is not null;
create unique index app_roles_global_key_unique on public.app_roles(key) where company_id is null;

create table public.app_permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);
create table public.app_role_permissions (
  role_id uuid not null references public.app_roles(id) on delete cascade,
  permission_id uuid not null references public.app_permissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(role_id,permission_id)
);

create table public.company_memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.app_profiles(user_id) on delete cascade,
  role_id uuid not null references public.app_roles(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,user_id)
);
create index company_memberships_by_user on public.company_memberships(user_id) where active;

create table public.service_areas (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  description text not null default '',
  area_type text check (area_type in ('sales','service') or area_type is null),
  is_active boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,name)
);
create unique index service_areas_default_per_company on public.service_areas(company_id) where is_default;

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  phone text,
  display_name text,
  primary_channel text not null default 'whatsapp',
  tags text[] not null default '{}',
  notes text not null default '',
  first_seen_at timestamptz,
  last_activity_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  external_customer_id text,
  unique(company_id,id)
);
create index contacts_by_company_phone on public.contacts(company_id,phone);

create table public.conversation_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_phone text,
  stage text not null default 'main',
  context jsonb not null default '{}'::jsonb,
  last_message_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  attention_status text not null default 'ai',
  assigned_to_user_id uuid references public.app_profiles(user_id),
  assigned_to_name text,
  taken_at timestamptz,
  closed_at timestamptz,
  pending_count integer not null default 0 check (pending_count >= 0),
  pending_since timestamptz,
  channel text not null default 'whatsapp',
  external_customer_id text,
  unique(company_id,id)
);
create index conversation_sessions_active_by_company on public.conversation_sessions(company_id,last_message_at desc);

create table public.conversations (
  id bigint generated by default as identity primary key,
  created_at timestamptz not null default now(),
  customer_phone text,
  message text,
  sender text,
  message_type text,
  status text,
  ai_response text,
  company_id uuid not null references public.companies(id) on delete cascade,
  session_id uuid,
  provider_message_id text,
  author_type text default 'customer',
  media_id text,
  media_mime_type text,
  media_filename text,
  media_voice boolean not null default false,
  media_storage_path text,
  reply_to_provider_message_id text,
  reply_to_message text,
  message_source text,
  source_name text,
  provider_error text,
  channel text not null default 'whatsapp',
  external_customer_id text,
  message_metadata jsonb,
  foreign key (company_id,session_id) references public.conversation_sessions(company_id,id) on delete cascade
);
create unique index conversations_provider_id_unique on public.conversations(company_id,provider_message_id) where provider_message_id is not null;
create index conversations_company_session_time on public.conversations(company_id,session_id,created_at desc);

create table public.company_integrations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  provider text not null,
  integration_type text not null,
  external_id text not null,
  status text not null default 'pending' check(status in ('pending','active','disconnected','error')),
  config jsonb not null default '{}'::jsonb,
  credential_mode text not null default 'encrypted' check(credential_mode in ('encrypted','environment')),
  credential_reference jsonb not null default '{}'::jsonb,
  credentials_encrypted text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider,integration_type,external_id)
);
create index company_integrations_active_company on public.company_integrations(company_id,provider,integration_type) where status='active';

-- No public API access to business records. Backend service-role only.
do $mw1$
declare table_name text;
begin
  foreach table_name in array array[
    'companies','company_settings','company_entitlements','app_profiles',
    'app_roles','app_permissions','app_role_permissions','company_memberships',
    'service_areas','contacts','conversation_sessions','conversations','company_integrations'
  ] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('revoke all privileges on table public.%I from public, anon, authenticated',table_name);
    execute format('grant all privileges on table public.%I to service_role',table_name);
  end loop;
end $mw1$;
revoke all on sequence public.conversations_id_seq from public, anon, authenticated;
grant usage, select on sequence public.conversations_id_seq to service_role;

comment on schema public is 'MW1 staging base with closed-by-default access; no production customer data.';
