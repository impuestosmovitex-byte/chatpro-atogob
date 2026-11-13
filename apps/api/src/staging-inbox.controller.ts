import { Controller, ForbiddenException, Get, Headers, Query, UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from './supabase.service';
import { verifyInternalAttestation } from './internal-attestation';

@Controller('inbox')
export class StagingInboxController {
  constructor(private readonly db: SupabaseService) {}

  /**
   * Read-only message receipt diagnostics for isolated Instagram pilot.
   * Nothing from other tenants is visible and no send action exists here.
   */
  @Get('instagram-pilot')
  async instagramPilot(
    @Headers('x-chatpro-inbox-key') key = '',
    @Headers('x-chatpro-user-id') userId = '',
    @Headers('x-chatpro-company-id') companyId = '',
    @Query('company') slug = '',
    @Headers('x-mw1-internal-assertion') identityAssertion = '',
  ) {
    await this.authorizeRead(key,userId,companyId,slug,identityAssertion,'/inbox/instagram-pilot');
    const expected = process.env.CHATPRO_INBOX_KEY?.trim();
    if (!expected || key !== expected || !userId || !companyId ||
      slug !== 'piloto-mw1-prueba') {
      throw new UnauthorizedException('Acceso de piloto requerido.');
    }
    const db = this.db.getClient();
    const { data: tenant } = await db.from('companies')
      .select('id,slug,status').eq('id',companyId)
      .eq('slug','piloto-mw1-prueba').maybeSingle();
    const { data: member } = await db.from('company_memberships')
      .select('id').eq('company_id',companyId).eq('user_id',userId)
      .eq('active',true).maybeSingle();
    const { data: profile } = await db.from('app_profiles')
      .select('active').eq('user_id',userId).maybeSingle();
    if (tenant?.status !== 'active' || !member || !profile?.active) {
      throw new ForbiddenException('No autorizado para el piloto.');
    }
    const { data, error } = await db.from('mw1_instagram_staging_inbox')
      .select('provider_message_id,sender_id,message_text,received_at')
      .eq('company_id', companyId)
      .order('received_at',{ascending:false}).limit(20);
    if (error) throw new ForbiddenException('No se pudo consultar el diagnóstico de Instagram.');
    return {
      ok: true, channel:'instagram', company:'piloto-mw1-prueba',
      receptionEnabled: process.env.MW1_STAGING_INSTAGRAM_RECEIVE_ENABLED === 'true',
      messages: data ?? [], readOnly:true,
    };
  }

  @Get()
  async list(
    @Headers('x-chatpro-inbox-key') key = '',
    @Headers('x-chatpro-user-id') userId = '',
    @Headers('x-chatpro-company-id') companyId = '',
    @Query('company') slug = '',
    @Headers('x-mw1-internal-assertion') identityAssertion = '',
  ) {
    await this.authorizeRead(key,userId,companyId,slug,identityAssertion,'/inbox');
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
  /** Keep current shared inbox.view visibility. Only authenticated tenant
   * members may read; assignment governs management, not shared reading. */
  private async authorizeRead(
    key:string,userId:string,companyId:string,slug:string,
    identityAssertion:string,path:'/inbox'|'/inbox/instagram-pilot',
  ):Promise<void>{
    const expected=process.env.CHATPRO_INBOX_KEY?.trim();
    if(process.env.MW1_STAGING_MODE!=='true'||!expected||key!==expected||
      !userId||!companyId||!slug)
      throw new UnauthorizedException('Sesión de bandeja no autorizada.');
    verifyInternalAttestation(identityAssertion,{
      kind:'user',userId,companyId,companySlug:slug,
      method:'GET',path,
    });
    const client=this.db.getClient();
    const {data:company,error:companyError}=await client.from('companies')
      .select('id,status,slug').eq('id',companyId).eq('slug',slug).maybeSingle();
    if(companyError||company?.status!=='active')
      throw new ForbiddenException('Empresa no autorizada.');
    const {data:profile,error:profileError}=await client.from('app_profiles')
      .select('active').eq('user_id',userId).maybeSingle();
    if(profileError||profile?.active!==true)
      throw new ForbiddenException('Usuario inactivo.');
    const {data:membership,error:membershipError}=await client.from('company_memberships')
      .select('role_id,active').eq('company_id',company.id).eq('user_id',userId).maybeSingle();
    if(membershipError||membership?.active!==true||!membership.role_id)
      throw new ForbiddenException('Membresía no autorizada.');
    const {data:role,error:roleError}=await client.from('app_roles')
      .select('id,key,company_id').eq('id',membership.role_id).maybeSingle();
    if(roleError||!role||role.company_id&&role.company_id!==company.id)
      throw new ForbiddenException('Rol no autorizado.');
    const {data:links,error:linksError}=await client.from('app_role_permissions')
      .select('permission_id').eq('role_id',membership.role_id);
    if(linksError)throw new ForbiddenException('Permisos no disponibles.');
    const permissionIds=(links??[]).map(x=>x.permission_id)
      .filter((id:unknown):id is string=>typeof id==='string');
    const {data:permissions,error:permissionsError}=permissionIds.length
      ?await client.from('app_permissions').select('key').in('id',permissionIds)
      :{data:[],error:null};
    if(permissionsError||!((permissions??[]) as Array<{key:string}>).some(x=>x.key==='inbox.view'))
      throw new ForbiddenException('Sin permiso para consultar la bandeja.');
  }

}
