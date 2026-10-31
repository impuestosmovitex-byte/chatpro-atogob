import {Injectable} from '@nestjs/common';
import {SupabaseService} from './supabase.service';
import {StagingMerchantPaymentCredentialsService} from './staging-merchant-payment-credentials.service';
import {fetchMerchantMercadoPagoPayment} from './staging-merchant-mercadopago-payment';
import {assessCommercialPaymentEvidence} from './staging-commercial-payment-evidence';

/** Read-only merchant reconciliation: all database rows must match the
 * authenticated tenant and provider account. Never changes paid status.
 */
@Injectable()
export class StagingMerchantPaymentReconciliationService{
 constructor(
  private readonly db:SupabaseService,
  private readonly credentials:StagingMerchantPaymentCredentialsService,
 ){}
 async review(companyId:string,orderId:string,attemptId:string,providerPaymentId:string){
  if(process.env.MW1_STAGING_MODE!=='true'||process.env.MW1_MP_SANDBOX_ORDERS_ENABLED!=='true')
   throw new Error('Conciliación comercial deshabilitada.');
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if(![companyId,orderId,attemptId].every(id=>uuid.test(id))||
    !/^[0-9]{1,40}$/.test(providerPaymentId))throw new Error('Identificadores inválidos.');
  const database=this.db.getClient();
  const [orderResult,attemptResult]=await Promise.all([
   database.from('commerce_orders').select('id,company_id,currency,grand_total')
    .eq('company_id',companyId).eq('id',orderId).maybeSingle(),
   database.from('commerce_payments').select('id,company_id,order_id,provider,currency,amount,status')
    .eq('company_id',companyId).eq('order_id',orderId).eq('id',attemptId).maybeSingle(),
  ]);
  if(orderResult.error||attemptResult.error||!orderResult.data||!attemptResult.data||
    attemptResult.data.provider!=='mercado_pago')throw new Error('Pedido o intento no encontrado.');
  const merchant=await this.credentials.resolveMercadoPago(companyId);
  const payment=await fetchMerchantMercadoPagoPayment(providerPaymentId,merchant.accessToken);
  const verified=assessCommercialPaymentEvidence({
   companyId,orderId,attemptId,
   attemptCompanyId:attemptResult.data.company_id,
   attemptOrderId:attemptResult.data.order_id,
   orderCompanyId:orderResult.data.company_id,
   orderCurrency:orderResult.data.currency,
   orderAmount:Number(orderResult.data.grand_total),
   attemptCurrency:attemptResult.data.currency,
   attemptAmount:Number(attemptResult.data.amount),
   merchantId:merchant.merchantId,providerPaymentId,providerPayment:payment,
  });
  return {verified,processed:false,orderMarkedPaid:false};
 }
}
