/** Read-only Mercado Pago payment lookup: never follows redirects,
 * never trusts browser-provided tokens and never writes order state.
 */
export async function fetchMerchantMercadoPagoPayment(
  paymentId:string, merchantAccessToken:string,
):Promise<Record<string,unknown>>{
 if(!/^[0-9]{1,40}$/.test(paymentId)||
   !/^TEST-[A-Za-z0-9_-]{20,}$/.test(merchantAccessToken)||
   process.env.MW1_STAGING_MODE!=='true'||
   process.env.MW1_MP_SANDBOX_ORDERS_ENABLED!=='true')
  throw new Error('Consulta de pago de pruebas no autorizada.');
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),8000);
 try{
  const response=await fetch('https://api.mercadopago.com/v1/payments/'+paymentId,{
   method:'GET',signal:controller.signal,redirect:'error',
   headers:{Authorization:'Bearer '+merchantAccessToken,Accept:'application/json'},
  });
  if(!response.ok)throw new Error('El proveedor no confirmó el pago.');
  const result:unknown=await response.json();
  if(!result||typeof result!=='object'||Array.isArray(result))
   throw new Error('Respuesta de pago inválida.');
  return result as Record<string,unknown>;
 }finally{clearTimeout(timeout);}
}

/** A provider GET is necessary but insufficient: enforce all attempt/order
 * references, matching merchant account and amount before reconciliation.
 */
export function assessMerchantMercadoPagoPayment(input:{
 payment:Record<string,unknown>;
 paymentId:string;
 expectedExternalReference:string;
 expectedMerchantId:string;
 expectedAmount:number;
 expectedCurrency:string;
}):boolean{
 const {payment}=input;
 const collector=payment.collector_id;
 const collectorId=(typeof collector==='number'||typeof collector==='string')?String(collector):'';
 const amount=payment.transaction_amount;
 return String(payment.id??'')===input.paymentId &&
   payment.status==='approved' &&
   payment.status_detail==='accredited' &&
   payment.external_reference===input.expectedExternalReference &&
   collectorId===input.expectedMerchantId &&
   payment.currency_id===input.expectedCurrency &&
   typeof amount==='number' && Number.isFinite(amount) &&
   Number.isSafeInteger(Math.round(amount*100)) &&
   Math.abs(amount-input.expectedAmount)<0.000001 &&
   input.expectedAmount>0;
}
