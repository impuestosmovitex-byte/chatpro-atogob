-- MW1 STAGING ONLY: logistics and safe notification drafts.
-- No external sender/worker is registered. Notifications stay in preview mode.
alter table public.commerce_orders
  add column if not exists fulfillment_method text not null default 'local_delivery'
    check (fulfillment_method in ('local_delivery','carrier','pickup'));

create table if not exists public.commerce_order_notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null,
  event_type text not null check (event_type in ('ready','dispatched','delivered')),
  channel text not null default 'whatsapp',
  message_body text not null,
  status text not null default 'preview' check (status in ('preview','queued','sent','failed','cancelled')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (company_id, order_id, event_type),
  foreign key (company_id, order_id) references public.commerce_orders(company_id,id) on delete cascade
);
create index if not exists commerce_notifications_tenant_queue
  on public.commerce_order_notifications(company_id,status,created_at desc);
alter table public.commerce_order_notifications enable row level security;
revoke all on public.commerce_order_notifications from public, anon, authenticated;
grant all on public.commerce_order_notifications to service_role;

create table if not exists public.commerce_notification_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  notify_ready boolean not null default true,
  notify_dispatched boolean not null default true,
  notify_delivered boolean not null default true,
  enabled_for_real_sending boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.commerce_notification_settings enable row level security;
revoke all on public.commerce_notification_settings from public, anon, authenticated;
grant all on public.commerce_notification_settings to service_role;

create or replace function public.mw1_commerce_transition_order_v2(
  p_company_id uuid,
  p_order_id uuid,
  p_expected_status text,
  p_next_status text,
  p_actor_user_id uuid,
  p_fulfillment_method text default null,
  p_carrier text default null,
  p_tracking_number text default null
)
returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare
  order_row public.commerce_orders%rowtype;
  requires_payment boolean;
  method text;
  carrier_name text;
  tracking text;
  notification_text text;
  notification_enabled boolean;
  notification_preview_id uuid;
