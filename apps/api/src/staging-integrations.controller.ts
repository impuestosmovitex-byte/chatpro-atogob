import { BadRequestException, Controller, ForbiddenException, Get, Headers, Post, Query, UnauthorizedException, Body } from '@nestjs/common';
import { SupabaseService } from './supabase.service';
import { IntegrationCredentialsService } from './integration-credentials.service';

/** Read-only integration status for isolated MW1 staging. No tokens or secrets exposed. */
@Controller('integrations')
export class StagingIntegrationsController {
  constructor(private readonly supabase: SupabaseService, private readonly credentials?: IntegrationCredentialsService) {}

  /**
   * Instagram onboarding readiness is intentionally read-only in staging.
   * We use Instagram Login, not the WhatsApp Embedded Signup configuration.
   * Do not enable subscriptions, exchange tokens, or touch production channels.
   */
  @Get('instagram/config')
  async instagramConfig(
    @Headers('x-chatpro-inbox-key') key = '',
    @Headers('x-chatpro-user-id') userId = '',
    @Headers('x-chatpro-company-id') companyId = '',
    @Query('company') slug = '',
  ) {
    const result = await this.list(key, userId, companyId, slug);
    const isPilot = result.company.slug === 'piloto-mw1-prueba';
    const enabled = process.env.MW1_STAGING_INSTAGRAM_ONBOARDING_ENABLED === 'true';
    const appId = process.env.META_INSTAGRAM_APP_ID?.trim() || '';
    const appSecret = process.env.META_INSTAGRAM_APP_SECRET?.trim() || '';
    const encryptionReady = Boolean(process.env.CHATPRO_INTEGRATIONS_ENCRYPTION_KEY?.trim());
    const ready = isPilot && enabled && Boolean(appId && appSecret) && encryptionReady;
    return {
      ok: true,
      company: result.company,
      provider: 'meta',
      integrationType: 'instagram',
      loginMode: 'instagram_login',
      appId: isPilot && enabled && appId ? appId : null,
      scopes: ['instagram_business_basic', 'instagram_business_manage_messages'],
      ready,
      authorizationEnabled: false,
      connectionEnabled: false,
      webhookEnabled: false,
      missing: isPilot && enabled ? [
        ...(!appId ? ['META_INSTAGRAM_APP_ID'] : []),
        ...(!appSecret ? ['META_INSTAGRAM_APP_SECRET'] : []),
        ...(!encryptionReady ? ['CHATPRO_INTEGRATIONS_ENCRYPTION_KEY'] : []),
      ] : [],
      message: !isPilot || !enabled
        ? 'La conexión de Instagram aún no está habilitada para esta empresa.'
        : ready
          ? 'Configuración preliminar lista; falta habilitar OAuth seguro y pruebas de recepción.'
          : 'La configuración de Instagram en staging está incompleta.',
    };
  }

