-- Staging only: support-assisted recovery requests; never change credentials from unverified contact data.
create table if not exists public.platform_access_recovery_requests(
 id uuid primary key default gen_random_uuid(),
 company_slug text not null check(length(company_slug) between 3 and 60),
 login_identifier text not null check(length(login_identifier) between 3 and 60),
 contact_method text not null check(contact_method in ('email','phone')),
 contact_value text not null check(length(contact_value) between 7 and 254),
 visitor_digest text not null check(length(visitor_digest)=64),
 status text not null default 'new' check(status in ('new','contacted','verified','closed')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.platform_access_recovery_requests enable row level security;
revoke all on public.platform_access_recovery_requests from public,anon,authenticated;
grant all on public.platform_access_recovery_requests to service_role;
create index if not exists platform_recovery_requests_digest_time_idx
 on public.platform_access_recovery_requests(visitor_digest,created_at desc);
comment on table public.platform_access_recovery_requests is
 'Unverified contact requests only. Operator must verify owner identity out-of-band before any credential changes; never send secrets here.';
