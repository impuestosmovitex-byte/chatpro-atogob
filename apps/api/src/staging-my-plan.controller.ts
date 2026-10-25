import {buildMW1PreapprovalPayload,parseMW1PreapprovalResponse} from './mw1-mercadopago-preapproval';
import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, Post, Query, UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from './supabase.service';

@Controller('staging-my-plan')
export class StagingMyPlanController {
  constructor(private readonly supabase: SupabaseService) {}

  @Get('checkout-readiness')
  async checkoutReadiness(
    @Headers('x-chatpro-inbox-key') key = '',
    @Headers('x-chatpro-user-id') userId = '',
    @Headers('x-chatpro-company-id') companyId = '',
    @Query('company') slug = '',
  ) {
    if (process.env.MW1_STAGING_MODE !== 'true' ||
      !process.env.CHATPRO_INBOX_KEY || key !== process.env.CHATPRO_INBOX_KEY || !userId)
      throw new UnauthorizedException();
    const db=this.supabase.getClient();
    const {data:company}=await db.from('companies').select('id,status').eq('id',companyId).eq('slug',slug).maybeSingle();
    if (!company || company.status!=='active') throw new ForbiddenException();
    const {data:member}=await db.from('company_memberships').select('role_id').eq('company_id',company.id).eq('user_id',userId).eq('active',true).maybeSingle();
    if (!member) throw new ForbiddenException();
    const {data:role}=await db.from('app_roles').select('key,company_id').eq('id',member.role_id).maybeSingle();
    if (!role || role.key!=='owner' || (role.company_id && role.company_id!==company.id))
      throw new ForbiddenException('Solo el propietario puede contratar.');
    const {data:entitlement}=await db.from('company_entitlements').select('plan_key').eq('company_id',company.id).maybeSingle();
    const {data:published}=entitlement?.plan_key
      ?await db.from('platform_published_plan_prices').select('plan_key,price_cop').eq('plan_key',entitlement.plan_key).maybeSingle()
      :{data:null};
    const reasons:string[]=[];
    if (!published || !Number.isSafeInteger(published.price_cop) || published.price_cop<=0) reasons.push('Precio del plan pendiente de publicación.');
    if (!process.env.MERCADOPAGO_ACCESS_TOKEN?.trim()) reasons.push('Credencial de Mercado Pago no configurada.');
    if(process.env.MW1_MP_TEST_CHECKOUT_ENABLED!=='true') reasons.push('El checkout de prueba sigue bloqueado hasta validar el entorno y las notificaciones de pago.');
    reasons.push('La autorización y las notificaciones de pago requieren pruebas de extremo a extremo.');
    return {ok:true,provider:'mercadopago',planKey:entitlement?.plan_key??null,
      publishedMonthlyCop:published?.price_cop??null,
      firstMonthCop:published?.price_cop??null,
      secondMonthCop:published && Number.isSafeInteger(published.price_cop) ? Math.round(published.price_cop/2):null,
      thirdMonthCop:published?.price_cop??null,
      recurrence:'monthly',promotion:'second_month_50_percent_once',
      checkoutEnabled:false,reasons};
  }

