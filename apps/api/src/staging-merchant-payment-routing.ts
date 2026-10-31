import {createHash} from 'node:crypto';
import {buildMerchantOrderDraft} from './staging-mercadopago-order-draft';

/** Deterministic tenant-safe routing key for a provider payment reference.
 * The provider response is NOT trusted until fetched with the merchant's own
 * token and reconciled against DB order and attempt records.
 */
export function merchantExternalReference(input:{
 companyId:string;orderId:string;attemptId:string;
}):string{
 return buildMerchantOrderDraft({...input,currency:'COP',
  amountMinor:100,itemTitle:'Pedido MW1 de prueba'}).body.external_reference;
}

export function matchesMerchantPaymentReference(input:{
 companyId:string;orderId:string;attemptId:string;
 providerExternalReference:unknown;
}):boolean{
 if(typeof input.providerExternalReference!=='string')return false;
 try{
  const expected=merchantExternalReference(input);
  return expected===input.providerExternalReference;
 }catch{return false;}
}

/** A webhook payment ID MUST NOT be used as the tenant identifier.
 * Only return candidates after a scoped lookup against existing attempts.
 */
export function validatedProviderPaymentId(value:unknown):string|null{
 if(typeof value!=='string'||!/^[0-9]{1,40}$/.test(value))return null;
 return value;
}
