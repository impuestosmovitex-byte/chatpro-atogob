import { BadRequestException, Controller, ForbiddenException, Get, Headers, Post, Query, UnauthorizedException, Body } from '@nestjs/common';
import { SupabaseService } from './supabase.service';

/** Read-only integration status for isolated MW1 staging. No tokens or secrets exposed. */
@Controller('integrations')
export class StagingIntegrationsController {
  constructor(private readonly supabase: SupabaseService) {}

  @Get('whatsapp/embedded/config')
  async embeddedConfig(
    @Headers('x-chatpro-inbox-key') key = '',
    @Headers('x-chatpro-user-id') userId = '',
    @Headers('x-chatpro-company-id') companyId = '',
    @Query('company') slug = '',
  ) {
    // Reuse the same tenant membership and admin-role validation as the catalog.
    const result = await this.list(key, userId, companyId, slug);
    return {
      ok: true,
      ready: false,
      connectionEnabled: false,
      appId: process.env.META_WHATSAPP_APP_ID?.trim() || null,
      configurationId: process.env.META_WHATSAPP_EMBEDDED_CONFIG_ID?.trim() || null,
      apiVersion: 'v26.0',
      flowVersion: 'v4',
      sessionInfoVersion: '3',
      company: result.company,
      message: 'Meta configurado en staging; la autorización real permanece deshabilitada hasta validar aislamiento y webhooks.',
    };
  }

  @Post('whatsapp/embedded/preflight')
  async embeddedPreflight(
    @Headers('x-chatpro-inbox-key') key = '',
    @Headers('x-chatpro-user-id') userId = '',
    @Headers('x-chatpro-company-id') companyId = '',
    @Query('company') slug = '',
    @Body() body: { phoneNumberId?: unknown } = {},
  ) {
    const result = await this.list(key, userId, companyId, slug);
    const phoneNumberId = typeof body?.phoneNumberId === 'string' ? body.phoneNumberId.trim() : '';
    if (!/^\\d{6,30}$/.test(phoneNumberId))
      throw new BadRequestException('Identificador de teléfono no válido.');
    // This is a read-only gate. Never call Meta or change a webhook here.
    const { data: connected, error } = await this.supabase.getClient()
      .from('company_integrations')
      .select('company_id')
      .eq('provider','meta')
      .eq('integration_type','whatsapp')
      .eq('external_id',phoneNumberId)
      .maybeSingle();
    if (error) throw new BadRequestException('No se pudo validar la titularidad del número.');
    if (connected && connected.company_id !== result.company.id)
      throw new ForbiddenException('El número ya está asignado a otra empresa.');
    return {ok:true,companyId:result.company.id,numberAvailable:!connected,alreadyAssignedToThisCompany:!!connected,
      connectionEnabled:false,message:'Validación previa correcta. La conexión real aún no está habilitada.'};
  }

  @Post('whatsapp/embedded/complete')
  async embeddedComplete(
    @Headers('x-chatpro-inbox-key') key = '',
    @Headers('x-chatpro-user-id') userId = '',
    @Headers('x-chatpro-company-id') companyId = '',
    @Query('company') slug = '',
  ) {
    // Validate tenant and admin role before responding, even while completion is disabled.
    await this.list(key, userId, companyId, slug);
    // Never exchange codes or write tokens until a tenant-bound staging flow is audited.
    throw new ForbiddenException('El registro real de WhatsApp aún no está habilitado en staging.');
  }

  @Get()
  async list(
    @Headers('x-chatpro-inbox-key') key = '',
    @Headers('x-chatpro-user-id') userId = '',
    @Headers('x-chatpro-company-id') companyId = '',
    @Query('company') slug = '',
  ) {
    const expected = process.env.CHATPRO_INBOX_KEY?.trim();
    if (!expected || key !== expected || !userId || !companyId)
      throw new UnauthorizedException('Sesión requerida.');
    const db = this.supabase.getClient();
    const { data: company, error: companyError } = await db.from('companies')
      .select('id,name,slug,status').eq('id',companyId).eq('slug',slug).maybeSingle();
    if (companyError || !company || company.status !== 'active')
      throw new ForbiddenException('Empresa no autorizada.');
    const { data: membership, error: membershipError } = await db.from('company_memberships')
      .select('role_id,active').eq('company_id',company.id).eq('user_id',userId)
      .eq('active',true).maybeSingle();
    if (membershipError || !membership) throw new ForbiddenException('Sin acceso a esta empresa.');
    const { data: role, error: roleError } = await db.from('app_roles')
      .select('key,company_id').eq('id',membership.role_id).maybeSingle();
    if (roleError || !role || (role.key !== 'owner' && role.key !== 'admin') ||
        (role.company_id && role.company_id !== company.id))
      throw new ForbiddenException('No puedes administrar integraciones.');
    // Display the available integrations to the owner, even when no channels
    // have been configured yet. Do not expose stored secrets or pretend that
    // a connection is active: actual setup is gated independently.
    const catalog = [
      {key:'whatsapp',provider:'meta',integrationType:'whatsapp',name:'WhatsApp Business',description:'Atiende mensajes de WhatsApp con agentes humanos e IA.',connectionReady:false},
      {key:'shopify',provider:'shopify',integrationType:'store',name:'Shopify',description:'Conecta el catálogo de productos de tu tienda.',connectionReady:false},
      {key:'instagram',provider:'meta',integrationType:'instagram',name:'Instagram',description:'Atiende mensajes directos de Instagram.',connectionReady:false},
      {key:'messenger',provider:'meta',integrationType:'messenger',name:'Messenger',description:'Centraliza mensajes de tu página de Facebook.',connectionReady:false},
      {key:'meta-ads',provider:'meta',integrationType:'ads',name:'Meta Ads',description:'Analítica publicitaria, disponible en una futura etapa.',connectionReady:false},
    ];
    const integrations = catalog.map(channel=>({
      ...channel,id:null,status:'disconnected',statusLabel:'No conectada',
      credentialMode:null,details:{},connectedAt:null,updatedAt:null,
      health:{status:'not_checked',statusLabel:'Sin verificar',checkedAt:null,
        error:null,verifiedName:null,displayPhoneNumber:null,qualityRating:null},
    }));
    return {ok:true,company:{id:company.id,name:company.name,slug:company.slug},
      integrations,stagingReadOnly:true,connectionEnabled:false};
  }
}