  @Post('checkout-intent')
  async createCheckoutIntent(
    @Headers('x-chatpro-inbox-key') key = '',
    @Headers('x-chatpro-user-id') userId = '',
    @Headers('x-chatpro-company-id') companyId = '',
    @Query('company') slug = '',
  ) {
    if(process.env.MW1_STAGING_MODE!=='true'||!process.env.CHATPRO_INBOX_KEY||key!==process.env.CHATPRO_INBOX_KEY||!userId)
      throw new UnauthorizedException();
    const db=this.supabase.getClient();
    const {data:company}=await db.from('companies').select('id,status').eq('id',companyId).eq('slug',slug).maybeSingle();
    if(!company||company.status!=='active')throw new ForbiddenException();
    const {data:member}=await db.from('company_memberships').select('role_id').eq('company_id',company.id).eq('user_id',userId).eq('active',true).maybeSingle();
    if(!member)throw new ForbiddenException();
    const {data:role}=await db.from('app_roles').select('key,company_id').eq('id',member.role_id).maybeSingle();
    if(!role||role.key!=='owner'||(role.company_id&&role.company_id!==company.id))throw new ForbiddenException('Solo el propietario puede iniciar una contratación.');
    const {data:entitlement}=await db.from('company_entitlements').select('plan_key').eq('company_id',company.id).maybeSingle();
    if(!entitlement?.plan_key)throw new BadRequestException('La empresa no tiene un plan asignado.');
    const {data:published}=await db.from('platform_published_plan_prices').select('price_cop').eq('plan_key',entitlement.plan_key).maybeSingle();
    if(!published||!Number.isSafeInteger(published.price_cop)||published.price_cop<=0)
      throw new BadRequestException('El precio todavía no está publicado.');
    const {data:existing}=await db.from('mw1_checkout_intents').select('id,status,monthly_amount_cop,plan_key,expires_at').eq('company_id',company.id).in('status',['awaiting_checkout','provider_pending']).maybeSingle();
    if(existing){
      if(existing.status==='provider_pending')return {ok:true,intent:existing,checkoutEnabled:false,message:'Ya existe una autorización pendiente de verificar. No se creó otra.'};
      if(new Date(existing.expires_at).getTime()>Date.now()&&existing.plan_key===entitlement.plan_key&&existing.monthly_amount_cop===published.price_cop)
        return {ok:true,intent:existing,checkoutEnabled:false,message:'Tu solicitud de contratación está preparada. El pago aún no está habilitado.'};
      await db.from('mw1_checkout_intents').update({status:'expired'}).eq('id',existing.id).eq('status','awaiting_checkout');
    }
    const {data:intent,error}=await db.from('mw1_checkout_intents').insert({company_id:company.id,requested_by:userId,plan_key:entitlement.plan_key,monthly_amount_cop:published.price_cop}).select('id,status,monthly_amount_cop,plan_key,expires_at').single();
    if(error||!intent)throw new BadRequestException('No se pudo preparar la contratación. Vuelve a consultar el estado.');
    return {ok:true,intent,checkoutEnabled:false,message:'Solicitud preparada. Mercado Pago todavía no ha habilitado la autorización de tarjeta.'};
  }

  @Get('checkout-intent')
  async getCheckoutIntent(
    @Headers('x-chatpro-inbox-key') key='',
    @Headers('x-chatpro-user-id') userId='',
    @Headers('x-chatpro-company-id') companyId='',
    @Query('company') slug='',
  ){
    if(process.env.MW1_STAGING_MODE!=='true'||!process.env.CHATPRO_INBOX_KEY||key!==process.env.CHATPRO_INBOX_KEY||!userId)throw new UnauthorizedException();
    const db=this.supabase.getClient();
    const {data:company}=await db.from('companies').select('id,status').eq('id',companyId).eq('slug',slug).maybeSingle();
    if(!company||company.status!=='active')throw new ForbiddenException();
    const {data:member}=await db.from('company_memberships').select('role_id').eq('company_id',company.id).eq('user_id',userId).eq('active',true).maybeSingle();
    if(!member)throw new ForbiddenException();
    const {data:role}=await db.from('app_roles').select('key,company_id').eq('id',member.role_id).maybeSingle();
    if(!role||!['owner','admin'].includes(role.key)||(role.company_id&&role.company_id!==company.id))throw new ForbiddenException();
    const {data:intent,error}=await db.from('mw1_checkout_intents')
      .select('id,plan_key,monthly_amount_cop,currency,status,created_at,expires_at')
      .eq('company_id',company.id).order('created_at',{ascending:false}).limit(1).maybeSingle();
    if(error)throw new BadRequestException('No se pudo consultar la contratación.');
    return {ok:true,intent:intent??null,cardRegistrationEnabled:false,provider:'mercadopago'};
  }

