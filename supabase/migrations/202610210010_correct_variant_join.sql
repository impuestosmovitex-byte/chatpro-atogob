-- Staging only: correct alias from previous follow-up migration.
create or replace function public.mw1_commerce_create_order(
  p_company_id uuid, p_actor_user_id uuid, p_request_key uuid,
  p_customer_name text, p_customer_phone text, p_delivery_address text,
  p_fulfillment_method text, p_customer_note text, p_items jsonb
) returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare
  item jsonb;
  variant_row record;
  requested_id uuid;
  requested_quantity numeric(12,3);
  normalized_phone text := btrim(coalesce(p_customer_phone,''));
  normalized_name text := btrim(coalesce(p_customer_name,''));
  normalized_address text := btrim(coalesce(p_delivery_address,''));
  normalized_note text := btrim(coalesce(p_customer_note,''));
  subtotal_amount numeric(14,2) := 0;
  idempotent_order public.commerce_orders%rowtype;
  cart_id uuid;
  order_id uuid := gen_random_uuid();
  order_code text := 'MW-' || upper(substring(replace(order_id::text,'-','') from 1 for 12));
  currency_code text;
  line_count integer := 0;
  seen_ids uuid[] := '{}';
begin
  if p_company_id is null or p_actor_user_id is null or p_request_key is null then
    raise exception 'Faltan datos de empresa, usuario o solicitud.' using errcode='22023';
  end if;
  if not exists (
    select 1 from public.companies c
    join public.company_entitlements e on e.company_id=c.id
    where c.id=p_company_id and c.status='active'
      and e.commerce_enabled and e.native_orders_enabled
  ) then
    raise exception 'La empresa no tiene pedidos propios habilitados.' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.company_memberships m
    join public.app_profiles p on p.user_id=m.user_id
    join public.app_roles r on r.id=m.role_id
    where m.company_id=p_company_id and m.user_id=p_actor_user_id
      and m.active and p.active and r.key in ('owner','admin')
      and (r.company_id is null or r.company_id=p_company_id)
  ) then
    raise exception 'No tienes permisos para crear pedidos.' using errcode='42501';
  end if;

  -- Serialize per-tenant order submissions for idempotency and stable reads.
  perform 1 from public.companies where id=p_company_id for update;
  select * into idempotent_order from public.commerce_orders
    where company_id=p_company_id and request_key=p_request_key;
  if found then
    return jsonb_build_object('ok',true,'orderId',idempotent_order.id,
      'orderCode',idempotent_order.order_code,'created',false,
      'grandTotal',idempotent_order.grand_total);
  end if;

  if length(normalized_name) not between 2 and 120
    or normalized_phone !~ '^[+]?[0-9]{7,15}$'
    or length(normalized_address)>350 or length(normalized_note)>500 then
    raise exception 'Revisa el nombre, teléfono o dirección del cliente.' using errcode='22023';
  end if;
  if p_fulfillment_method not in ('local_delivery','carrier','pickup') then
    raise exception 'Método de entrega no válido.' using errcode='22023';
  end if;
  if p_fulfillment_method <> 'pickup' and length(normalized_address)<5 then
    raise exception 'Este pedido requiere dirección de entrega.' using errcode='22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) not between 1 and 40 then
    raise exception 'Selecciona de 1 a 40 referencias diferentes.' using errcode='22023';
  end if;

  insert into public.commerce_carts(company_id,channel,status,currency)
  values(p_company_id,'manual','ordered','COP') returning id into cart_id;

  for item in select value from jsonb_array_elements(p_items) x(value) loop
    if jsonb_typeof(item) is distinct from 'object'
      or coalesce(item->>'variantId','') !~ '^[0-9a-fA-F-]{36}$'
      or coalesce(item->>'quantity','') !~ '^[0-9]{1,4}([.][0-9]{1,3})?$' then
      raise exception 'Artículo o cantidad no válidos.' using errcode='22023';
    end if;
    requested_id := (item->>'variantId')::uuid;
    requested_quantity := (item->>'quantity')::numeric;
    if requested_quantity <= 0 or requested_quantity > 1000
       or requested_id = any(seen_ids) then
      raise exception 'Cantidad o referencia repetida no válida.' using errcode='22023';
    end if;
    seen_ids := array_append(seen_ids,requested_id);

    select cv.id,cv.variant_label,cv.unit,cv.price,cv.stock_quantity,cv.available,
      p.name,p.currency,p.inventory_tracking,p.available as product_available,
      p.published,s.kind,s.status as source_status
    into variant_row
    from public.commerce_variants cv
    join public.commerce_products p on p.id=cv.product_id and p.company_id=cv.company_id
    join public.commerce_catalog_sources s on s.id=p.source_id and s.company_id=p.company_id
    where cv.id=requested_id and cv.company_id=p_company_id
    for share of cv;
    if not found or not variant_row.available or not variant_row.product_available or not variant_row.published
      or variant_row.source_status<>'ready' or variant_row.kind not in ('manual','csv','excel','pdf') then
      raise exception 'Hay productos no disponibles o no autorizados en este catálogo.' using errcode='22023';
    end if;
    if variant_row.inventory_tracking and variant_row.stock_quantity is not null
       and variant_row.stock_quantity < requested_quantity then
      raise exception 'Stock insuficiente para %.',variant_row.name using errcode='23514';
    end if;
    if variant_row.price < 0 or variant_row.currency <> 'COP' then
      raise exception 'Este catálogo no tiene precios válidos en COP.' using errcode='22023';
    end if;
    subtotal_amount := subtotal_amount + round(variant_row.price*requested_quantity,2);
    if subtotal_amount > 999999999999 then
      raise exception 'El total del pedido excede el límite permitido.' using errcode='22023';
    end if;

    insert into public.commerce_cart_items
      (company_id,cart_id,variant_id,quantity,unit_price)
    values(p_company_id,cart_id,variant_row.id,requested_quantity,variant_row.price);
    line_count := line_count + 1;
  end loop;

  insert into public.commerce_orders
    (id,company_id,order_code,cart_id,channel,status,payment_status,
      currency,subtotal,delivery_fee,discount_total,grand_total,
      customer_snapshot,delivery_address,customer_note,staff_note,
      fulfillment_method,request_key)
  values(order_id,p_company_id,order_code,cart_id,'manual','pending_confirmation',
    'unpaid','COP',subtotal_amount,0,0,subtotal_amount,
    jsonb_build_object('display_name',normalized_name,'phone',normalized_phone),
    jsonb_build_object('address',normalized_address),normalized_note,
    'Orden cargada desde el CRM. El valor de envío aún no fue cotizado. Sin notificaciones reales.',
    p_fulfillment_method,p_request_key);

  insert into public.commerce_order_items
    (company_id,order_id,variant_id,product_name,variant_label,unit,quantity,unit_price)
  select ci.company_id,order_id,ci.variant_id,p.name,v.variant_label,v.unit,ci.quantity,ci.unit_price
  from public.commerce_cart_items ci
  join public.commerce_variants v on v.company_id=ci.company_id and v.id=ci.variant_id
  join public.commerce_products p on p.company_id=v.company_id and p.id=v.product_id
  where ci.company_id=p_company_id and ci.cart_id=cart_id;

  insert into public.commerce_order_events
    (company_id,order_id,event_type,actor_type,actor_reference,event_data)
  values(p_company_id,order_id,'created_manual','advisor',p_actor_user_id::text,
    jsonb_build_object('lines',line_count,'subtotal',subtotal_amount,
      'payment_status','unpaid','send_messages',false));

  return jsonb_build_object('ok',true,'orderId',order_id,'orderCode',order_code,
    'grandTotal',subtotal_amount,'created',true,'paymentStatus','unpaid');
end;
$$;

revoke all on function public.mw1_commerce_create_order(uuid,uuid,uuid,text,text,text,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.mw1_commerce_create_order(uuid,uuid,uuid,text,text,text,text,text,jsonb)
  to service_role;
comment on function public.mw1_commerce_create_order(uuid,uuid,uuid,text,text,text,text,text,jsonb)
  is 'Staging: atomic, idempotent manual native orders using authoritative variant prices; no money, notifications or stock movements.';
