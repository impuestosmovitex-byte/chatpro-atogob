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
    @Body() body: { type?: string; planKey?: string; note?: string },
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
    if(type!=='change_plan' && type!=='cancel_renewal') throw new BadRequestException('Solicitud no válida.');
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
    const note=String(body?.note??'').trim().slice(0,500);
    const {data,error}=await db.from('mw1_subscription_requests')
      .insert({company_id:company.id,requested_by:userId,request_type:type,
        requested_plan_key:planKey,note:note||null})
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
    const { data: requests } = await db.from('mw1_subscription_requests')
      .select('id,request_type,requested_plan_key,note,status,created_at')
      .eq('company_id',company.id).order('created_at',{ascending:false}).limit(10);
    return {ok:true,company:{name:company.name},plan,activeUsers:count??0,
      requests:requests??[],billing:{status:'not_integrated',historyAvailable:false,onlineCancellationAvailable:false}};
  }
}
