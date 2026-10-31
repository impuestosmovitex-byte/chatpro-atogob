import {Controller,ForbiddenException,Headers,HttpCode,Post,Query,Body} from '@nestjs/common';
import {verifyMercadoPagoWebhookSignature} from './staging-mercadopago-webhook-signature';
import {merchantNotificationFingerprint} from './staging-merchant-notification-reconciliation';

/** Merchant order notices MUST NOT share MW1 SaaS subscription reconciliation.
 * This quarantine endpoint does not store PII or mutate any order or payment.
 */
@Controller('webhook/merchant-mercadopago-staging')
export class StagingMerchantMercadoPagoWebhookController {
 @Post()
 @HttpCode(202)
 receive(
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
  merchantNotificationFingerprint({requestId,paymentId:dataId,eventType:type});
  // A valid HMAC is not proof of payment nor merchant ownership.
  // Next phase: server-side provider GET + tenant routing + idempotent
  // reconciliation. Never update commerce_orders.payment_status here.
  return {accepted:true,processed:false,paymentConfirmed:false};
 }
}
