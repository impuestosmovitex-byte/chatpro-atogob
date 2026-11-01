import {Injectable} from '@nestjs/common';
import {SupabaseService} from './supabase.service';
import {StagingMerchantPaymentCredentialsService} from './staging-merchant-payment-credentials.service';
import {fetchMerchantMercadoPagoPayment} from './staging-merchant-mercadopago-payment';
import {assessCommercialPaymentEvidence} from './staging-commercial-payment-evidence';

/** Bind an independently verified provider payment to a single existing
 * merchant attempt. Never changes payment status or order state.
 */
@Injectable()
export class StagingMerchantPaymentBindingService {
 constructor(private readonly db:SupabaseService,
  private readonly credentials:StagingMerchantPaymentCredentialsService){}
 async bind(companyId:string,orderId:string,attemptId:string,paymentId:string){
  if(process.env.MW1_STAGING_MODE!=='true'||
     process.env.MW1_MP_SANDBOX_ORDERS_ENABLED!=='true'||
     process.env.MW1_MERCHANT_PAYMENT_BINDING_ENABLED!=='true')
    throw new Error('Vinculación de pagos de prueba deshabilitada.');
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if(![companyId,orderId,attemptId].every(x=>uuid.test(x))||
     !/^[0-9]{1,40}$/.test(paymentId))throw new Error('Referencias inválidas.');
  const db=this.db.getClient();
  const [orders,attempts]=await Promise.all([
   db.from('commerce_orders').select('id,company_id,currency,grand_total,status,payment_status')
    .eq('company_id',companyId).eq('id',orderId).maybeSingle(),
   db.from('commerce_payments').select('id,company_id,order_id,provider,status,provider_payment_id,currency,amount')
    .eq('company_id',companyId).eq('order_id',orderId).eq('id',attemptId).maybeSingle(),
  ]);
  const order=orders.data,attempt=attempts.data;
  if(orders.error||attempts.error||!order||!attempt||
     attempt.provider!=='mercado_pago'||!['created','pending'].includes(attempt.status)||
     !['pending_confirmation','confirmed'].includes(order.status)||
     ['paid','refunded'].includes(order.payment_status)||
     (attempt.provider_payment_id&&attempt.provider_payment_id!==paymentId))
    throw new Error('Pedido o intento no elegible.');
  const merchant=await this.credentials.resolveMercadoPago(companyId);
  const payment=await fetchMerchantMercadoPagoPayment(paymentId,merchant.accessToken);
  const verified=assessCommercialPaymentEvidence({
   companyId,orderId,attemptId,
   attemptCompanyId:attempt.company_id,attemptOrderId:attempt.order_id,
   orderCompanyId:order.company_id,orderCurrency:order.currency,
   orderAmount:Number(order.grand_total),attemptCurrency:attempt.currency,
   attemptAmount:Number(attempt.amount),merchantId:merchant.merchantId,
   providerPaymentId:paymentId,providerPayment:payment,
  });
  if(!verified)throw new Error('El proveedor no verificó el pago para este comercio y pedido.');
  // Conditional update avoids overwriting a concurrent different binding.
  const {data:updated,error}=await db.from('commerce_payments')
   .update({provider_payment_id:paymentId})
   .eq('company_id',companyId).eq('order_id',orderId).eq('id',attemptId)
   .is('provider_payment_id',null).select('id').maybeSingle();
  if(error)throw new Error('No se pudo vincular el pago de forma segura.');
  if(!updated){
   const {data:existing}=await db.from('commerce_payments')
    .select('provider_payment_id').eq('company_id',companyId)
    .eq('order_id',orderId).eq('id',attemptId).maybeSingle();
   if(existing?.provider_payment_id!==paymentId)throw new Error('Intento vinculado a otro pago.');
  }
  return {bound:true,verified:true,orderMarkedPaid:false};
 }
}
