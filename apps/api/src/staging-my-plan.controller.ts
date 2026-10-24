import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, Post, Query, UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from './supabase.service';

@Controller('staging-my-plan')
export class StagingMyPlanController {
  constructor(private readonly supabase: SupabaseService) {}

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
