-- MW1 native commerce v1, staging only.
-- Additive to the isolated staging baseline. No changes to Shopify or production.
-- Business data is reachable only by trusted backend using service_role.
create table public.commerce_catalog_sources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (kind in ('manual','pdf','csv','excel','shopify','tiendanube','woocommerce','website')),
  label text not null,
  status text not null default 'draft' check(status in ('draft','processing','ready','error','disabled')),
  source_url text,
  filename text,
  checksum text,
  last_synced_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id,id)
);
create index commerce_catalog_sources_by_company on public.commerce_catalog_sources(company_id,kind,status);

create table public.commerce_products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_id uuid,
  external_product_id text,
  sku text,
  name text not null check (length(btrim(name)) >= 1),
  description text not null default '',
  image_url text,
  product_url text,
  currency text not null default 'COP' check (currency ~ '^[A-Z]{3}$'),
  base_price numeric(14,2) check (base_price >= 0),
  inventory_tracking boolean not null default false,
  available boolean not null default true,
  published boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,id),
  foreign key (company_id,source_id)
    references public.commerce_catalog_sources(company_id,id)
);
create unique index commerce_products_source_external on public.commerce_products(company_id,source_id,external_product_id)
  where source_id is not null and external_product_id is not null;
create index commerce_products_company_name on public.commerce_products(company_id,name);

create table public.commerce_variants (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid not null,
  external_variant_id text,
  sku text,
  variant_label text not null default 'Única',
  unit text not null default 'unidad',
  price numeric(14,2) not null check(price >= 0),
  stock_quantity numeric(14,3),
  available boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,id),
  foreign key (company_id,product_id) references public.commerce_products(company_id,id) on delete cascade,
  check(stock_quantity is null or stock_quantity >= 0)
);
create unique index commerce_variants_company_sku_unique on public.commerce_variants(company_id,sku) where sku is not null;
create index commerce_variants_product on public.commerce_variants(company_id,product_id);

create table public.commerce_delivery_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  timezone text not null default 'America/Bogota',
  first_delivery_time time not null default time '09:00',
  accept_orders_after_hours boolean not null default true,
  allow_cash_on_delivery boolean not null default false,
  require_payment_before_preparation boolean not null default false,
  customer_instructions text not null default '',
  business_hours jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.commerce_carts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  contact_id uuid,
  session_id uuid,
  channel text not null default 'whatsapp',
  status text not null default 'active' check(status in ('active','ordered','abandoned','expired')),
  currency text not null default 'COP' check(currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz,
  unique(company_id,id),
  foreign key(company_id,contact_id) references public.contacts(company_id,id),
  foreign key(company_id,session_id) references public.conversation_sessions(company_id,id)
);
create index commerce_carts_active_by_company on public.commerce_carts(company_id,updated_at desc) where status='active';

create table public.commerce_cart_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  cart_id uuid not null,
  variant_id uuid not null,
  quantity numeric(12,3) not null check(quantity > 0),
  unit_price numeric(14,2) not null check(unit_price >= 0),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (company_id,cart_id) references public.commerce_carts(company_id,id) on delete cascade,
  foreign key (company_id,variant_id) references public.commerce_variants(company_id,id),
  unique(company_id,cart_id,variant_id)
);
create index commerce_cart_items_by_cart on public.commerce_cart_items(company_id,cart_id);

create table public.commerce_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_code text not null,
  cart_id uuid,
  contact_id uuid,
  session_id uuid,
  channel text not null default 'whatsapp',
  status text not null default 'pending_confirmation' check(status in
    ('pending_confirmation','confirmed','preparing','ready','dispatched','delivered','cancelled')),
  payment_status text not null default 'unpaid' check(payment_status in
    ('unpaid','pending','partially_paid','paid','partially_refunded','refunded')),
  currency text not null default 'COP' check(currency ~ '^[A-Z]{3}$'),
  subtotal numeric(14,2) not null default 0 check(subtotal >= 0),
  delivery_fee numeric(14,2) not null default 0 check(delivery_fee >= 0),
  discount_total numeric(14,2) not null default 0 check(discount_total >= 0),
  grand_total numeric(14,2) not null default 0 check(grand_total >= 0),
  customer_snapshot jsonb not null default '{}'::jsonb,
  delivery_address jsonb not null default '{}'::jsonb,
  customer_note text not null default '',
  staff_note text not null default '',
  scheduled_for timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,id),
  unique(company_id,order_code),
  foreign key (company_id,cart_id) references public.commerce_carts(company_id,id),
  foreign key (company_id,contact_id) references public.contacts(company_id,id),
  foreign key (company_id,session_id) references public.conversation_sessions(company_id,id),
  check(discount_total <= subtotal+delivery_fee)
);
create index commerce_orders_company_queue on public.commerce_orders(company_id,status,created_at desc);
create index commerce_orders_company_payment on public.commerce_orders(company_id,payment_status,created_at desc);