  @Post('checkout-authorize')
  async authorizeCheckout(
    @Headers('x-chatpro-inbox-key') key='',
    @Headers('x-chatpro-user-id') userId='',
    @Headers('x-chatpro-company-id') companyId='',
    @Query('company') slug='',
    @Body() body:{payerEmail?:string},
  ){
    if(process.env.MW1_STAGING_MODE!=='true'||!process.env.CHATPRO_INBOX_KEY||key!==process.env.CHATPRO_INBOX_KEY||!userId)throw new UnauthorizedException();
    // An APP_USR prefix alone cannot establish sandbox safety.
    if(process.env.MW1_MP_TEST_CHECKOUT_ENABLED!=='true'||process.env.MW1_MP_SANDBOX_CREDENTIALS_CONFIRMED!=='true')
      throw new ForbiddenException('Autorización de prueba bloqueada hasta verificar credenciales y pagos.');
    const email=String(body?.payerEmail??'').trim().toLowerCase();
    if(!email||email!==String(process.env.MW1_MP_TEST_PAYER_EMAIL??'').trim().toLowerCase())
      throw new ForbiddenException('Solo se permite el comprador de prueba autorizado.');
    const token=process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
    if(!token)throw new ForbiddenException('Mercado Pago no está configurado.');
    const db=this.supabase.getClient();
    const {data:company}=await db.from('companies').select('id,status').eq('id',companyId).eq('slug',slug).maybeSingle();
    if(!company||company.status!=='active')throw new ForbiddenException();
    const {data:member}=await db.from('company_memberships').select('role_id').eq('company_id',company.id).eq('user_id',userId).eq('active',true).maybeSingle();
    if(!member)throw new ForbiddenException();
    const {data:role}=await db.from('app_roles').select('key,company_id').eq('id',member.role_id).maybeSingle();
    if(!role||role.key!=='owner'||(role.company_id&&role.company_id!==company.id))throw new ForbiddenException();
    const {data:intent}=await db.from('mw1_checkout_intents').select('id,status,plan_key,monthly_amount_cop,expires_at')
      .eq('company_id',company.id).eq('status','awaiting_checkout').maybeSingle();
    if(!intent||new Date(intent.expires_at).getTime()<=Date.now())throw new BadRequestException('Prepara nuevamente tu contratación.');
    const {data:price}=await db.from('platform_published_plan_prices').select('price_cop').eq('plan_key',intent.plan_key).maybeSingle();
    if(!price||price.price_cop!==intent.monthly_amount_cop)throw new BadRequestException('El precio cambió. Prepara nuevamente tu contratación.');
    const publicBase=process.env.MW1_STAGING_PUBLIC_URL?.trim();
    if(!publicBase||new URL(publicBase).protocol!=='https:')throw new ForbiddenException('URL pública de staging no configurada.');
    const payload=buildMW1PreapprovalPayload({intentId:intent.id,payerEmail:email,monthlyAmountCop:intent.monthly_amount_cop,
      planName:intent.plan_key,backUrl:new URL('/configuracion/mi-plan',publicBase).toString()});
    // Idempotency key protects against duplicate provider requests; never activate company from browser return.
    let response:Response;
    try{
      response=await fetch('https://api.mercadopago.com/preapproval',{method:'POST',headers:{
        Authorization:'Bearer '+token,'Content-Type':'application/json','X-Idempotency-Key':intent.id
      },body:JSON.stringify(payload),signal:AbortSignal.timeout(12000)});
    }catch{throw new BadRequestException('No se pudo contactar a Mercado Pago. Consulta el estado antes de reintentar.');}
    if(!response.ok)throw new BadRequestException('Mercado Pago no aceptó la solicitud de prueba.');
    let result:{providerSubscriptionId:string;authorizationUrl:string;paymentVerified:boolean};
    try{result=parseMW1PreapprovalResponse(await response.json());}
    catch{throw new BadRequestException('Respuesta no válida. No reintentes sin verificar la suscripción en Mercado Pago.');}
    const {error}=await db.from('mw1_checkout_intents').update({
      status:'provider_pending',provider_subscription_id:result.providerSubscriptionId
    }).eq('id',intent.id).eq('status','awaiting_checkout');
    if(error)throw new BadRequestException('La solicitud existe en Mercado Pago; consulta soporte antes de reintentar.');
    return {ok:true,authorizationUrl:result.authorizationUrl,subscriptionStatus:'pending',paymentVerified:false};
  }

  @Post('request')
  async requestChange(
    @Headers('x-chatpro-inbox-key') key = '',
    @Headers('x-chatpro-user-id') userId = '',
    @Headers('x-chatpro-company-id') companyId = '',
    @Query('company') slug = '',
    @Body() body: { type?: string; planKey?: string; additionalUsers?: number; note?: string },
  ) {
    if (!process.env.CHATPRO_INBOX_KEY || key !== process.env.CHATPRO_INBOX_KEY || !userId)
      throw new UnauthorizedException();
    const db=this.supabase.getClient();
    const {data:company}=await db.from('companies').select('id,status')
      .eq('id',companyId).eq('slug',slug).maybeSingle();
    if(!company || company.status!=='active') throw new ForbiddenException();
    const {data:member}=await db.from('company_memberships').select('role_id')
      .eq('company_id',company.id).eq('user_id',userId).eq('active',true).maybeSingle();
    if(!member) throw new ForbiddenException();
    const {data:role}=await db.from('app_roles').select('key,company_id')
      .eq('id',member.role_id).maybeSingle();
    if(!role || role.key!=='owner' || (role.company_id && role.company_id!==company.id))
      throw new ForbiddenException('Solo el propietario puede solicitar cambios de suscripción.');
    const type=body?.type;
    if(type!=='change_plan' && type!=='cancel_renewal' && type!=='extra_users') throw new BadRequestException('Solicitud no válida.');
    let planKey: string|null=null;
    if(type==='change_plan'){
      planKey=String(body?.planKey??'').trim().toLowerCase();
      if(!planKey) throw new BadRequestException('Selecciona un plan.');
      const {data:published}=await db.from('platform_published_plan_prices')
        .select('plan_key').eq('plan_key',planKey).maybeSingle();
      if(!published) throw new BadRequestException('El plan solicitado no está publicado.');
      const {data:existing}=await db.from('company_entitlements')
        .select('plan_key').eq('company_id',company.id).maybeSingle();
      if(existing?.plan_key===planKey) throw new BadRequestException('Ya tienes este plan asignado.');
    }
    const extraUsers=type==='extra_users' ? Number(body?.additionalUsers) : null;
    if(type==='extra_users' && (!Number.isInteger(extraUsers)||extraUsers!<1||extraUsers!>100))
      throw new BadRequestException('Indica una cantidad de usuarios adicionales entre 1 y 100.');
    const note=String(body?.note??'').trim().slice(0,500);
    const {data,error}=await db.from('mw1_subscription_requests')
      .insert({company_id:company.id,requested_by:userId,request_type:type,
        requested_plan_key:planKey,additional_users:extraUsers,note:note||null})
      .select('id,status').single();
    if(error){
      if(error.code==='23505') throw new BadRequestException('Ya tienes una solicitud pendiente.');
      throw new BadRequestException('No se pudo registrar la solicitud.');
    }
    return {ok:true,request:data,message:'Solicitud registrada para revisión. Tu plan sigue sin cambios.'};
  }

