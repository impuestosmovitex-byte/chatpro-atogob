-- MW1 staging ONLY. Review before applying; do NOT run in production.
-- Single transaction confirmation protected by a row lock, merchant ownership,
-- amount/currency matching and an independently reviewed webhook event.
-- The application must perform a fresh authenticated provider GET before calling.
create or replace function public.mw1_staging_confirm_verified_merchant_payment(
  p_company_id uuid, p_order_id uuid, p_attempt_id uuid, p_provider_payment_id text
) returns boolean language plpgsql security invoker set search_path=public as $$
declare
  v_order public.commerce_orders%rowtype;
  v_attempt public.commerce_payments%rowtype;
begin
  if p_provider_payment_id is null or p_provider_payment_id !~ '^[0-9]{1,40}$' then
    return false;
  end if;
  select * into v_order from public.commerce_orders
   where id=p_order_id and company_id=p_company_id for update;
  if not found or v_order.status not in ('pending_confirmation','confirmed')
    or v_order.payment_status not in ('unpaid','pending') or v_order.grand_total<=0 then
    return false;
  end if;
  select * into v_attempt from public.commerce_payments
   where id=p_attempt_id and order_id=p_order_id and company_id=p_company_id for update;
  if not found or v_attempt.provider<>'mercado_pago'
    or v_attempt.provider_payment_id is distinct from p_provider_payment_id
    or v_attempt.status not in ('created','pending')
    or v_attempt.currency<>v_order.currency or v_attempt.amount<>v_order.grand_total then
    return false;
  end if;
  if not exists (
    select 1 from public.mw1_merchant_mp_webhook_inbox w
    where w.company_id=p_company_id and w.order_id=p_order_id
    and w.attempt_id=p_attempt_id and w.provider_payment_id=p_provider_payment_id
    and w.review_outcome='verified_readonly' and w.reviewed_at is not null
  ) then return false; end if;
  update public.commerce_payments set status='approved',approved_at=now()
   where id=p_attempt_id and company_id=p_company_id;
  update public.commerce_orders set payment_status='paid'
   where id=p_order_id and company_id=p_company_id and payment_status in ('unpaid','pending');
  return true;
end;
$$;
-- SECURITY: deny direct browser and ordinary authenticated RPC execution.
revoke all on function public.mw1_staging_confirm_verified_merchant_payment(uuid,uuid,uuid,text) from public,anon,authenticated;
-- Important: do NOT grant EXECUTE until signed provider reconciliation,
-- merchant-credential ownership, and full sandbox integration tests pass.
