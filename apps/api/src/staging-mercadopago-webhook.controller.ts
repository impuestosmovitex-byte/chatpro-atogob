import {verifyMW1WebhookSignature} from './mw1-mp-webhook-signature';
import {auditBillingContract} from './mw1-billing-contract-audit';
import {assessMW1RenewalSafety} from './mw1-billing-renewal-safety';
import {evaluateMW1ActivationReadiness} from './mw1-billing-activation-readiness';
import {getMercadoPagoPaymentReadOnly,validateMW1Payment} from './mw1-mercadopago-payment-verification';
import {getMPSubscriptionInvoiceReadOnly,validateMPSubscriptionInvoice,extractAccreditedInvoicePayment} from './mw1-mercadopago-invoice-verification';
import {fetchProviderPreapprovalReadOnly,validateProviderPreapproval} from './mw1-mercadopago-reconciliation';
import {Controller,Headers,Post,Get,Query,ServiceUnavailableException,UnauthorizedException,ForbiddenException,Body} from '@nestjs/common';
import {SupabaseService} from './supabase.service';

/**
 * Staging-only receiver. Validates provider signature and explicitly does NOT
 * activate subscriptions, write financial records or execute charges.
 */
@Controller('staging-mercadopago')
export class StagingMercadoPagoWebhookController {
 constructor(private readonly supabase:SupabaseService){}
 @Get('integration-diagnostics')
 async integrationDiagnostics(
  @Headers('x-chatpro-inbox-key') key='',
  @Query('user') userId='',
 ){
  if(process.env.MW1_STAGING_MODE!=='true'||!process.env.CHATPRO_INBOX_KEY||key!==process.env.CHATPRO_INBOX_KEY)
   throw new UnauthorizedException();
  const db=this.supabase.getClient();
  const {data:admin}=await db.from('platform_admins').select('user_id')
   .eq('user_id',userId).eq('active',true).maybeSingle();
  if(!admin)throw new ForbiddenException('Solo superadministrador.');
  const [intents,events,subs,txs]=await Promise.all([
   db.from('mw1_checkout_intents').select('id',{count:'exact',head:true}),
   db.from('mw1_mp_webhook_inbox').select('id',{count:'exact',head:true}),
   db.from('mw1_billing_subscriptions').select('id',{count:'exact',head:true}),
   db.from('mw1_billing_transactions').select('id',{count:'exact',head:true})
  ]);
  if(intents.error||events.error||subs.error||txs.error)
   throw new ServiceUnavailableException('No fue posible consultar los diagnósticos.');
  return {ok:true,environment:'staging',checks:{
   tokenConfigured:!!process.env.MERCADOPAGO_ACCESS_TOKEN?.trim(),
   webhookSignatureSecretConfigured:!!process.env.MW1_MP_WEBHOOK_SECRET?.trim(),
   buyerAccountIdentified:/^[0-9]+$/.test(process.env.MW1_MP_TEST_BUYER_ID?.trim()??''),
   payerEmailVerified:!!process.env.MW1_MP_TEST_PAYER_EMAIL?.trim(),
   sandboxConfirmed:process.env.MW1_MP_SANDBOX_CREDENTIALS_CONFIRMED==='true',
   checkoutEnabled:process.env.MW1_MP_TEST_CHECKOUT_ENABLED==='true',
   recordingEnabled:process.env.MW1_MP_VERIFIED_RECORDING_ENABLED==='true',
   tenantActivationEnabled:process.env.MW1_MP_TENANT_ACTIVATION_ENABLED==='true'
  },counts:{checkoutIntents:intents.count??0,signedEvents:events.count??0,
   billingSubscriptions:subs.count??0,billingTransactions:txs.count??0},
   realChargesEnabled:false,diagnosticOnly:true};
 }

