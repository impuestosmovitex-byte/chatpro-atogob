/**
 * Validate a Mercado Pago payment using a fresh server-side GET result.
 * This pure guard does not change entitlements or billing records.
 */
export type MW1VerifiedPayment = {
 providerPaymentId:string;
 providerSubscriptionId:string;
 amountCop:number;
 status:'approved';
 currency:'COP';
};
export function validateMW1Payment(value:unknown,expected:{
 paymentId:string;providerSubscriptionId:string;amountCop:number;
}):MW1VerifiedPayment {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Respuesta de pago inválida.');
 const p=value as Record<string,unknown>;
 const id=String(p.id??'');
 if(id!==expected.paymentId)throw new Error('Identificador de pago no coincide.');
 if(p.status!=='approved'||p.status_detail!=='accredited')throw new Error('Pago aún no acreditado.');
 if(p.currency_id!=='COP'||p.transaction_amount!==expected.amountCop)throw new Error('Monto o moneda no coinciden.');
 // Subscription must match a trusted server-side record, never a browser-supplied reference.
 const subscriptionId=String(p.preapproval_id??p.subscription_id??'');
 if(!subscriptionId||subscriptionId!==expected.providerSubscriptionId)
  throw new Error('Pago no asociado a la suscripción esperada.');
 return {providerPaymentId:id,providerSubscriptionId:subscriptionId,amountCop:expected.amountCop,status:'approved',currency:'COP'};
}
export async function getMercadoPagoPaymentReadOnly(token:string,id:string):Promise<unknown>{
 if(!/^[0-9]{1,30}$/.test(id))throw new Error('Identificador de pago inválido.');
 const response=await fetch('https://api.mercadopago.com/v1/payments/'+encodeURIComponent(id),{
  headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000),
 });
 if(!response.ok)throw new Error('No se pudo confirmar el pago con Mercado Pago.');
 return response.json();
}
