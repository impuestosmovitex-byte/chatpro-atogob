/** Server-side reconciliation guard for Mercado Pago subscriptions.
 * Does not create charges or grant company access.
 */
export type VerifiedProviderPreapproval={
 providerSubscriptionId:string;
 intentId:string;
 status:string;
 amountCop:number;
 currency:string;
};
export function validateProviderPreapproval(value:unknown,expected:{
 providerSubscriptionId:string;intentId:string;monthlyAmountCop:number;
}):VerifiedProviderPreapproval{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Respuesta de Mercado Pago inválida.');
 const data=value as Record<string,unknown>;
 const id=String(data.id??'');
 const reference=String(data.external_reference??'');
 const recurring=data.auto_recurring;
 if(!recurring||typeof recurring!=='object'||Array.isArray(recurring))throw new Error('Falta detalle de recurrencia.');
 const r=recurring as Record<string,unknown>;
 if(id!==expected.providerSubscriptionId||reference!=='mw1:'+expected.intentId)
  throw new Error('La suscripción no corresponde a la contratación esperada.');
 if(r.currency_id!=='COP'||r.transaction_amount!==expected.monthlyAmountCop||
   r.frequency!==1||r.frequency_type!=='months')
  throw new Error('El importe o periodicidad no coincide con MW1.');
 const status=String(data.status??'');
 if(!['pending','authorized','paused','cancelled'].includes(status))
  throw new Error('Estado de suscripción desconocido.');
 return {providerSubscriptionId:id,intentId:expected.intentId,status,
  amountCop:expected.monthlyAmountCop,currency:'COP'};
}
export async function fetchProviderPreapprovalReadOnly(token:string,id:string):Promise<unknown>{
 if(!/^[a-zA-Z0-9_-]{8,120}$/.test(id))throw new Error('Identificador inválido.');
 const response=await fetch('https://api.mercadopago.com/preapproval/'+encodeURIComponent(id),{
  headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000),
 });
 if(!response.ok)throw new Error('No se pudo verificar la suscripción con Mercado Pago.');
 return response.json();
}
