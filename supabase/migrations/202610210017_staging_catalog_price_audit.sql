-- MW1 STAGING ONLY. Intentionally NOT APPLIED until isolated web/API deploys.
-- Atomic compare-and-set price changes, audited, idempotent and tenant scoped.
create table if not exists public.commerce_price_change_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null,
  variant_id uuid not null,
  product_id uuid not null,
  request_key uuid not null,
  source_kind text not null,
  old_price numeric(14,2) not null,
  new_price numeric(14,2) not null,
  created_at timestamptz not null default now(),
  constraint commerce_price_change_unique unique(company_id,request_key),
  constraint commerce_price_change_positive check(old_price>=0 and new_price>0)
);
create index if not exists commerce_price_change_audit_recent
  on public.commerce_price_change_audit(company_id,created_at desc);
alter table public.commerce_price_change_audit enable row level security;
revoke all on public.commerce_price_change_audit from public,anon,authenticated;
grant all on public.commerce_price_change_audit to service_role;

create or replace function public.mw1_commerce_confirm_price_change(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_variant_id uuid,
  p_expected_price numeric,
  p_new_price numeric,
  p_request_key uuid
) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare
  target record;
  prior record;
  kind text;
  variants_total int;
begin
  if p_company_id is null or p_actor_user_id is null or p_variant_id is null
     or p_request_key is null
     or p_expected_price is null or p_new_price is null
     or p_expected_price<0 or p_new_price<=0
     or p_new_price>999999999 or p_new_price<>round(p_new_price,2)
     or p_expected_price<>round(p_expected_price,2) then
    raise exception 'Parámetros de precio inválidos.' using errcode='22023';
  end if;
  if not exists(
    select 1 from public.company_memberships m
    join public.app_profiles profile on profile.user_id=m.user_id
    join public.app_roles role on role.id=m.role_id
    where m.company_id=p_company_id and m.user_id=p_actor_user_id
      and m.active and profile.active and role.key in ('owner','admin')
      and (role.company_id is null or role.company_id=p_company_id)
  ) then
    raise exception 'Sin autorización para modificar precios.' using errcode='42501';
  end if;
  if not exists(
    select 1 from public.company_entitlements e
    where e.company_id=p_company_id and e.commerce_enabled and e.native_orders_enabled
  ) then
    raise exception 'Módulo de catálogo no incluido en el plan.' using errcode='42501';
  end if;
  -- Serializes updates and duplicate confirmation request IDs inside tenant.
  perform 1 from public.companies c where c.id=p_company_id and c.status='active' for update;
  if not found then
    raise exception 'Empresa no activa.' using errcode='42501';
  end if;
  select a.variant_id,a.old_price,a.new_price,a.id into prior
    from public.commerce_price_change_audit a
    where a.company_id=p_company_id and a.request_key=p_request_key;
  if found then
    if prior.variant_id<>p_variant_id or prior.new_price<>p_new_price
      or prior.old_price<>p_expected_price then
      raise exception 'Esta confirmación ya se utilizó con otros valores.' using errcode='23505';
    end if;
    return jsonb_build_object('ok',true,'alreadyApplied',true,
      'auditId',prior.id,'oldPrice',prior.old_price,'newPrice',prior.new_price);
  end if;
  -- The authoritative variant, product and source must belong to this company.
  select v.id,v.product_id,v.price,p.currency,p.source_id,
         p.external_product_id,v.external_variant_id,
         coalesce(s.kind,'manual') as source_kind,
         coalesce(s.status,'ready') as source_status
    into target
    from public.commerce_variants v
    join public.commerce_products p
      on p.id=v.product_id and p.company_id=v.company_id
    left join public.commerce_catalog_sources s
      on s.id=p.source_id and s.company_id=p.company_id
    where v.id=p_variant_id and v.company_id=p_company_id
    for update of v,p;
  if not found then
    raise exception 'Referencia no encontrada en esta empresa.' using errcode='42501';
  end if;
  kind:=target.source_kind;
  if kind not in ('manual','csv','excel','pdf')
     or target.external_product_id is not null
     or target.external_variant_id is not null then
    raise exception 'Este precio pertenece a un proveedor externo. Actualízalo en la tienda de origen.' using errcode='42501';
  end if;
  if target.source_status<>'ready' or target.currency<>'COP' then
    raise exception 'La fuente no está lista o su moneda no es COP.' using errcode='22023';
  end if;
  if target.price<>p_expected_price then
    raise exception 'El precio ya cambió. Actualiza la propuesta antes de confirmar.' using errcode='40001';
  end if;
  if p_new_price=target.price then
    raise exception 'El precio nuevo es igual al actual.' using errcode='22023';
  end if;
  update public.commerce_variants
    set price=p_new_price,updated_at=now(),
      metadata=jsonb_set(coalesce(metadata,'{}'::jsonb),'{mw1PriceOverride}',
        jsonb_build_object('source','admin-chat','price',p_new_price,'changedAt',now()),true)
    where id=p_variant_id and company_id=p_company_id;
  select count(*) into variants_total
    from public.commerce_variants where product_id=target.product_id and company_id=p_company_id;
  if variants_total>=1 then
    update public.commerce_products
      set base_price=(select min(price) from public.commerce_variants
                      where product_id=target.product_id and company_id=p_company_id),
          updated_at=now()
      where id=target.product_id and company_id=p_company_id;
  end if;
  insert into public.commerce_price_change_audit
    (company_id,user_id,variant_id,product_id,request_key,source_kind,old_price,new_price)
  values(p_company_id,p_actor_user_id,p_variant_id,target.product_id,p_request_key,
    kind,target.price,p_new_price)
  returning id into prior;
  return jsonb_build_object('ok',true,'alreadyApplied',false,'auditId',prior.id,
    'oldPrice',target.price,'newPrice',p_new_price,'sourceKind',kind);
end
$$;
revoke all on function public.mw1_commerce_confirm_price_change(uuid,uuid,uuid,numeric,numeric,uuid)
  from public,anon,authenticated;
grant execute on function public.mw1_commerce_confirm_price_change(uuid,uuid,uuid,numeric,numeric,uuid)
  to service_role;
