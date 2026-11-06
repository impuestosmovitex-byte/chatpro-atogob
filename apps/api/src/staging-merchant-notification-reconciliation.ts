import {createHash} from 'node:crypto';

/** A merchant notification is only a trigger for reconciliation.
 * This validation is deliberately side-effect free.
 */
export function merchantNotificationFingerprint(input:{
  requestId:string;paymentId:string;eventType:string;
}):string{
  if(typeof input.requestId!=='string'||input.requestId.length<1||input.requestId.length>200||
    !/^[0-9]{1,40}$/.test(input.paymentId)||
    !['payment'].includes(input.eventType))throw new Error('Notificación comercial inválida.');
  return createHash('sha256').update(JSON.stringify([
    'mercado_pago',input.requestId,input.paymentId,input.eventType,
  ])).digest('hex');
}

/** No payment confirmation without an authenticated provider GET and an
 * independently selected tenant-owned order and merchant connection.
 */
export function shouldReconcileMerchantNotification(input:{
  signatureVerified:boolean;
  eventType:string;
  providerPaymentFetched:boolean;
  tenantResolvedFromTrustedRecords:boolean;
  merchantMatchesTenant:boolean;
  orderAndAttemptMatch:boolean;
  paymentEvidenceValid:boolean;
}):boolean{
  return input.signatureVerified===true&&input.eventType==='payment'&&
    input.providerPaymentFetched===true&&
    input.tenantResolvedFromTrustedRecords===true&&
    input.merchantMatchesTenant===true&&input.orderAndAttemptMatch===true&&
    input.paymentEvidenceValid===true;
}
