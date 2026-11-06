/**
 * Mercado Pago Checkout Pro (Preferences) — pure request preparation.
 * This module NEVER contacts the provider or handles tokens. A future
 * server-side adapter must fetch merchant credentials scoped to the company.
 */
export type MercadoPagoPreferenceInput = Readonly<{
  companyId:string;
  orderId:string;
  attemptId:string;
  orderCode:string;
  title:string;
  currency:string;
  amountMinor:number;
}>;

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function buildStagingMercadoPagoPreference(input:MercadoPagoPreferenceInput) {
  if(!uuid.test(input.companyId)||!uuid.test(input.orderId)||!uuid.test(input.attemptId)||
    !/^[a-zA-Z0-9._-]{1,70}$/.test(input.orderCode)||
    typeof input.title!=='string'||input.title.length<2||input.title.length>180||
    !['COP'].includes(input.currency)||
    !Number.isSafeInteger(input.amountMinor)||input.amountMinor<=0||
    input.amountMinor%100!==0) {
    throw new Error('Pedido o intento no válido para preferencia de prueba.');
  }
  // Explicit order + attempt references; the payment handler must compare
  // these with records fetched independently from the same merchant account.
  const externalReference=[input.companyId,input.orderId,input.attemptId].join(':');
  return {
    items:[{
      id:input.orderCode,
      title:input.title.trim(),
      quantity:1,
      currency_id:input.currency,
      unit_price:input.amountMinor/100,
    }],
    external_reference:externalReference,
    metadata:{
      mw1_company_id:input.companyId,
      mw1_order_id:input.orderId,
      mw1_attempt_id:input.attemptId,
    },
  };
}
