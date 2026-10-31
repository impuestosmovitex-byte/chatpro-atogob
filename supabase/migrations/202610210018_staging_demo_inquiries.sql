-- MW1 staging only. Do not apply to ATOGOB / production.
-- Public demo requests are inserted only by the internal API service-role.
-- Never create a company or enable plan based on this unverified form.
create table if not exists public.platform_demo_requests (
  id uuid primary key default gen_random_uuid(),
  company_name text not null check (char_length(company_name) between 2 and 100),
  contact_name text not null check (char_length(contact_name) between 2 and 100),
  contact_email text not null check (char_length(contact_email) between 5 and 180),
  plan_interest text not null default 'sin_definir'
    check (plan_interest in ('inicial','pro','empresa','sin_definir')),
  source text not null default 'web_demo' check (source='web_demo'),
  visitor_digest text not null check (char_length(visitor_digest)=64),
  consent_at timestamptz not null,
  status text not null default 'new'
    check (status in ('new','contacted','qualified','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists platform_demo_requests_recent_idx
  on public.platform_demo_requests(created_at desc);
create index if not exists platform_demo_requests_throttle_idx
  on public.platform_demo_requests(visitor_digest,created_at desc);
alter table public.platform_demo_requests enable row level security;
revoke all on public.platform_demo_requests from public,anon,authenticated;
grant all on public.platform_demo_requests to service_role;
comment on table public.platform_demo_requests is
  'Isolated staging CRM sales enquiries; never grants user access or records a payment. Access restricted to platform admins via server API.';