 @Get('contract-audit')
 async contractAudit(@Headers('x-chatpro-inbox-key') key='',@Query('user') userId=''){
  if(process.env.MW1_STAGING_MODE!=='true'||!process.env.CHATPRO_INBOX_KEY||key!==process.env.CHATPRO_INBOX_KEY)
   throw new UnauthorizedException();
  const db=this.supabase.getClient();
  const {data:admin}=await db.from('platform_admins').select('user_id').eq('user_id',userId).eq('active',true).maybeSingle();
  if(!admin)throw new ForbiddenException('Solo superadministrador.');
  const {data:plans,error}=await db.from('platform_published_plan_prices')
   .select('plan_key,price_cop').in('plan_key',['inicial','pro','empresa']);
  if(error)throw new ServiceUnavailableException('Tarifas no disponibles.');
  const audits=(plans??[]).map(plan=>auditBillingContract({
   planKey:plan.plan_key,baseAmountCop:plan.price_cop,
   verifiedPaidCycles:0,introductoryDiscountUsed:false,providerNextAmountCop:null,
   payerEmailConfigured:!!process.env.MW1_MP_TEST_PAYER_EMAIL?.trim(),
   buyerIdConfigured:/^[0-9]+$/.test(process.env.MW1_MP_TEST_BUYER_ID?.trim()??''),
   sandboxConfirmed:process.env.MW1_MP_SANDBOX_CREDENTIALS_CONFIRMED==='true',
   webhookSecretConfigured:!!process.env.MW1_MP_WEBHOOK_SECRET?.trim(),
   checkoutEnabled:process.env.MW1_MP_TEST_CHECKOUT_ENABLED==='true'
  }));
  return {ok:true,mode:'simulation_only',plans:audits,
   notes:'No se crea ninguna suscripción ni se consulta una tarjeta. Los importes son una simulación contractual.'};
 }

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
  if(event?.signature_verified&&event.provider_event_type==='subscription_authorized_payment'){
   const token=process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
   if(!token)throw new ServiceUnavailableException('Mercado Pago no configurado.');
   try{
    const invoice=await getMPSubscriptionInvoiceReadOnly(token,event.provider_data_id);
    if(!invoice||typeof invoice!=='object'||!('preapproval_id' in invoice))
     return {ok:false,reason:'invoice_has_no_subscription_reference',paymentConfirmed:false};
    const providerSubscriptionId=String((invoice as {preapproval_id:unknown}).preapproval_id??'');
    const {data:intent}=await db.from('mw1_checkout_intents')
     .select('id,provider_subscription_id,monthly_amount_cop').eq('provider_subscription_id',providerSubscriptionId).maybeSingle();
    if(!intent)return {ok:false,reason:'invoice_not_linked_to_mw1_checkout',paymentConfirmed:false};
    const checked=validateMPSubscriptionInvoice(invoice,{invoiceId:event.provider_data_id,subscriptionId:intent.provider_subscription_id});
    // A paid invoice still requires a separate provider payment GET.
    try{
     const expected=extractAccreditedInvoicePayment(invoice,{invoiceId:checked.invoiceId,
       subscriptionId:checked.subscriptionId,amountCop:intent.monthly_amount_cop});
     const payment=await getMercadoPagoPaymentReadOnly(token,expected.paymentId);
     if(!payment||typeof payment!=='object'||Array.isArray(payment))
       throw new Error('Payment missing.');
     const p=payment as Record<string,unknown>;
     if(String(p.id)!==expected.paymentId||p.status!=='approved'||p.status_detail!=='accredited'||
        p.currency_id!=='COP'||Number(p.transaction_amount)!==expected.amountCop)
       throw new Error('Payment verification did not match invoice.');
     return {ok:true,invoiceId:checked.invoiceId,subscriptionId:checked.subscriptionId,
       invoiceStatus:checked.status,paymentConfirmed:true,recordUpdated:false};
    }catch{
     return {ok:true,invoiceId:checked.invoiceId,subscriptionId:checked.subscriptionId,
      invoiceStatus:checked.status,paymentConfirmed:false,recordUpdated:false};
    }
   }catch{return {ok:false,reason:'invoice_reconciliation_failed',paymentConfirmed:false,recordUpdated:false};}
  }
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