begin
  if p_company_id is null or p_order_id is null or p_actor_user_id is null then
    raise exception 'Faltan empresa, pedido o asesor autenticado.' using errcode='22023';
  end if;
  if not exists (
    select 1 from public.companies c
    join public.company_entitlements e on e.company_id=c.id
    where c.id=p_company_id and c.status='active'
      and e.commerce_enabled and e.native_orders_enabled
  ) then
    raise exception 'La empresa no tiene pedidos habilitados.' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.company_memberships m
    join public.app_roles r on r.id=m.role_id
    join public.app_profiles a on a.user_id=m.user_id
    where m.company_id=p_company_id and m.user_id=p_actor_user_id and m.active and a.active
      and r.key in ('owner','admin') and (r.company_id is null or r.company_id=p_company_id)
  ) then
    raise exception 'Usuario sin permisos para operar este pedido.' using errcode='42501';
  end if;

  select * into order_row from public.commerce_orders
   where company_id=p_company_id and id=p_order_id for update;
  if not found then
    raise exception 'Pedido no encontrado.' using errcode='P0002';
  end if;
  if order_row.status is distinct from p_expected_status then
    raise exception 'El pedido cambió de estado. Actualiza antes de continuar.' using errcode='40001';
  end if;
  if not (
    (order_row.status='pending_confirmation' and p_next_status in ('confirmed','cancelled')) or
    (order_row.status='confirmed' and p_next_status in ('preparing','cancelled')) or
    (order_row.status='preparing' and p_next_status in ('ready','cancelled')) or
    (order_row.status='ready' and p_next_status in ('dispatched','cancelled')) or
    (order_row.status='dispatched' and p_next_status='delivered')
  ) then
    raise exception 'Transición de pedido no permitida.' using errcode='22023';
  end if;

  if p_next_status='preparing' then
    select coalesce(s.require_payment_before_preparation,false)
      into requires_payment
      from public.commerce_delivery_settings s where s.company_id=p_company_id;
    if coalesce(requires_payment,false) and order_row.payment_status <> 'paid' then
      raise exception 'Se necesita un pago confirmado antes de preparar.' using errcode='23514';
    end if;
  end if;

  method := coalesce(nullif(btrim(p_fulfillment_method),''),order_row.fulfillment_method);
  if method not in ('local_delivery','carrier','pickup') then
    raise exception 'Selecciona entrega local, transportadora o recogida.' using errcode='22023';
  end if;
  if method <> order_row.fulfillment_method and p_next_status <> 'dispatched' then
    raise exception 'El método de entrega se confirma al despachar.' using errcode='22023';
  end if;

  carrier_name := nullif(btrim(coalesce(p_carrier,'')),'');
  tracking := nullif(btrim(coalesce(p_tracking_number,'')),'');
  if p_next_status='dispatched' and method='carrier' then
    if carrier_name is null or tracking is null
       or length(carrier_name)>100 or length(tracking)>120
       or length(carrier_name)<2 or length(tracking)<3
       or carrier_name ~ '[[:cntrl:]]' or tracking ~ '[[:cntrl:]]' then
      raise exception 'Para enviar por transportadora indica empresa y número de guía válidos.' using errcode='22023';
    end if;
  elsif p_next_status='dispatched' and (carrier_name is not null or tracking is not null) then
    raise exception 'El número de guía se registra solo para envíos por transportadora.' using errcode='22023';
  end if;

  update public.commerce_orders set
    status=p_next_status,
    fulfillment_method=method,
    confirmed_at=case when p_next_status='confirmed' then coalesce(confirmed_at,now()) else confirmed_at end,
    updated_at=now()
  where company_id=p_company_id and id=p_order_id;

  if p_next_status='dispatched' then
    insert into public.commerce_shipments
      (company_id,order_id,carrier,tracking_number,status,dispatched_at)
    values (
      p_company_id,p_order_id,
      case when method='carrier' then carrier_name
        when method='local_delivery' then 'Reparto propio'
        else 'Recogida en tienda' end,
      tracking,'dispatched',now()
    );
  elsif p_next_status='delivered' then
    update public.commerce_shipments set status='delivered',delivered_at=now(),updated_at=now()
      where company_id=p_company_id and order_id=p_order_id and status='dispatched';
  end if;

  insert into public.commerce_order_events
    (company_id,order_id,event_type,actor_type,actor_reference,event_data)
  values (p_company_id,p_order_id,'status_changed','advisor',p_actor_user_id::text,
    jsonb_build_object('from',p_expected_status,'to',p_next_status,
       'fulfillment_method',method,'carrier',carrier_name,'tracking_number',tracking));

  notification_text := null;
  if p_next_status='ready' then
    notification_text := case when method='pickup' then
      format('¡Hola! Tu pedido %s ya está listo para recoger. Gracias por comprar con nosotros.',order_row.order_code)
    else format('¡Hola! Tu pedido %s ya está listo. Te avisaremos cuando salga a entrega.',order_row.order_code) end;
  elsif p_next_status='dispatched' then
    notification_text := case when method='carrier' then
      format('¡Hola! Tu pedido %s fue enviado por %s. Número de guía: %s. Gracias por tu compra.',order_row.order_code,carrier_name,tracking)
    when method='local_delivery' then
      format('¡Hola! Tu pedido %s va en camino con nuestro repartidor.',order_row.order_code)
    else format('¡Hola! Tu pedido %s está preparado para la recogida. Confirma con la tienda los detalles.',order_row.order_code) end;
  elsif p_next_status='delivered' then
    notification_text := format('¡Hola! Tu pedido %s ha sido registrado como entregado. ¡Gracias por tu compra!',order_row.order_code);
  end if;

  if notification_text is not null then
    select case p_next_status
      when 'ready' then coalesce(s.notify_ready,true)
      when 'dispatched' then coalesce(s.notify_dispatched,true)
      when 'delivered' then coalesce(s.notify_delivered,true)
      else false end
    into notification_enabled
    from public.commerce_notification_settings s
    where s.company_id=p_company_id;
    notification_enabled := coalesce(notification_enabled,true);
    if notification_enabled then
      insert into public.commerce_order_notifications
        (company_id,order_id,event_type,channel,message_body,status)
      values(p_company_id,p_order_id,p_next_status,order_row.channel,notification_text,'preview')
      on conflict(company_id,order_id,event_type) do nothing
      returning id into notification_preview_id;
    end if;
  end if;

  return jsonb_build_object('ok',true,'orderId',p_order_id,'status',p_next_status,
    'notificationPrepared',notification_preview_id is not null,
    'messageDelivery','preview_only');
end;
$$;
revoke all on function public.mw1_commerce_transition_order_v2(uuid,uuid,text,text,uuid,text,text,text)
  from public,anon,authenticated;
grant execute on function public.mw1_commerce_transition_order_v2(uuid,uuid,text,text,uuid,text,text,text)
  to service_role;
comment on function public.mw1_commerce_transition_order_v2(uuid,uuid,text,text,uuid,text,text,text)
  is 'Staging-only order, shipment and notification preview atomic transition. Does not send messages or update payments.';
