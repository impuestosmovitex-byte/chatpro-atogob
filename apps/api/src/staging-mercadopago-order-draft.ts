import {createHash} from 'node:crypto';

/** Mercado Pago Checkout Pro Orders API: offline request preparation only.
 * Never pass untrusted chat amounts or browser-provided merchant credentials.
 */
export type MerchantOrderInput=Readonly<{
 companyId:string;orderId:string;attemptId:string;
 currency:'COP';amountMinor:number;itemTitle:string;
}>;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function buildMerchantOrderDraft(input:MerchantOrderInput){
 if(!uuid.test(input.companyId)||!uuid.test(input.orderId)||!uuid.test(input.attemptId)||
    input.currency!=='COP'||!Number.isSafeInteger(input.amountMinor)||
    input.amountMinor<=0||input.amountMinor%100!==0||
    typeof input.itemTitle!=='string'||input.itemTitle.trim().length<2||
    input.itemTitle.length>180)throw new Error('Datos de orden inválidos.');
 // Checkout Pro Orders API limits external_reference to 64 characters:
 // hash the tenant/order/attempt tuple, never concatenate three UUIDs.
 const externalReference='mw1_'+createHash('sha256').update(
   [input.companyId,input.orderId,input.attemptId].join(':')).digest('hex').slice(0,50);
 return {
  idempotencyKey:input.attemptId,
  body:{
    type:'online' as const,
    processing_mode:'manual' as const,
    total_amount:(input.amountMinor/100).toFixed(2),
    external_reference:externalReference,
    description:input.itemTitle.trim(),
    items:[{
      title:input.itemTitle.trim(),
      quantity:1,
      unit_price:(input.amountMinor/100).toFixed(2),
    }],
  },
 };
}
