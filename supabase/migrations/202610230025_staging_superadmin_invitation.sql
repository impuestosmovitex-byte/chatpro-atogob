-- One-time superadmin enrollment for the isolated MW1 staging project.
-- Tokens are generated out-of-band; ONLY SHA-256 hashes are stored.
create table if not exists public.platform_staging_admin_invites (
  id uuid primary key default gen_random_uuid(),
  login_identifier text not null check (char_length(login_identifier) between 3 and 60),
  token_sha256 text not null unique check (token_sha256 ~ '^[0-9a-f]{64}$'),
  company_slug text not null default 'mw1-demo-mercado',
  expires_at timestamptz not null,
  used_at timestamptz null,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);
create index if not exists platform_staging_admin_invites_open_idx
 on public.platform_staging_admin_invites(expires_at)
 where used_at is null;
alter table public.platform_staging_admin_invites enable row level security;
revoke all on public.platform_staging_admin_invites from public,anon,authenticated;
grant select,insert,update on public.platform_staging_admin_invites to service_role;
comment on table public.platform_staging_admin_invites is 'Only isolated MW1 staging; short-lived single-use bootstrap hashes; never store plaintext invitations.';
