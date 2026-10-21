-- MW1 staging: atomic CSV catalog batches with tenant isolation, quotas and idempotency.
-- Files themselves are not stored. Only rows explicitly approved in the preview are imported.
create table if not exists public.commerce_catalog_import_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  request_key uuid not null,
  source_id uuid not null,
  product_count integer not null check(product_count between 1 and 100),
  created_at timestamptz not null default now(),
  unique(company_id,request_key),
  foreign key(company_id,source_id) references public.commerce_catalog_sources(company_id,id)
);
create index if not exists commerce_catalog_imports_recent on public.commerce_catalog_import_batches(company_id,created_at desc);
alter table public.commerce_catalog_import_batches enable row level security;
revoke all on public.commerce_catalog_import_batches from public,anon,authenticated;
grant all on public.commerce_catalog_import_batches to service_role;

create or replace function public.mw1_commerce_import_csv_catalog(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_request_key uuid,
  p_source_label text,
  p_rows jsonb
) returns jsonb language plpgsql security invoker set search_path=public
as $fn$
declare
  import_record record;
  element jsonb;
  new_source uuid;
  new_product uuid;
  product_sku text;
  product_name text;
  price_cop numeric(14,2);
  available_stock numeric(14,3);
  maximum_products integer;
  present_products integer;
  requested_count integer;
  row_index integer := 0;
  known_skus text[] := array[]::text[];
begin
  if p_company_id is null or p_actor_user_id is null or p_request_key is null then
    raise exception 'Faltan identificadores de empresa, usuario o importación.' using errcode='22023';
  end if;
  if not exists(
    select 1 from public.company_memberships m
    join public.app_profiles profile on profile.user_id=m.user_id
    join public.app_roles role on role.id=m.role_id
    where m.company_id=p_company_id and m.user_id=p_actor_user_id
      and m.active and profile.active and role.key in ('owner','admin')
      and (role.company_id is null or role.company_id=p_company_id)
  ) then
    raise exception 'No tienes permisos para importar este catálogo.' using errcode='42501';
  end if;
  perform 1 from public.companies c where c.id=p_company_id and c.status='active' for update;
  if not found then
    raise exception 'La empresa no está activa.' using errcode='42501';
  end if;
  select b.source_id,b.product_count into import_record
    from public.commerce_catalog_import_batches b
    where b.company_id=p_company_id and b.request_key=p_request_key;
  if found then
    return jsonb_build_object('ok',true,'imported',import_record.product_count,
      'sourceId',import_record.source_id,'created',false);
  end if;
  select e.max_catalog_items into maximum_products
    from public.company_entitlements e where e.company_id=p_company_id
      and e.commerce_enabled and e.native_orders_enabled;
  if maximum_products is null then
    raise exception 'El plan actual no permite importar catálogos.' using errcode='42501';
  end if;
  if length(btrim(coalesce(p_source_label,''))) not between 3 and 120 then
    raise exception 'El nombre del catálogo es inválido.' using errcode='22023';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'El catálogo debe contener una lista de productos.' using errcode='22023';
  end if;
  requested_count:=jsonb_array_length(p_rows);
  if requested_count not between 1 and 100 then
    raise exception 'Importa entre 1 y 100 productos por lote.' using errcode='22023';
  end if;
  select count(*) into present_products from public.commerce_products
    where company_id=p_company_id;
  if present_products+requested_count>maximum_products then
    raise exception 'La importación supera el límite de productos contratado.' using errcode='23514';
  end if;

  insert into public.commerce_catalog_sources
    (company_id,kind,label,status,metadata)
  values(p_company_id,'csv',btrim(p_source_label),'processing',
    jsonb_build_object('originalFormat','csv','reviewed',true,'items',requested_count))
  returning id into new_source;

  for element in select item.value from jsonb_array_elements(p_rows) as item(value) loop
    row_index:=row_index+1;
    if jsonb_typeof(element) is distinct from 'object' then
      raise exception 'Fila %: estructura inválida.',row_index using errcode='22023';
    end if;
    product_sku:=upper(btrim(coalesce(element->>'sku','')));
    product_name:=btrim(coalesce(element->>'name',''));
    if length(product_sku) not between 2 and 64 or product_sku !~ '^[A-Z0-9._-]+$'
      or length(product_name) not between 2 and 180 then
      raise exception 'Fila %: nombre o referencia inválidos.',row_index using errcode='22023';
    end if;
    if jsonb_typeof(element->'price') is distinct from 'number' then
      raise exception 'Fila %: el precio debe ser numérico.',row_index using errcode='22023';
    end if;
    price_cop:=(element->>'price')::numeric;
    if price_cop<0 or price_cop>999999999999 or price_cop<>round(price_cop,2) then
      raise exception 'Fila %: precio inválido en COP.',row_index using errcode='22023';
    end if;
    available_stock:=null;
    if element ? 'stock' and jsonb_typeof(element->'stock')<>'null' then
      if jsonb_typeof(element->'stock') is distinct from 'number' then
        raise exception 'Fila %: inventario inválido.',row_index using errcode='22023';
      end if;
      available_stock:=(element->>'stock')::numeric;
      if available_stock<0 or available_stock>999999999 or
         available_stock<>round(available_stock,3) then
        raise exception 'Fila %: inventario inválido.',row_index using errcode='22023';
      end if;
    end if;
    if product_sku=any(known_skus) or exists(
      select 1 from public.commerce_variants v
      where v.company_id=p_company_id and v.sku=product_sku
    ) then
      raise exception 'Fila %: SKU repetido o ya existente (%).',row_index,product_sku using errcode='23505';
    end if;
    known_skus:=array_append(known_skus,product_sku);
    insert into public.commerce_products
      (company_id,source_id,sku,name,base_price,currency,inventory_tracking,available,published)
    values(p_company_id,new_source,product_sku,product_name,price_cop,'COP',
      available_stock is not null,true,true)
    returning id into new_product;
    insert into public.commerce_variants
      (company_id,product_id,sku,variant_label,unit,price,stock_quantity,available)
    values(p_company_id,new_product,product_sku,'Única','unidad',price_cop,available_stock,true);
  end loop;
  update public.commerce_catalog_sources set status='ready',last_synced_at=now(),updated_at=now()
    where company_id=p_company_id and id=new_source;
  insert into public.commerce_catalog_import_batches
    (company_id,request_key,source_id,product_count)
  values(p_company_id,p_request_key,new_source,requested_count);
  return jsonb_build_object('ok',true,'imported',requested_count,
    'sourceId',new_source,'created',true);
end
$fn$;

revoke all on function public.mw1_commerce_import_csv_catalog(uuid,uuid,uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.mw1_commerce_import_csv_catalog(uuid,uuid,uuid,text,jsonb)
  to service_role;
