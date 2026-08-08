create table if not exists public.contact_tag_definitions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  name text not null,
  color text not null default 'green',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists contact_tag_definitions_company_name_unique
  on public.contact_tag_definitions (
    company_id,
    lower(name)
  );

create index if not exists contact_tag_definitions_company_active_idx
  on public.contact_tag_definitions (
    company_id,
    is_active,
    name
  );

insert into public.contact_tag_definitions (
  company_id,
  name,
  color
)
select distinct
  c.company_id,
  trim(tag_name),
  'green'
from public.contacts c
cross join lateral unnest(c.tags) as tag_name
where trim(tag_name) <> ''
on conflict do nothing;