 @Post('record-verified-invoice')
 async recordVerifiedInvoice(
  @Headers('x-chatpro-inbox-key') key='',
  @Body() input:unknown,
 ){
  // Explicit kill switch. No automatic charges, tenant activation or webhook-driven writes.
  if(process.env.MW1_STAGING_MODE!=='true'||process.env.MW1_MP_VERIFIED_RECORDING_ENABLED!=='true')
   throw new ForbiddenException('El registro financiero está deshabilitado.');
  if(!process.env.CHATPRO_INBOX_KEY||key!==process.env.CHATPRO_INBOX_KEY)
   throw new UnauthorizedException();
  if(!input||typeof input!=='object'||Array.isArray(input))throw new ForbiddenException('Solicitud inválida.');
  const params=input as Record<string,unknown>;
  const userId=String(params.userId??''),eventId=String(params.eventId??'');
  if(!/^[0-9a-f-]{36}$/i.test(eventId)||!/^[0-9a-f-]{36}$/i.test(userId))
   throw new ForbiddenException('Identificadores inválidos.');
  const db=this.supabase.getClient();
  const {data:admin,error:adminError}=await db.from('platform_admins').select('user_id').eq('user_id',userId).eq('active',true).maybeSingle();
  if(adminError||!admin)throw new ForbiddenException('Solo superadministrador.');
  const {data:event}=await db.from('mw1_mp_webhook_inbox').select('provider_data_id,provider_event_type,signature_verified')
    .eq('id',eventId).maybeSingle();
  if(!event?.signature_verified||event.provider_event_type!=='subscription_authorized_payment')
   throw new ForbiddenException('No es una factura con notificación firmada.');
  const token=process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
  if(!token)throw new ServiceUnavailableException('Mercado Pago no configurado.');
  const invoice=await getMPSubscriptionInvoiceReadOnly(token,event.provider_data_id);
  if(!invoice||typeof invoice!=='object'||Array.isArray(invoice))
   throw new ForbiddenException('Factura inválida.');
  const providerSubscriptionId=String((invoice as Record<string,unknown>).preapproval_id??'');
  const {data:intent}=await db.from('mw1_checkout_intents')
   .select('id,company_id,provider_subscription_id,monthly_amount_cop')
   .eq('provider_subscription_id',providerSubscriptionId).maybeSingle();
  if(!intent)throw new ForbiddenException('Contratación no encontrada.');
  const {data:subscription}=await db.from('mw1_billing_subscriptions')
   .select('id,company_id,provider_subscription_id,amount_cop')
   .eq('company_id',intent.company_id).eq('provider_subscription_id',providerSubscriptionId).maybeSingle();
  if(!subscription||subscription.company_id!==intent.company_id)
   throw new ForbiddenException('Suscripción no asociada a la empresa.');
  // First cycle only. Discounted renewals need an independently verified expected amount.
  if(subscription.amount_cop!==intent.monthly_amount_cop)
   throw new ForbiddenException('Importe contractual distinto del esperado.');
  const expected=extractAccreditedInvoicePayment(invoice,{invoiceId:event.provider_data_id,
   subscriptionId:providerSubscriptionId,amountCop:intent.monthly_amount_cop});
  const payment=await getMercadoPagoPaymentReadOnly(token,expected.paymentId);
  validateMW1Payment(payment,{paymentId:expected.paymentId,
   providerSubscriptionId,amountCop:intent.monthly_amount_cop});
  const paidAt=(payment&&typeof payment==='object'&&'date_approved' in payment)
    ?String((payment as {date_approved:unknown}).date_approved??''):'';
  if(!paidAt||!Number.isFinite(Date.parse(paidAt)))
   throw new ForbiddenException('El proveedor no confirmó la fecha de acreditación.');
  const {data,error}=await db.rpc('mw1_record_verified_payment_internal',{
   p_subscription_id:subscription.id,p_provider_payment_id:expected.paymentId,
   p_amount_cop:expected.amountCop,p_paid_at:new Date(paidAt).toISOString()
  });
  if(error)throw new ServiceUnavailableException('No fue posible registrar el pago verificado.');
  return {ok:true,result:data,providerPaymentId:expected.paymentId,
   paymentConfirmed:true,tenantActivated:false};
 }

