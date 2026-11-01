import {Controller,ForbiddenException,Headers,HttpCode,Post,Query,Body} from '@nestjs/common';
import {verifyMercadoPagoWebhookSignature} from './staging-mercadopago-webhook-signature';
import {merchantNotificationFingerprint} from './staging-merchant-notification-reconciliation';
import {SupabaseService} from './supabase.service';
import {StagingMerchantPaymentTenantResolver} from './staging-merchant-payment-tenant-resolver.service';
import {StagingMerchantPaymentReconciliationService} from './staging-merchant-payment-reconciliation.service';
import {ServiceUnavailableException} from '@nestjs/common';

/** Merchant order notices MUST NOT share MW1 SaaS subscription reconciliation.
 * This quarantine endpoint does not store PII or mutate any order or payment.
 */
@Controller('webhook/merchant-mercadopago-staging')
export class StagingMerchantMercadoPagoWebhookController {
 constructor(private readonly supabase:SupabaseService,private readonly tenantResolver:StagingMerchantPaymentTenantResolver,private readonly reconciliation:StagingMerchantPaymentReconciliationService){}
 @Post()
 @HttpCode(202)
 async receive(
  @Headers('x-signature') signature='',
  @Headers('x-request-id') requestId='',
  @Query('data.id') dataId='',
  @Body() body:unknown,
 ){
  if(process.env.MW1_STAGING_MODE!=='true'||
     process.env.MW1_MERCHANT_MP_WEBHOOK_ENABLED!=='true')
    throw new ForbiddenException('Webhook comercial de pruebas deshabilitado.');
  const secret=process.env.MW1_MERCHANT_MP_WEBHOOK_SECRET||'';
  if(!verifyMercadoPagoWebhookSignature({
    signatureHeader:signature,requestId,dataId,secret,
  }))throw new ForbiddenException('Firma de webhook inválida.');
  // Validate event identity without trusting webhook fields as payment evidence.
  // An authenticated notification about subscriptions belongs to a separate
  // endpoint and must never enter the merchant commerce workflow.
  const type=(body&&typeof body==='object'&&!Array.isArray(body)&&
    'type' in body)?String((body as {type:unknown}).type):'';
  if(type!=='payment')return {accepted:false,ignored:true,processed:false,paymentConfirmed:false};
  // Reject mismatched identifiers rather than trusting either query or body.
  const eventData=(body&&typeof body==='object'&&!Array.isArray(body)&&
    'data' in body)?(body as {data:unknown}).data:null;
  const eventId=(eventData&&typeof eventData==='object'&&!Array.isArray(eventData)&&
    'id' in eventData)?String((eventData as {id:unknown}).id):'';
  if(eventId!==dataId)throw new ForbiddenException('Referencia de pago inconsistente.');
  const fingerprint=merchantNotificationFingerprint({requestId,paymentId:dataId,eventType:type});
  const {error}=await this.supabase.getClient().from('mw1_merchant_mp_webhook_inbox').upsert({
    request_id:requestId,provider_payment_id:dataId,event_fingerprint:fingerprint,
    status:'pending_tenant_resolution'
  },{onConflict:'request_id',ignoreDuplicates:true});
  if(error)throw new ServiceUnavailableException('No se pudo registrar la notificación comercial.');
  // A reused provider request ID must refer to exactly the same event.
  // The unique index also protects concurrent inserts; read after upsert
  // to detect a conflicting notification that was ignored by idempotency.
  const {data:record,error:readError}=await this.supabase.getClient()
    .from('mw1_merchant_mp_webhook_inbox')
    .select('provider_payment_id,event_fingerprint')
    .eq('request_id',requestId).maybeSingle();
  if(readError||!record)throw new ServiceUnavailableException('No se pudo verificar el registro.');
  if(record.provider_payment_id!==dataId||record.event_fingerprint!==fingerprint)
    throw new ForbiddenException('Identificador de notificación reutilizado con otro pago.');
  // Resolve only previously provider-bound attempts. Unknown payments remain
  // in quarantine and cannot trigger a provider lookup with another tenant's key.
  const boundAttempt=await this.tenantResolver.findBoundMerchantAttempt(dataId);
  if(!boundAttempt)return {accepted:true,recorded:true,tenantResolved:false,processed:false,paymentConfirmed:false};
  // Review the payment using credentials belonging only to this resolved merchant.
  // This method never writes paid states. Failures remain in quarantine.
  let verified=false;
  try {
    const result=await this.reconciliation.review(
      boundAttempt.companyId,boundAttempt.orderId,boundAttempt.attemptId,dataId,
    );
    verified=result.verified===true;
  } catch {
    // Never leak provider tokens or error details to webhook callers.
  }
  // Store only a read-only review outcome. No paid-state mutation.
  // Scope the update to the exact immutable inbox event and its payment ID.
  const reviewOutcome=verified?'verified_readonly':'needs_review';
  const {error:reviewError,data:writtenReview}=await this.supabase.getClient()
    .from('mw1_merchant_mp_webhook_inbox')
    .update({
      company_id:boundAttempt.companyId,
      order_id:boundAttempt.orderId,
      attempt_id:boundAttempt.attemptId,
      status:'needs_review',
      review_outcome:reviewOutcome,
      reviewed_at:new Date().toISOString(),
    })
    .eq('request_id',requestId)
    .eq('provider_payment_id',dataId)
    .eq('event_fingerprint',fingerprint)
    .is('reviewed_at',null)
    .select('id').maybeSingle();
  if(reviewError)throw new ServiceUnavailableException('No se pudo registrar la revisión comercial.');
  // Duplicate deliveries must not rewrite completed reviews. The database
  // compare-and-set condition above prevents concurrent overwrite.

  return {accepted:true,recorded:true,tenantResolved:true,
    reviewRecorded:!!writtenReview,verified:!!writtenReview&&verified,
    processed:false,paymentConfirmed:false};
 }
}
