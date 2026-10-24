import { Controller, ForbiddenException, Get, Headers, Query, UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from './supabase.service';

@Controller('staging-my-plan')
export class StagingMyPlanController {
  constructor(private readonly supabase: SupabaseService) {}

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
    return {ok:true,company:{name:company.name},plan,activeUsers:count??0,
      billing:{status:'not_integrated',historyAvailable:false,onlineCancellationAvailable:false}};
  }
}
