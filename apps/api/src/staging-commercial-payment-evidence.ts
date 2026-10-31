import {buildMerchantOrderDraft} from './staging-mercadopago-order-draft';
import {assessMerchantMercadoPagoPayment} from './staging-merchant-mercadopago-payment';

/** Reconciles the provider response against trusted DB order, attempt and
 * merchant account. This is a pure guard: it NEVER marks an order paid.
 */
export function assessCommercialPaymentEvidence(input:{
 companyId:string;orderId:string;attemptId:string;
 attemptCompanyId:string;attemptOrderId:string;
 orderCompanyId:string;orderCurrency:string;orderAmount:number;
 attemptCurrency:string;attemptAmount:number;
 merchantId:string;providerPaymentId:string;
 providerPayment:Record<string,unknown>;
}):boolean{
 const x=input;
 if(x.companyId!==x.attemptCompanyId||x.companyId!==x.orderCompanyId||
    x.orderId!==x.attemptOrderId||x.orderCurrency!==x.attemptCurrency||
    x.orderAmount!==x.attemptAmount||!Number.isSafeInteger(x.orderAmount*100)||
    x.orderAmount<=0||x.orderCurrency!=='COP')return false;
 try{
  const draft=buildMerchantOrderDraft({
   companyId:x.companyId,orderId:x.orderId,attemptId:x.attemptId,
   currency:'COP',amountMinor:Math.round(x.orderAmount*100),itemTitle:'Pedido MW1 de prueba',
  });
  return assessMerchantMercadoPagoPayment({
   payment:x.providerPayment,paymentId:x.providerPaymentId,
   expectedExternalReference:draft.body.external_reference,
   expectedMerchantId:x.merchantId,expectedAmount:x.orderAmount,
   expectedCurrency:x.orderCurrency,
  });
 }catch{return false;}
}
