import {fetchProviderPreapprovalReadOnly,validateProviderPreapproval} from './mw1-mercadopago-reconciliation';
import {Controller,Headers,Post,Get,Query,ServiceUnavailableException,UnauthorizedException,ForbiddenException,Body} from '@nestjs/common';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {SupabaseService} from './supabase.service';

/**
 * Staging-only receiver. Validates provider signature and explicitly does NOT
 * activate subscriptions, write financial records or execute charges.
 */
@Controller('staging-mercadopago')
export class StagingMercadoPagoWebhookController {
 constructor(private readonly supabase:SupabaseService){}
 @Get('reconciliation-preview')
 async reconciliationPreview(
  @Headers('x-chatpro-inbox-key') key='',
  @Query('user') userId='',
 ){
  if(process.env.MW1_STAGING_MODE!=='true'||!process.env.CHATPRO_INBOX_KEY||key!==process.env.CHATPRO_INBOX_KEY||!userId)
   throw new UnauthorizedException();
  const db=this.supabase.getClient();
  const {data:admin}=await db.from('platform_admins').select('user_id').eq('user_id',userId).eq('active',true).maybeSingle();
  if(!admin)throw new ForbiddenException('Solo superadministrador.');
  const {data:events,error}=await db.from('mw1_mp_webhook_inbox')
   .select('id,provider_data_id,provider_event_type,reconciliation_status,received_at')
   .order('received_at',{ascending:false}).limit(30);
  if(error)throw new ServiceUnavailableException('No se pudo consultar la cola.');
  // Does not call provider or modify the database. Unknown provider IDs from
  // simulated webhooks are not treated as financial facts.
  return {ok:true,events:events??[],automaticReconciliation:false,
    paymentActivationEnabled:false,mode:'read_only'};
 }

 @Get('reconciliation-check')
 async reconciliationCheck(
  @Headers('x-chatpro-inbox-key') key='',
  @Query('user') userId='',
  @Query('event') eventId='',
 ){
  if(process.env.MW1_STAGING_MODE!=='true'||!process.env.CHATPRO_INBOX_KEY||key!==process.env.CHATPRO_INBOX_KEY||!userId)
   throw new UnauthorizedException();
  const db=this.supabase.getClient();
  const {data:admin}=await db.from('platform_admins').select('user_id').eq('user_id',userId).eq('active',true).maybeSingle();
  if(!admin)throw new ForbiddenException('Solo superadministrador.');
  if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(eventId))throw new ForbiddenException('Evento inválido.');
  const {data:event}=await db.from('mw1_mp_webhook_inbox').select('provider_data_id,provider_event_type,signature_verified').eq('id',eventId).maybeSingle();
  if(!event?.signature_verified||event.provider_event_type!=='subscription_preapproval')
   return {ok:false,reason:'not_supported_for_read_only_subscription_check',paymentConfirmed:false};
  const {data:intent}=await db.from('mw1_checkout_intents').select('id,provider_subscription_id,monthly_amount_cop')
    .eq('provider_subscription_id',event.provider_data_id).maybeSingle();
  if(!intent?.provider_subscription_id)
   return {ok:false,reason:'no_matching_checkout_intent',paymentConfirmed:false};
  const token=process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
  if(!token)throw new ServiceUnavailableException('Mercado Pago no configurado.');
  try{
   const remote=await fetchProviderPreapprovalReadOnly(token,intent.provider_subscription_id);
   const verified=validateProviderPreapproval(remote,{providerSubscriptionId:intent.provider_subscription_id,
     intentId:intent.id,monthlyAmountCop:intent.monthly_amount_cop});
   return {ok:true,providerSubscriptionId:verified.providerSubscriptionId,status:verified.status,
    amountCop:verified.amountCop,paymentConfirmed:false,recordUpdated:false};
  }catch{
   return {ok:false,reason:'provider_reconciliation_failed',paymentConfirmed:false,recordUpdated:false};
  }
 }

 @Post('webhook')
 async receive(
  @Headers('x-signature') signature='',
  @Headers('x-request-id') requestId='',
  @Query('data.id') queryDataId='',
  @Body() body:unknown,
 ){
  if(process.env.MW1_STAGING_MODE!=='true')throw new UnauthorizedException();
  const secret=process.env.MW1_MP_WEBHOOK_SECRET?.trim();
  if(!secret)throw new ServiceUnavailableException('Webhook de pruebas no configurado.');
  const entries=Object.fromEntries(signature.split(',').map(p=>p.trim().split('=',2)));
  const ts=entries.ts||'',v1=entries.v1||'';
  if(!/^\d{10,13}$/.test(ts)||! /^[a-f0-9]{64}$/i.test(v1)||!requestId||!queryDataId)
    throw new UnauthorizedException('Firma incompleta.');
  const timestampMs=ts.length===10?Number(ts)*1000:Number(ts);
  if(!Number.isFinite(timestampMs)||Math.abs(Date.now()-timestampMs)>5*60*1000)
    throw new UnauthorizedException('Firma vencida.');
  // Mercado Pago webhook signature manifest. Use the URL data.id, not the untrusted body id.
  const id=String(queryDataId).toLowerCase();
  const manifest=`id:${id};request-id:${requestId};ts:${ts};`;
  const digest=createHmac('sha256',secret).update(manifest).digest();
  const supplied=Buffer.from(v1,'hex');
  if(supplied.length!==digest.length||!timingSafeEqual(supplied,digest))
    throw new UnauthorizedException('Firma inválida.');
  const type=(body&&typeof body==='object'&&'type' in body)?String((body as {type:unknown}).type):'';
  if(!['subscription_preapproval','subscription_authorized_payment','payment'].includes(type))
    return {ok:true,ignored:true};
  // Deliberately no database mutation until provider GET reconciliation and
  // duplicate-payment idempotency have been implemented and verified.
  const db=this.supabase.getClient();
  const {error}=await db.from('mw1_mp_webhook_inbox').upsert({
    provider_request_id:requestId,provider_data_id:id,provider_event_type:type,
    signature_verified:true,reconciliation_status:'pending'
  },{onConflict:'provider_request_id',ignoreDuplicates:true});
  if(error)throw new ServiceUnavailableException('No se pudo registrar el evento validado.');
  return {ok:true,received:true,signatureVerified:true,paymentConfirmed:false,processed:false};
 }
}
