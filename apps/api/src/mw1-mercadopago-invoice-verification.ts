/** Read-only invoice lookup for Mercado Pago subscription_authorized_payment events.
 * An invoice does not, by itself, prove an accredited transaction.
 */
export async function getMPSubscriptionInvoiceReadOnly(token:string,invoiceId:string):Promise<unknown>{
 if(!/^[0-9a-zA-Z_-]{1,120}$/.test(invoiceId))throw new Error('Invalid invoice ID.');
 const result=await fetch('https://api.mercadopago.com/authorized_payments/'+encodeURIComponent(invoiceId),{
  headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000),
 });
 if(!result.ok)throw new Error('Invoice verification unavailable.');
 return result.json();
}
export function validateMPSubscriptionInvoice(value:unknown,expected:{invoiceId:string;subscriptionId:string}){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid invoice.');
 const invoice=value as Record<string,unknown>;
 if(String(invoice.id??'')!==expected.invoiceId)throw new Error('Invoice ID mismatch.');
 if(String(invoice.preapproval_id??'')!==expected.subscriptionId)throw new Error('Invoice subscription mismatch.');
 return {invoiceId:expected.invoiceId,subscriptionId:expected.subscriptionId,
  status:String(invoice.status??'unknown'),paymentConfirmed:false};
}

/** Require accredited invoice payment plus matching amount before payment lookup. */
export function extractAccreditedInvoicePayment(value:unknown,expected:{
 invoiceId:string;subscriptionId:string;amountCop:number;
}){
 validateMPSubscriptionInvoice(value,{invoiceId:expected.invoiceId,subscriptionId:expected.subscriptionId});
 const invoice=value as Record<string,unknown>;
 const payment=invoice.payment;
 if(!payment||typeof payment!=='object'||Array.isArray(payment))throw new Error('Invoice without payment.');
 const p=payment as Record<string,unknown>;
 if(p.status!=='approved'||p.status_detail!=='accredited')throw new Error('Invoice payment not accredited.');
 if(invoice.currency_id!=='COP'||Number(invoice.transaction_amount)!==expected.amountCop)
  throw new Error('Invoice amount mismatch.');
 const paymentId=String(p.id??'');
 if(!/^[0-9]{1,30}$/.test(paymentId))throw new Error('Invalid invoice payment identifier.');
 return {paymentId,subscriptionId:expected.subscriptionId,amountCop:expected.amountCop};
}