 @Get('activation-readiness')
 async activationReadiness(
  @Headers('x-chatpro-inbox-key') key='',
  @Query('user') userId='',
  @Query('subscription') subscriptionId='',
 ){
  if(process.env.MW1_STAGING_MODE!=='true'||!process.env.CHATPRO_INBOX_KEY||key!==process.env.CHATPRO_INBOX_KEY)
   throw new UnauthorizedException();
  if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(userId)||!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(subscriptionId))
   throw new ForbiddenException('Identificadores inválidos.');
  const db=this.supabase.getClient();
  const {data:admin,error:adminError}=await db.from('platform_admins')
   .select('user_id').eq('user_id',userId).eq('active',true).maybeSingle();
  if(adminError||!admin)throw new ForbiddenException('Solo superadministrador.');
  const {data:sub,error:subError}=await db.from('mw1_billing_subscriptions')
   .select('id,company_id,provider_subscription_id,status,verified_paid_cycles,authorization_confirmed_at')
   .eq('id',subscriptionId).maybeSingle();
  if(subError||!sub)throw new ForbiddenException('Suscripción no encontrada.');
  const {count,error:countError}=await db.from('mw1_billing_transactions')
   .select('id',{count:'exact',head:true}).eq('subscription_id',subscriptionId).eq('company_id',sub.company_id).eq('status','approved');
  if(countError)throw new ServiceUnavailableException('No se pudieron comprobar las transacciones.');
  const readiness=evaluateMW1ActivationReadiness({
   subscriptionId:sub.id,companyId:sub.company_id,
   providerSubscriptionId:sub.provider_subscription_id,
   subscriptionStatus:sub.status,verifiedPaidCycles:sub.verified_paid_cycles,
   approvedPaymentCount:count??0,
   providerAuthorizationConfirmed:!!sub.authorization_confirmed_at
  });
  const {data:entitlement,error:entitlementError}=await db.from('company_entitlements')
   .select('plan_key').eq('company_id',sub.company_id).maybeSingle();
  if(entitlementError)throw new ServiceUnavailableException('No se pudieron leer permisos.');
  return {ok:true,subscriptionId:sub.id,eligible:readiness.eligible,
   reasons:readiness.reasons,verifiedPaidCycles:sub.verified_paid_cycles,
   approvedPayments:count??0,currentEntitlementPlan:entitlement?.plan_key??null,
   tenantActivated:false,changesApplied:false};
 }

 @Post('activate-verified-subscription')
 async activateVerifiedSubscription(
  @Headers('x-chatpro-inbox-key') key='',
  @Body() input:unknown,
 ){
  if(process.env.MW1_STAGING_MODE!=='true'||process.env.MW1_MP_TENANT_ACTIVATION_ENABLED!=='true')
   throw new ForbiddenException('Activación automática deshabilitada.');
  if(!process.env.CHATPRO_INBOX_KEY||key!==process.env.CHATPRO_INBOX_KEY)
   throw new UnauthorizedException();
  if(!input||typeof input!=='object'||Array.isArray(input))
   throw new ForbiddenException('Solicitud inválida.');
  const values=input as Record<string,unknown>;
  const userId=String(values.userId??''),subscriptionId=String(values.subscriptionId??'');
  if(!/^[0-9a-f-]{36}$/i.test(userId)||!/^[0-9a-f-]{36}$/i.test(subscriptionId))
   throw new ForbiddenException('Identificadores inválidos.');
  const db=this.supabase.getClient();
  const {data:admin}=await db.from('platform_admins').select('user_id')
   .eq('user_id',userId).eq('active',true).maybeSingle();
  if(!admin)throw new ForbiddenException('Solo superadministrador.');
  const {data:sub,error:subError}=await db.from('mw1_billing_subscriptions')
   .select('id,company_id,provider_subscription_id,plan_key,amount_cop,status,verified_paid_cycles,authorization_confirmed_at')
   .eq('id',subscriptionId).maybeSingle();
  if(subError||!sub||!sub.provider_subscription_id)
   throw new ForbiddenException('Suscripción inválida.');
  const {count,error:countError}=await db.from('mw1_billing_transactions')
   .select('id',{count:'exact',head:true}).eq('subscription_id',subscriptionId)
   .eq('company_id',sub.company_id).eq('status','approved');
  if(countError)throw new ServiceUnavailableException('No se pudo validar el historial de pagos.');
  const readiness=evaluateMW1ActivationReadiness({
   subscriptionId:sub.id,companyId:sub.company_id,
   providerSubscriptionId:sub.provider_subscription_id,
   subscriptionStatus:sub.status,verifiedPaidCycles:sub.verified_paid_cycles,
   approvedPaymentCount:count??0,
   providerAuthorizationConfirmed:!!sub.authorization_confirmed_at
  });
  if(!readiness.eligible)throw new ForbiddenException('Suscripción sin requisitos de activación.');
  const token=process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
  if(!token)throw new ServiceUnavailableException('Mercado Pago no configurado.');
  const {data:intent}=await db.from('mw1_checkout_intents')
   .select('id,company_id,provider_subscription_id,monthly_amount_cop')
   .eq('company_id',sub.company_id).eq('provider_subscription_id',sub.provider_subscription_id).maybeSingle();
  if(!intent||intent.monthly_amount_cop!==sub.amount_cop)
   throw new ForbiddenException('Contratación no coincide.');
  const remote=await fetchProviderPreapprovalReadOnly(token,sub.provider_subscription_id);
  const verified=validateProviderPreapproval(remote,{
   providerSubscriptionId:sub.provider_subscription_id,intentId:intent.id,monthlyAmountCop:intent.monthly_amount_cop
  });
  if(verified.status!=='authorized')throw new ForbiddenException('Mercado Pago aún no autorizó la suscripción.');
  const {data:result,error}=await db.rpc('mw1_activate_paid_subscription_internal',{p_subscription_id:subscriptionId});
  if(error)throw new ServiceUnavailableException('No fue posible activar el plan verificado.');
  return {ok:true,result,providerAuthorizationConfirmed:true};
 }

 @Get('renewal-safety')
 async renewalSafety(
  @Headers('x-chatpro-inbox-key') key='',
  @Query('user') userId='',
  @Query('subscription') subscriptionId='',
 ){
  if(process.env.MW1_STAGING_MODE!=='true'||!process.env.CHATPRO_INBOX_KEY||key!==process.env.CHATPRO_INBOX_KEY)
   throw new UnauthorizedException();
  if(!/^[0-9a-f-]{36}$/i.test(userId)||!/^[0-9a-f-]{36}$/i.test(subscriptionId))
   throw new ForbiddenException('Identificadores inválidos.');
  const db=this.supabase.getClient();
  const {data:admin}=await db.from('platform_admins').select('user_id').eq('user_id',userId).eq('active',true).maybeSingle();
  if(!admin)throw new ForbiddenException('Solo superadministrador.');
  const {data:sub,error}=await db.from('mw1_billing_subscriptions')
   .select('provider_subscription_id,base_monthly_amount_cop,amount_cop,verified_paid_cycles,introductory_discount_used')
   .eq('id',subscriptionId).maybeSingle();
  if(error||!sub?.provider_subscription_id)throw new ForbiddenException('Suscripción no encontrada.');
  const token=process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
  if(!token)throw new ServiceUnavailableException('Mercado Pago no configurado.');
  const remote=await fetchProviderPreapprovalReadOnly(token,sub.provider_subscription_id);
  if(!remote||typeof remote!=='object'||Array.isArray(remote))
   throw new ServiceUnavailableException('Respuesta del proveedor inválida.');
  const p=remote as Record<string,unknown>, recurring=p.auto_recurring;
  if(String(p.id??'')!==sub.provider_subscription_id||!recurring||typeof recurring!=='object'||Array.isArray(recurring))
   throw new ForbiddenException('La suscripción no coincide con Mercado Pago.');
  const amount=Number((recurring as Record<string,unknown>).transaction_amount);
  const result=assessMW1RenewalSafety({
   baseMonthlyAmountCop:sub.base_monthly_amount_cop??sub.amount_cop,
   verifiedPaidCycles:sub.verified_paid_cycles,
   introductoryDiscountUsed:sub.introductory_discount_used,
   providerAmountCop:amount,
   nextPaymentDate:typeof p.next_payment_date==='string'?p.next_payment_date:null
  });
  return {ok:true,...result,renewalWritesEnabled:false};
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
  if(!verifyMW1WebhookSignature({signature,requestId,dataId:String(queryDataId),secret}))
   throw new UnauthorizedException('Firma inválida o vencida.');
  const id=String(queryDataId).toLowerCase();
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