  @Get()
  async get(
    @Headers('x-chatpro-inbox-key') key = '',
    @Headers('x-chatpro-user-id') userId = '',
    @Headers('x-chatpro-company-id') companyId = '',
    @Query('company') slug = '',
  ) {
    if (!process.env.CHATPRO_INBOX_KEY || key !== process.env.CHATPRO_INBOX_KEY || !userId)
      throw new UnauthorizedException();
    const db = this.supabase.getClient();
    const {data:company} = await db.from('companies')
      .select('id,name,slug,status').eq('id',companyId).eq('slug',slug).maybeSingle();
    if (!company || company.status !== 'active') throw new ForbiddenException();
    const {data:membership} = await db.from('company_memberships')
      .select('role_id').eq('company_id',company.id).eq('user_id',userId)
      .eq('active',true).maybeSingle();
    if (!membership) throw new ForbiddenException();
    const {data:role} = await db.from('app_roles').select('key,company_id')
      .eq('id',membership.role_id).maybeSingle();
    if (!role || !['owner','admin'].includes(role.key) ||
        (role.company_id && role.company_id !== company.id)) throw new ForbiddenException();
    const {data:plan,error} = await db.from('company_entitlements')
      .select('plan_key,max_users,max_whatsapp_lines,ai_enabled,whatsapp_enabled,instagram_enabled,messenger_enabled,automations_enabled,statistics_enabled')
      .eq('company_id',company.id).maybeSingle();
    if (error || !plan) throw new ForbiddenException('Plan no disponible.');
    const {count,error:countError} = await db.from('company_memberships')
      .select('id',{head:true,count:'exact'}).eq('company_id',company.id).eq('active',true);
    if(countError) throw new ForbiddenException('No se pudo consultar el equipo.');
    const {data:billingSubscription} = await db.from('mw1_billing_subscriptions')
      .select('provider,billing_cycle,status,currency,amount_cop,next_billing_at,current_period_end,cancel_at_period_end')
      .eq('company_id',company.id).maybeSingle();
    const {data:billingTransactions} = await db.from('mw1_billing_transactions')
      .select('id,amount_cop,currency,status,due_at,paid_at,created_at')
      .eq('company_id',company.id).order('created_at',{ascending:false}).limit(12);
    const { data: publishedPlans } = await db.from('platform_published_plan_prices').select('plan_key,price_cop,max_users,max_whatsapp_lines,extra_user_cop,extra_connection_cop,public_summary,public_features').order('price_cop',{ascending:true});
    const { data: requests } = await db.from('mw1_subscription_requests')
      .select('id,request_type,requested_plan_key,additional_users,note,status,created_at')
      .eq('company_id',company.id).order('created_at',{ascending:false}).limit(10);
    return {ok:true,company:{name:company.name},plan,activeUsers:count??0,
      requests:requests??[],availablePlans:publishedPlans??[],subscription:billingSubscription??null,transactions:billingTransactions??[],billing:{status:'not_integrated',historyAvailable:Boolean(billingTransactions?.length),onlineCancellationAvailable:false,provider:'mercadopago',checkoutAvailable:false,conditions:['published_plan','test_credentials','verified_webhook','successful_end_to_end_test']}};
  }
}
