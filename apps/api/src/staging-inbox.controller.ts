import { Controller, ForbiddenException, Get, Headers, Query, UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from './supabase.service';

@Controller('inbox')
export class StagingInboxController {
  constructor(private readonly db: SupabaseService) {}

  @Get()
  async list(
    @Headers('x-chatpro-inbox-key') key = '',
    @Headers('x-chatpro-user-id') userId = '',
    @Headers('x-chatpro-company-id') companyId = '',
    @Query('company') slug = '',
  ) {
    const expected = process.env.CHATPRO_INBOX_KEY?.trim();
    if (!expected || key !== expected || !userId || !companyId || !slug)
      throw new UnauthorizedException('Sesión requerida.');
    const client = this.db.getClient();
    const { data: company } = await client.from('companies')
      .select('id,slug,name,status').eq('id', companyId).eq('slug',slug).maybeSingle();
    if (!company || company.status !== 'active')
      throw new ForbiddenException('Empresa no autorizada.');
    const { data: membership } = await client.from('company_memberships')
      .select('id').eq('company_id',company.id).eq('user_id',userId)
      .eq('active',true).maybeSingle();
    const { data: profile } = await client.from('app_profiles')
      .select('active').eq('user_id',userId).maybeSingle();
    if (!membership || !profile?.active)
      throw new ForbiddenException('Acceso no autorizado.');
    const { data, error } = await client.from('conversation_sessions')
      .select('id,company_id,customer_phone,stage,context,last_message_at,pending_count,pending_since,attention_status,assigned_to_user_id,assigned_to_name,taken_at,closed_at')
      .eq('company_id',company.id).order('last_message_at',{ascending:false}).limit(20);
    if (error) throw new ForbiddenException('No se pudo consultar la bandeja.');
    return { ok:true, sessions:(data ?? []).map(s => ({
      id:s.id,companyId:s.company_id,customerPhone:s.customer_phone,stage:s.stage,
      context:s.context ?? {},lastMessageAt:s.last_message_at,
      pendingCount:s.pending_count ?? 0,pendingSince:s.pending_since,
      attentionStatus:s.attention_status,assignedToUserId:s.assigned_to_user_id,
      assignedToName:s.assigned_to_name,takenAt:s.taken_at,closedAt:s.closed_at,
      lastMessage:null,contact:null,
    })),pendingTotal:0,hasMore:false,stagingReadOnly:true };
  }
}
