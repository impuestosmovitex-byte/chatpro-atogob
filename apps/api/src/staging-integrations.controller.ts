import { BadRequestException, Controller, ForbiddenException, Get, Headers, Post, Query, UnauthorizedException, Body } from '@nestjs/common';
import { SupabaseService } from './supabase.service';
import { IntegrationCredentialsService } from './integration-credentials.service';

/** Read-only integration status for isolated MW1 staging. No tokens or secrets exposed. */
@Controller('integrations')
export class StagingIntegrationsController {
  constructor(private readonly supabase: SupabaseService, private readonly credentials?: IntegrationCredentialsService) {}

  @Get('whatsapp/embedded/config')
  async embeddedConfig(
    @Headers('x-chatpro-inbox-key') key = '',
    @Headers('x-chatpro-user-id') userId = '',
    @Headers('x-chatpro-company-id') companyId = '',
    @Query('company') slug = '',
  ) {
    // Reuse the same tenant membership and admin-role validation as the catalog.
    const result = await this.list(key, userId, companyId, slug);
    const onboardingReady =
      process.env.MW1_STAGING_WHATSAPP_ONBOARDING_ENABLED === 'true' &&
      result.company.slug === 'piloto-mw1-prueba' &&
      !!process.env.META_WHATSAPP_APP_ID?.trim() &&
      !!process.env.META_WHATSAPP_APP_SECRET?.trim() &&
      !!process.env.META_WHATSAPP_EMBEDDED_CONFIG_ID?.trim() &&
      !!process.env.CHATPRO_INTEGRATIONS_ENCRYPTION_KEY?.trim();
    return {
      ok: true,
      ready: onboardingReady,
      connectionEnabled: false,
      authorizationEnabled: onboardingReady,
      appId: process.env.META_WHATSAPP_APP_ID?.trim() || null,
      configurationId: process.env.META_WHATSAPP_EMBEDDED_CONFIG_ID?.trim() || null,
      apiVersion: 'v26.0',
      flowVersion: 'v4',
      sessionInfoVersion: '3',
      company: result.company,
      message: onboardingReady ? 'Autorización de Meta disponible solo para piloto; los mensajes y webhooks siguen deshabilitados.' : 'La autorización de Meta no está habilitada para esta empresa.',
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
    if (!/^\d{6,30}$/.test(phoneNumberId))
      throw new BadRequestException('Identificador de teléfono no válido.');
    // This is a read-only gate. Never call Meta or change a webhook here.
    const { data: matches, error } = await this.supabase.getClient()
      .from('company_integrations')
      .select('company_id')
      .eq('provider','meta')
      .eq('integration_type','whatsapp')
      .eq('external_id',phoneNumberId)
      .limit(2);
    if (error || !Array.isArray(matches)) throw new BadRequestException('No se pudo validar la titularidad del número.');
    if (matches.length > 1) throw new ForbiddenException('El número tiene asignaciones duplicadas.');
    const connected = matches[0] || null;
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
    @Body() body: {code?: unknown; wabaId?: unknown; phoneNumberId?: unknown; businessId?: unknown} = {},
  ) {
    const context = await this.list(key, userId, companyId, slug);
    // Pilot-only provisioning; never silently enable connections on other tenants.
    if (process.env.MW1_STAGING_WHATSAPP_ONBOARDING_ENABLED !== 'true' ||
        context.company.slug !== 'piloto-mw1-prueba')
      throw new ForbiddenException('El registro real de WhatsApp aún no está habilitado en staging.');
    const appId = process.env.META_WHATSAPP_APP_ID?.trim();
    const appSecret = process.env.META_WHATSAPP_APP_SECRET?.trim();
    const code = typeof body?.code === 'string' ? body.code.trim() : '';
    const waba = typeof body?.wabaId === 'string' ? body.wabaId.trim() : '';
    const requested = typeof body?.phoneNumberId === 'string' ? body.phoneNumberId.trim() : '';
    if (!appId || !appSecret || !this.credentials)
      throw new BadRequestException('Falta configuración segura de Meta.');
    if (code.length < 20 || code.length > 4096 || !/^[0-9]{6,30}$/.test(waba) ||
        (requested && !/^[0-9]{6,30}$/.test(requested)))
      throw new BadRequestException('La autorización de Meta no contiene datos válidos.');
    const oauthUrl = new URL('https://graph.facebook.com/v26.0/oauth/access_token');
    oauthUrl.searchParams.set('client_id',appId);
    oauthUrl.searchParams.set('client_secret',appSecret);
    oauthUrl.searchParams.set('code',code);
    // No webhooks are subscribed here and no messages can be processed.
    let tokenPayload: {access_token?: string};
    try {
      const response = await fetch(oauthUrl, {method:'GET',signal:AbortSignal.timeout(15000)});
      if (!response.ok) throw new Error('oauth rejected');
      tokenPayload = await response.json() as {access_token?: string};
    } catch { throw new BadRequestException('Meta no permitió autorizar la cuenta.'); }
    const accessToken = tokenPayload.access_token;
    if (typeof accessToken !== 'string' || accessToken.length < 20)
      throw new BadRequestException('Meta no devolvió un token empresarial válido.');
    let phones: Array<{id?: string;verified_name?: string;display_phone_number?: string}>;
    try {
      const url = new URL(`https://graph.facebook.com/v26.0/${waba}/phone_numbers`);
      url.searchParams.set('fields','id,verified_name,display_phone_number');
      url.searchParams.set('limit','100');
      const response = await fetch(url, {headers:{Authorization:`Bearer ${accessToken}`},signal:AbortSignal.timeout(15000)});
      if (!response.ok) throw new Error('phone lookup rejected');
      const payload = await response.json() as {data?: unknown};
      phones = Array.isArray(payload.data) ? payload.data : [];
    } catch { throw new BadRequestException('Meta no permitió comprobar el número autorizado.'); }
    const selected = requested ? phones.find(p=>p.id===requested) : phones.length===1 ? phones[0] : undefined;
    if (!selected?.id || !/^[0-9]{6,30}$/.test(selected.id))
      throw new BadRequestException('Selecciona exactamente un número perteneciente a la cuenta autorizada.');
    const phoneId = selected.id;
    const db = this.supabase.getClient();
    const {data: existing,error:checkError} = await db.from('company_integrations')
      .select('company_id').eq('provider','meta').eq('integration_type','whatsapp')
      .eq('external_id',phoneId).limit(2);
    if (checkError || !Array.isArray(existing) || existing.length > 1 ||
        existing.length !== 0)
      throw new ForbiddenException('El número ya está registrado; no se reemplazarán credenciales ni conexiones existentes.');
    const encrypted = this.credentials.encrypt({access_token:accessToken});
    // Never UPSERT here: a concurrent signup must not replace another tenant's
    // encrypted credentials between the ownership check and the database write.
    // Let the database's unique constraint reject duplicates atomically.
    const {error:saveError} = await db.from('company_integrations').insert({
      company_id:context.company.id,provider:'meta',integration_type:'whatsapp',
      external_id:phoneId,status:'pending',credential_mode:'encrypted',
      credentials_encrypted:encrypted,
      credential_reference:{phone_number_id:phoneId,waba_id:waba},
      config:{api_version:'v26.0',business_account_id:waba,
        display_name:selected.verified_name||null,
        display_phone_number:selected.display_phone_number||null,
        setup_source:'mw1_staging_embedded_signup'},
      updated_at:new Date().toISOString(),
    });
    if (saveError?.code === '23505')
      throw new ForbiddenException('Este número ya fue registrado. No se modificaron sus credenciales.');
    if (saveError) throw new BadRequestException('No se pudo guardar la autorización de forma segura.');
    return {ok:true,connectionEnabled:false,status:'pending',
      phoneNumberId:phoneId,company:context.company,
      message:'Autorización cifrada y pendiente; la recepción de mensajes sigue deshabilitada.'};
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
