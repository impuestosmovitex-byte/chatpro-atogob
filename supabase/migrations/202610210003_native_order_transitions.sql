-- MW1 SaaS staging only: atomic order state transitions (no payment mutations).
create or replace function public.mw1_commerce_transition_order(
  p_company_id uuid,
  p_order_id uuid,
  p_expected_status text,
  p_next_status text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  order_row public.commerce_orders%rowtype;
  requires_payment boolean;
begin
  if p_company_id is null or p_order_id is null or p_actor_user_id is null then
    raise exception 'Se requieren empresa, pedido y asesor autenticado.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.companies c
    join public.company_entitlements e on e.company_id=c.id
    where c.id=p_company_id and c.status='active'
      and e.commerce_enabled and e.native_orders_enabled
  ) then
    raise exception 'Empresa sin módulo de pedidos habilitado.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.company_memberships m
    join public.app_roles r on r.id=m.role_id
    where m.company_id=p_company_id and m.user_id=p_actor_user_id and m.active
      and r.key in ('owner','admin')
      and (r.company_id is null or r.company_id=p_company_id)
  ) then
    raise exception 'El usuario no tiene permiso para operar pedidos.' using errcode = '42501';
  end if;

  select * into order_row
  from public.commerce_orders o
  where o.company_id=p_company_id and o.id=p_order_id
  for update;
  if not found then
    raise exception 'Pedido no encontrado.' using errcode = 'P0002';
  end if;
  if order_row.status is distinct from p_expected_status then
    raise exception 'El pedido cambió de estado. Actualiza la bandeja antes de continuar.' using errcode = '40001';
  end if;

  if not (
    (order_row.status='pending_confirmation' and p_next_status in ('confirmed','cancelled')) or
    (order_row.status='confirmed' and p_next_status in ('preparing','cancelled')) or
    (order_row.status='preparing' and p_next_status in ('ready','cancelled')) or
    (order_row.status='ready' and p_next_status in ('dispatched','cancelled')) or
    (order_row.status='dispatched' and p_next_status='delivered')
  ) then
    raise exception 'Cambio de estado no permitido.' using errcode = '22023';
  end if;

  if p_next_status='preparing' then
    select coalesce(s.require_payment_before_preparation,false)
    into requires_payment
    from public.commerce_delivery_settings s
    where s.company_id=p_company_id;
    if coalesce(requires_payment,false) and order_row.payment_status <> 'paid' then
      raise exception 'Este negocio requiere pago confirmado antes de preparar.' using errcode = '23514';
    end if;
  end if;

  update public.commerce_orders
  set status=p_next_status,
      confirmed_at=case when p_next_status='confirmed' then coalesce(confirmed_at,now()) else confirmed_at end,
      updated_at=now()
  where company_id=p_company_id and id=p_order_id;

  insert into public.commerce_order_events(company_id,order_id,event_type,actor_type,actor_reference,event_data)
  values(p_company_id,p_order_id,'status_changed','advisor',p_actor_user_id::text,
    jsonb_build_object('from',p_expected_status,'to',p_next_status));

  return jsonb_build_object('ok',true,'orderId',p_order_id,'status',p_next_status);
end;
$$;
revoke all on function public.mw1_commerce_transition_order(uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.mw1_commerce_transition_order(uuid,uuid,text,text,uuid) to service_role;
comment on function public.mw1_commerce_transition_order(uuid,uuid,text,text,uuid) is 'Backend-only, membership-checked, atomic status transition. Never sets payment_status.';