create table public.commerce_order_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null,
  variant_id uuid,
  product_name text not null,
  variant_label text,
  unit text not null default 'unidad',
  quantity numeric(12,3) not null check(quantity > 0),
  unit_price numeric(14,2) not null check(unit_price >= 0),
  discount_amount numeric(14,2) not null default 0 check(discount_amount >= 0),
  line_total numeric(18,2) generated always as (round(quantity*unit_price-discount_amount,2)) stored,
  created_at timestamptz not null default now(),
  foreign key(company_id,order_id) references public.commerce_orders(company_id,id) on delete cascade,
  foreign key(company_id,variant_id) references public.commerce_variants(company_id,id),
  check(discount_amount <= quantity*unit_price)
);
create index commerce_order_items_company_order on public.commerce_order_items(company_id,order_id);

create table public.commerce_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null,
  provider text not null,
  provider_payment_id text,
  idempotency_key text,
  status text not null default 'created' check(status in
    ('created','pending','approved','rejected','cancelled','partially_refunded','refunded')),
  currency text not null default 'COP' check(currency ~ '^[A-Z]{3}$'),
  amount numeric(14,2) not null check(amount >= 0),
  checkout_url text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,id),
  foreign key(company_id,order_id) references public.commerce_orders(company_id,id) on delete cascade
);
create unique index commerce_payments_provider_external_unique on public.commerce_payments(company_id,provider,provider_payment_id)
  where provider_payment_id is not null;
create unique index commerce_payments_idempotency_unique on public.commerce_payments(company_id,idempotency_key)
  where idempotency_key is not null;
create index commerce_payments_by_order on public.commerce_payments(company_id,order_id);

create table public.commerce_payment_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  payment_id uuid,
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  signature_verified boolean not null default false,
  processed boolean not null default false,
  payload_hash text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(company_id,provider,provider_event_id),
  foreign key(company_id,payment_id) references public.commerce_payments(company_id,id)
);
create index commerce_payment_events_by_company_time on public.commerce_payment_events(company_id,received_at desc);

create table public.commerce_shipments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null,
  carrier text,
  tracking_number text,
  tracking_url text,
  status text not null default 'pending' check(status in ('pending','prepared','dispatched','delivered','returned','cancelled')),
  dispatched_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(company_id,order_id) references public.commerce_orders(company_id,id) on delete cascade
);
create index commerce_shipments_by_order on public.commerce_shipments(company_id,order_id);

create table public.commerce_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  variant_id uuid not null,
  order_id uuid,
  quantity_delta numeric(14,3) not null check(quantity_delta <> 0),
  reason text not null,
  event_key text,
  created_at timestamptz not null default now(),
  foreign key(company_id,variant_id) references public.commerce_variants(company_id,id),
  foreign key(company_id,order_id) references public.commerce_orders(company_id,id)
);
create unique index commerce_inventory_event_key_unique on public.commerce_inventory_movements(company_id,event_key)
  where event_key is not null;
create index commerce_inventory_movements_variant on public.commerce_inventory_movements(company_id,variant_id,created_at desc);

create table public.commerce_order_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null,
  event_type text not null,
  actor_type text not null check(actor_type in ('customer','ai','advisor','system','payment_provider')),
  actor_reference text,
  event_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key(company_id,order_id) references public.commerce_orders(company_id,id) on delete cascade
);
create index commerce_order_events_history on public.commerce_order_events(company_id,order_id,created_at desc);

-- Explicitly deny Data API access with anon/authenticated. The backend's
-- authenticated, tenant-authorized service layer is required for business data.
do $mw1$
declare table_name text;
begin
  foreach table_name in array array[
    'commerce_catalog_sources','commerce_products','commerce_variants','commerce_delivery_settings',
    'commerce_carts','commerce_cart_items','commerce_orders','commerce_order_items',
    'commerce_payments','commerce_payment_events','commerce_shipments',
    'commerce_inventory_movements','commerce_order_events'
  ] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('revoke all privileges on table public.%I from public, anon, authenticated',table_name);
    execute format('grant all privileges on table public.%I to service_role',table_name);
  end loop;
end $mw1$;
