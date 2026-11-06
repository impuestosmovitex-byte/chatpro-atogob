-- MW1 staging only: audited administrative recovery actions.
-- No passwords, hashes or provider tokens are persisted in audit.
create table if not exists public.platform_access_audit (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete cascade,
 target_user_id uuid not null,
 actor_user_id uuid not null,
 changed_identifier boolean not null default false,
 changed_password boolean not null default false,
 changed_contact_email boolean not null default false,
 changed_contact_phone boolean not null default false,
 created_at timestamptz not null default now(),
 constraint platform_access_audit_changed check(
  changed_identifier or changed_password or changed_contact_email or changed_contact_phone)
);
alter table public.platform_access_audit enable row level security;
revoke all on public.platform_access_audit from public, anon, authenticated;
grant all on public.platform_access_audit to service_role;
create index if not exists platform_access_audit_company_time_idx
 on public.platform_access_audit(company_id, created_at desc);
alter table public.app_profiles add column if not exists recovery_phone text;
alter table public.app_profiles add column if not exists recovery_email_verified_at timestamptz;
comment on column public.app_profiles.recovery_phone is
 'Recovery contact entered by an operator; not validated for SMS authentication.';
comment on column public.app_profiles.recovery_email_verified_at is
 'Must only be set after possession of recovery contact mailbox is verified. NULL means cannot send autonomous recovery.';
