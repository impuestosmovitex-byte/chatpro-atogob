-- STAGING ONLY: atomic native catalog creation, no external Shopify effects.
create or replace function public.mw1_commerce_create_manual_product(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_sku text,
  p_name text,
  p_price numeric,
  p_stock numeric default null
)
returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare
  entitlement public.company_entitlements%rowtype;
  source_id uuid;
  product_id uuid;
  variant_id uuid;
  current_count integer;
  normalized_sku text;
begin
  normalized_sku := upper(btrim(coalesce(p_sku,'')));
  if length(normalized_sku) not between 2 and 64 or normalized_sku !~ '^[A-Z0-9._-]+$' then
    raise exception 'Código SKU inválido (2 a 64 caracteres alfanuméricos).' using errcode='22023';
  end if;
  if length(btrim(coalesce(p_name,''))) not between 2 and 180 then
    raise exception 'Nombre de producto inválido.' using errcode='22023';
  end if;
  if p_price is null or p_price < 0 or p_price > 999999999999 then
    raise exception 'Precio inválido.' using errcode='22023';
  end if;
  if p_stock is not null and (p_stock < 0 or p_stock > 999999999) then
    raise exception 'Inventario inválido.' using errcode='22023';
  end if;

  select e.* into entitlement from public.company_entitlements e
  join public.companies c on c.id=e.company_id
  where e.company_id=p_company_id and c.status='active'
  for update of e;
  if not found or not entitlement.commerce_enabled then
    raise exception 'Catálogo no incluido en el plan de la empresa.' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.company_memberships m
    join public.app_roles r on r.id=m.role_id
    join public.app_profiles a on a.user_id=m.user_id
    where m.company_id=p_company_id and m.user_id=p_actor_user_id
      and m.active and a.active and r.key in ('owner','admin')
      and (r.company_id is null or r.company_id=p_company_id)
  ) then
    raise exception 'Usuario no autorizado para administrar el catálogo.' using errcode='42501';
  end if;

  select count(*) into current_count from public.commerce_products
  where company_id=p_company_id;
  if current_count >= entitlement.max_catalog_items then
    raise exception 'Se alcanzó el límite de productos contratado.' using errcode='23514';
  end if;

  if exists(select 1 from public.commerce_variants where company_id=p_company_id and sku=normalized_sku) then
    raise exception 'Este SKU ya existe en el catálogo.' using errcode='23505';
  end if;

  select id into source_id from public.commerce_catalog_sources
  where company_id=p_company_id and kind='manual' and status='ready'
  order by created_at limit 1;
  if source_id is null then
    insert into public.commerce_catalog_sources(company_id,kind,label,status)
    values(p_company_id,'manual','Productos agregados desde MW1','ready')
    returning id into source_id;
  end if;

  insert into public.commerce_products
    (company_id,source_id,sku,name,base_price,published,available,inventory_tracking)
  values (p_company_id,source_id,normalized_sku,btrim(p_name),p_price,true,true,p_stock is not null)
  returning id into product_id;

  insert into public.commerce_variants
    (company_id,product_id,sku,price,stock_quantity,variant_label)
  values (p_company_id,product_id,normalized_sku,p_price,p_stock,'Única')
  returning id into variant_id;

  return jsonb_build_object('ok',true,'productId',product_id,'variantId',variant_id);
end;
$$;
revoke all on function public.mw1_commerce_create_manual_product(uuid,uuid,text,text,numeric,numeric)
  from public,anon,authenticated;
grant execute on function public.mw1_commerce_create_manual_product(uuid,uuid,text,text,numeric,numeric)
  to service_role;