  /**
   * Isolated Instagram Login token exchange. This never subscribes webhooks,
   * sends messages or activates a channel. The feature flag is OFF by default.
   */
  @Post('instagram/exchange-code')
  async exchangeInstagramCode(
    @Headers('x-chatpro-inbox-key') key = '',
    @Headers('x-chatpro-user-id') userId = '',
    @Headers('x-chatpro-company-id') companyId = '',
    @Query('company') slug = '',
    @Body() body: { code?: string; redirectUri?: string; nonceHash?: string } = {},
  ) {
    const result = await this.list(key, userId, companyId, slug);
    if (result.company.slug !== 'piloto-mw1-prueba' ||
        process.env.MW1_STAGING_INSTAGRAM_TOKEN_EXCHANGE_ENABLED !== 'true') {
      throw new ForbiddenException('El intercambio de Instagram no está habilitado.');
    }
    const expectedRedirect = 'https://mw1-web-staging-staging.up.railway.app/api/integrations/instagram/callback';
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (!code || code.length > 4096 || body.redirectUri !== expectedRedirect) {
      throw new BadRequestException('El código o retorno de Instagram es inválido.');
    }
    if (process.env.MW1_STAGING_INSTAGRAM_ONBOARDING_ENABLED !== 'true' ||
        process.env.MW1_STAGING_INSTAGRAM_OAUTH_ENABLED !== 'true' ||
        !this.credentials) {
      throw new ForbiddenException('El piloto de Instagram no está preparado.');
    }
    if (!/^[a-f0-9]{64}$/.test(body.nonceHash || '')) {
      throw new BadRequestException('La autorización OAuth no es válida.');
    }
    const { data: consumed, error: nonceError } = await this.supabase.getClient()
      .rpc('mw1_consume_instagram_oauth_nonce', {
        p_nonce_hash: body.nonceHash,
        p_company_id: companyId,
        p_user_id: userId,
      });
    if (nonceError || consumed !== true) {
      throw new ForbiddenException('Autorización OAuth vencida o utilizada anteriormente.');
    }
    const appId = process.env.META_INSTAGRAM_APP_ID?.trim();
    const appSecret = process.env.META_INSTAGRAM_APP_SECRET?.trim();
    if (!appId || !appSecret) {
      throw new ForbiddenException('Falta configurar la aplicación de Instagram.');
    }
    // Only Instagram Login endpoints; no subscribed_apps or webhook changes.
    const exchangeBody = new URLSearchParams({
      client_id: appId, client_secret: appSecret,
      grant_type: 'authorization_code', redirect_uri: expectedRedirect, code,
    });
    const shortResponse = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: exchangeBody.toString(),
    });
    const shortData = await shortResponse.json().catch(() => ({})) as Record<string, unknown>;
    const shortToken = typeof shortData.access_token === 'string' ? shortData.access_token : '';
    if (!shortResponse.ok || shortToken.length < 20) {
      throw new BadRequestException('Instagram rechazó el código de autorización.');
    }
    const longUrl = new URL('https://graph.instagram.com/access_token');
    longUrl.searchParams.set('grant_type', 'ig_exchange_token');
    longUrl.searchParams.set('client_secret', appSecret);
    longUrl.searchParams.set('access_token', shortToken);
    const longResponse = await fetch(longUrl);
    const longData = await longResponse.json().catch(() => ({})) as Record<string, unknown>;
    const accessToken = typeof longData.access_token === 'string' ? longData.access_token : '';
    if (!longResponse.ok || accessToken.length < 20) {
      throw new BadRequestException('Instagram no permitió extender la autorización.');
    }
    const version = (process.env.META_INSTAGRAM_API_VERSION || 'v26.0').trim();
    if (!/^v[0-9]+\.[0-9]+$/.test(version)) {
      throw new BadRequestException('Versión de la API de Meta no válida.');
    }
    const profileUrl = new URL('https://graph.instagram.com/' + version + '/me');
    profileUrl.searchParams.set('fields', 'id,user_id,username,name,account_type');
    profileUrl.searchParams.set('access_token', accessToken);
    const profileResponse = await fetch(profileUrl);
    const profile = await profileResponse.json().catch(() => ({})) as Record<string, unknown>;
    const externalId = String(profile.user_id || '').trim();
    const accountType = String(profile.account_type || '').toUpperCase();
    if (!profileResponse.ok || !/^[0-9]+$/.test(externalId) ||
        !['BUSINESS','CREATOR','MEDIA_CREATOR'].includes(accountType)) {
      throw new BadRequestException('Instagram requiere una cuenta profesional válida.');
    }
    const db = this.supabase.getClient();
    const { data: existing, error: checkError } = await db.from('company_integrations')
      .select('id').eq('provider', 'meta').eq('integration_type', 'instagram')
      .eq('external_id', externalId).maybeSingle();
    if (checkError || existing) {
      throw new ForbiddenException('La cuenta ya está registrada o no pudo verificarse.');
    }
    const expires = Number(longData.expires_in);
    const { error: saveError } = await db.from('company_integrations').insert({
      company_id: companyId,
      provider: 'meta',
      integration_type: 'instagram',
      external_id: externalId,
      status: 'pending',
      config: {
        setup_source: 'mw1_staging_instagram_login',
        api_version: version,
        username: typeof profile.username === 'string' ? profile.username : null,
        account_type: accountType,
        token_expires_at: Number.isFinite(expires) && expires > 0
          ? new Date(Date.now() + expires * 1000).toISOString() : null,
        webhooks_subscribed: false,
      },
      credential_mode: 'encrypted',
      credential_reference: { token_format: 'instagram_user_access_token' },
      credentials_encrypted: this.credentials.encrypt({ access_token: accessToken }),
    });
    if (saveError) throw new ForbiddenException('No se pudo guardar la cuenta pendiente.');
    return {
      ok: true, pending: true, connectionEnabled: false,
      message: 'Cuenta validada y guardada como pendiente. No se activaron mensajes.',
      instagram: { username: typeof profile.username === 'string' ? profile.username : null },
    };
  }

  @Post('instagram/oauth/register')
  async registerInstagramOAuth(
    @Headers('x-chatpro-inbox-key') key = '',
    @Headers('x-chatpro-user-id') userId = '',
    @Headers('x-chatpro-company-id') companyId = '',
    @Query('company') slug = '',
    @Body() body: { nonceHash?: string; expiresAt?: string } = {},
  ) {
    const result = await this.list(key, userId, companyId, slug);
    if (result.company.slug !== 'piloto-mw1-prueba' ||
        process.env.MW1_STAGING_INSTAGRAM_ONBOARDING_ENABLED !== 'true' ||
        process.env.MW1_STAGING_INSTAGRAM_OAUTH_ENABLED !== 'true') {
      throw new ForbiddenException('Instagram no habilitado.');
    }
    if (!/^[a-f0-9]{64}$/.test(body.nonceHash || '')) {
      throw new BadRequestException('Identificador OAuth inválido.');
    }
    const expiry = Date.parse(body.expiresAt || '');
    if (!Number.isFinite(expiry) || expiry <= Date.now() ||
        expiry > Date.now() + 10 * 60 * 1000) {
      throw new BadRequestException('Caducidad OAuth inválida.');
    }
    const { error } = await this.supabase.getClient()
      .from('mw1_instagram_oauth_nonces')
      .insert({
        nonce_hash: body.nonceHash,
        company_id: companyId,
        user_id: userId,
        expires_at: new Date(expiry).toISOString(),
      });
    if (error) throw new ForbiddenException('No se pudo registrar el inicio OAuth.');
    return { ok: true };
  }

  @Post('instagram/oauth/consume')
  async consumeInstagramOAuth(
    @Headers('x-chatpro-inbox-key') key = '',
    @Headers('x-chatpro-user-id') userId = '',
    @Headers('x-chatpro-company-id') companyId = '',
    @Query('company') slug = '',
    @Body() body: { nonceHash?: string } = {},
  ) {
    const result = await this.list(key, userId, companyId, slug);
    if (result.company.slug !== 'piloto-mw1-prueba' ||
        process.env.MW1_STAGING_INSTAGRAM_ONBOARDING_ENABLED !== 'true' ||
        process.env.MW1_STAGING_INSTAGRAM_OAUTH_ENABLED !== 'true') {
      throw new ForbiddenException('Instagram no habilitado.');
    }
    if (!/^[a-f0-9]{64}$/.test(body.nonceHash || '')) {
      throw new BadRequestException('Identificador OAuth inválido.');
    }
    const { data, error } = await this.supabase.getClient()
      .rpc('mw1_consume_instagram_oauth_nonce', {
        p_nonce_hash: body.nonceHash,
        p_company_id: companyId,
        p_user_id: userId,
      });
    if (error) throw new ForbiddenException('No se pudo validar el estado OAuth.');
    return { ok: true, consumed: data === true };
  }

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
    // Preflight must not disclose whether a phone belongs to another tenant
    // unless this specific staging pilot is explicitly authorized for onboarding.
    if (process.env.MW1_STAGING_WHATSAPP_ONBOARDING_ENABLED !== 'true' ||
        result.company.slug !== 'piloto-mw1-prueba')
      throw new ForbiddenException('La validación de WhatsApp no está habilitada para esta empresa.');
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
    // Only expose non-sensitive Instagram metadata for the current tenant.
    // A stored authorization is never an active message connection in staging.
    const { data: instagramRows, error: instagramError } = await db
      .from('company_integrations')
      .select('id,status,config,updated_at')
      .eq('company_id', company.id)
      .eq('provider', 'meta')
      .eq('integration_type', 'instagram')
      .eq('status', 'pending')
      .order('updated_at', { ascending: false })
      .limit(1);
    if (instagramError) {
      throw new ForbiddenException('No se pudo consultar el estado de Instagram.');
    }
    const pendingInstagram = instagramRows?.[0] ?? null;
    const pendingConfig = pendingInstagram?.config &&
      typeof pendingInstagram.config === 'object' &&
      !Array.isArray(pendingInstagram.config)
      ? pendingInstagram.config as Record<string, unknown>
      : {};
    const pendingUsername = typeof pendingConfig.username === 'string'
      ? pendingConfig.username
      : null;
    const integrations = catalog.map(channel=>({
      ...channel,
      id: channel.key === 'instagram' && pendingInstagram ? pendingInstagram.id : null,
      status: channel.key === 'instagram' && pendingInstagram ? 'pending' : 'disconnected',
      statusLabel: channel.key === 'instagram' && pendingInstagram ? 'Pendiente de activación' : 'No conectada',
      credentialMode: null,
      details: channel.key === 'instagram' && pendingInstagram
        ? { username: pendingUsername, displayName: pendingUsername }
        : {},
      connectedAt: null,
      updatedAt: channel.key === 'instagram' && pendingInstagram ? pendingInstagram.updated_at : null,
      health:{status:'not_checked',statusLabel:'Sin verificar',checkedAt:null,
        error:null,verifiedName:null,displayPhoneNumber:null,qualityRating:null},
    }));
    return {ok:true,company:{id:company.id,name:company.name,slug:company.slug},
      integrations,stagingReadOnly:true,connectionEnabled:false};
  }
}
