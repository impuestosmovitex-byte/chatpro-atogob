-- MW1 STAGING ONLY. Private catalog imagery; no public policies or client uploads.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('mw1-staging-products','mw1-staging-products',false,524288,
        array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=524288,
  allowed_mime_types=excluded.allowed_mime_types;

create table if not exists public.commerce_product_images (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid not null,
  variant_id uuid not null,
  storage_bucket text not null default 'mw1-staging-products'
    check(storage_bucket='mw1-staging-products'),
  storage_path text not null,
  mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp')),
  bytes integer not null check(bytes between 200 and 524288),
  sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
  label text not null default '' check(length(label)<=180),
  created_at timestamptz not null default now(),
  unique(company_id,storage_path),
  foreign key(company_id,product_id) references public.commerce_products(company_id,id) on delete cascade,
  foreign key(company_id,variant_id) references public.commerce_variants(company_id,id) on delete cascade
);
create index if not exists commerce_image_tenant_variant
  on public.commerce_product_images(company_id,variant_id);
create index if not exists commerce_image_tenant_hash
  on public.commerce_product_images(company_id,sha256);
alter table public.commerce_product_images enable row level security;
revoke all on public.commerce_product_images from public,anon,authenticated;
grant all on public.commerce_product_images to service_role;
-- Storage bucket remains private. No storage.objects policy for public roles.
