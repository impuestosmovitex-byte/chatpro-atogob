import { BadRequestException, Controller, ForbiddenException, Get, Headers, Post, Query, UnauthorizedException, Body } from '@nestjs/common';
import { SupabaseService } from './supabase.service';
import { IntegrationCredentialsService } from './integration-credentials.service';

/** Read-only integration status for isolated MW1 staging. No tokens or secrets exposed. */
@Controller('integrations')
export class StagingIntegrationsController {
  constructor(private readonly supabase: SupabaseService, private readonly credentials?: IntegrationCredentialsService) {}

  /**
   * Read-only Messenger onboarding preflight, isolated to the staging pilot.
   * This does not grant permissions, invoke Meta, exchange tokens or enable
   * Page subscriptions. The OAuth flow MUST have server-side state and
   * encrypted server-side credentials before launch is considered safe.
   */
  @Get('messenger/config')
  async messengerConfig(
    @Headers('x-chatpro-inbox-key') key = '',
    @Headers('x-chatpro-user-id') userId = '',
    @Headers('x-chatpro-company-id') companyId = '',
    @Query('company') slug = '',
  ) {
    const result = await this.list(key, userId, companyId, slug);
    const isPilot = result.company.slug === 'piloto-mw1-prueba';
    const appId = process.env.META_WHATSAPP_APP_ID?.trim() || '';
    const appPresent = appId === '1079916404666757';
    const appSecretPresent = Boolean(process.env.META_WHATSAPP_APP_SECRET?.trim());
    const encryptionPresent = Boolean(
      process.env.CHATPRO_INTEGRATIONS_ENCRYPTION_KEY?.trim(),
    );
    return {
      ok: true,
      provider: 'meta',
      integrationType: 'messenger',
      ready: false,
      authorizationEnabled: false,
      connectionEnabled: false,
      message: isPilot
        ? 'Messenger está en preparación segura. Falta completar OAuth de servidor, validar los permisos de Páginas y mantener el token fuera del navegador. No se conectará ninguna cuenta todavía.'
        : 'Messenger no está autorizado para esta empresa en staging.',
      checks: isPilot ? {
        isolatedPilot: true,
        metaAppConfigured: appPresent,
        metaAppSecretConfigured: appSecretPresent,
        encryptedCredentialStorageConfigured: encryptionPresent,
        serverSideOAuthStateVerified: false,
        pageOwnershipVerified: false,
        approvedPageMessagingAccessVerified: false,
        webhookSubscriptionEnabled: false,
      } : undefined,
      missing: isPilot ? [
        ...(!appPresent ? ['Aplicación Meta MW1'] : []),
        ...(!appSecretPresent ? ['Clave privada Meta en servidor'] : []),
        ...(!encryptionPresent ? ['Cifrado de credenciales en servidor'] : []),
        'OAuth de Messenger validado en servidor',
        'Confirmación de permisos y titularidad de Páginas',
        'Autorización de mensajería de Páginas por Meta',
      ] : [],
    };
  }

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
    // Unified Login uses the parent Meta app, not the legacy Instagram app credentials.
    const appId = process.env.META_INSTAGRAM_APP_ID?.trim() || '';
    const appSecret = process.env.META_INSTAGRAM_APP_SECRET?.trim() || '';
    const configurationId = process.env.META_INSTAGRAM_UNIFIED_CONFIG_ID?.trim() || '';
    const correctSetup = appId === '1079916404666757' &&
      configurationId === '2371579683591784';
    const encryptionReady = Boolean(process.env.CHATPRO_INTEGRATIONS_ENCRYPTION_KEY?.trim());
    const oauthEnabled = process.env.MW1_STAGING_INSTAGRAM_OAUTH_ENABLED === 'true';
    const exchangeEnabled = process.env.MW1_STAGING_INSTAGRAM_TOKEN_EXCHANGE_ENABLED === 'true';
    const ready = isPilot && enabled && correctSetup && Boolean(appSecret) &&
      encryptionReady && oauthEnabled && exchangeEnabled;
    const pilotLoginEnabled = process.env.MW1_STAGING_INSTAGRAM_LOGIN_UI_ENABLED === 'true';
    return {
      ok: true,
      company: result.company,
      provider: 'meta',
      integrationType: 'instagram',
      loginMode: 'unified_login',
      appId: isPilot && enabled && correctSetup ? appId : null,
      configurationId: isPilot && enabled && correctSetup ? configurationId : null,
      scopes: ['instagram_basic', 'instagram_manage_messages'],
      ready,
      authorizationEnabled: ready && pilotLoginEnabled,
      connectionEnabled: false,
      webhookEnabled: false,
      webhookPreflight: isPilot ? {
        endpointDeployed: true,
        verificationTokenConfigured: Boolean(
          process.env.MW1_STAGING_INSTAGRAM_WEBHOOK_VERIFY_TOKEN?.trim(),
        ),
        receiptEnabled: process.env.MW1_STAGING_INSTAGRAM_RECEIVE_ENABLED === 'true',
        appSubscriptionConfirmed: false,
        inboxRepliesEnabled: false,
        warning: 'No cambies el webhook de la aplicación Meta compartida hasta verificar que no afecte otras integraciones.',
      } : undefined,
      missing: isPilot && enabled ? [
        ...(!correctSetup ? ['META_INSTAGRAM_APP_ID / META_INSTAGRAM_UNIFIED_CONFIG_ID'] : []),
        ...(!appSecret ? ['META_INSTAGRAM_APP_SECRET'] : []),
        ...(!encryptionReady ? ['CHATPRO_INTEGRATIONS_ENCRYPTION_KEY'] : []),
        ...(!oauthEnabled ? ['MW1_STAGING_INSTAGRAM_OAUTH_ENABLED'] : []),
        ...(!exchangeEnabled ? ['MW1_STAGING_INSTAGRAM_TOKEN_EXCHANGE_ENABLED'] : []),
        ...(!pilotLoginEnabled ? ['MW1_STAGING_INSTAGRAM_LOGIN_UI_ENABLED'] : []),
      ] : [],
      message: !isPilot || !enabled
        ? 'La conexión de Instagram aún no está habilitada para esta empresa.'
        : ready
          ? (pilotLoginEnabled
            ? 'Autorización piloto Unified Login habilitada. La recepción de mensajes sigue deshabilitada.'
            : 'Requisitos técnicos preparados; falta habilitar explícitamente el piloto de autorización.')
          : 'La configuración de Unified Login en staging está incompleta.',
    };
  }

  /**
   * Read-only Instagram token preflight for the isolated staging pilot.
   * No webhook subscription, sending, activation or database mutation.
   */
  @Post('instagram/test')
  async testInstagram(
    @Headers('x-chatpro-inbox-key') key = '',
    @Headers('x-chatpro-user-id') userId = '',
    @Headers('x-chatpro-company-id') companyId = '',
    @Query('company') slug = '',
  ) {
    const result = await this.list(key, userId, companyId, slug);
    if (result.company.slug !== 'piloto-mw1-prueba' || !this.credentials) {
      throw new ForbiddenException('Esta verificación solo está permitida para el piloto.');
    }
    const { data, error } = await this.supabase.getClient()
      .from('company_integrations')
      .select('id,external_id,status,config,credentials_encrypted')
      .eq('company_id', companyId)
      .eq('provider', 'meta')
      .eq('integration_type', 'instagram')
      .eq('status', 'pending')
      .limit(2);
    if (error || !Array.isArray(data) || data.length !== 1 ||
        !data[0].external_id || !data[0].credentials_encrypted) {
      throw new ForbiddenException('No existe una única autorización pendiente para este piloto.');
    }
    const row = data[0];
    const metadata = row.config && typeof row.config === 'object'
      ? row.config as Record<string, unknown> : {};
    if (metadata.username !== 'chatpro_mw1' || metadata.webhooks_subscribed !== false) {
      throw new ForbiddenException('La cuenta no corresponde a la prueba aislada.');
    }
    let accessToken = '';
    try {
      const decrypted = this.credentials.decrypt(row.credentials_encrypted);
      accessToken = typeof decrypted.access_token === 'string'
        ? decrypted.access_token : '';
    } catch {
      throw new ForbiddenException('No fue posible comprobar las credenciales guardadas.');
    }
    if (!accessToken || accessToken.length < 20) {
      throw new ForbiddenException('La autorización guardada es inválida.');
    }
    const appId = process.env.META_INSTAGRAM_APP_ID?.trim() || '';
    const appSecret = process.env.META_INSTAGRAM_APP_SECRET?.trim() || '';
    if (appId !== '1079916404666757' || !appSecret) {
      throw new ForbiddenException('La aplicación Meta del piloto no está configurada.');
    }
    const version = (process.env.META_INSTAGRAM_API_VERSION || 'v26.0').trim();
    if (!/^v[0-9]+\.[0-9]+$/.test(version.trim())) {
      throw new ForbiddenException('Versión de Meta no válida.');
    }
    let confirmed = false;
    try {
      const target = new URL(`https://graph.facebook.com/${version}/debug_token`);
      target.searchParams.set('input_token', accessToken);
      const response = await fetch(target, {
        headers: { Authorization: `Bearer ${appId}|${appSecret}` },
        cache: 'no-store', signal: AbortSignal.timeout(12000),
      });
      const parsed = await response.json() as {
        data?: { app_id?: unknown; is_valid?: unknown; type?: unknown; scopes?: unknown };
      };
      const details = parsed.data;
      const scopes = Array.isArray(details?.scopes) ? details.scopes : [];
      confirmed = response.ok && details?.is_valid === true &&
        String(details?.app_id || '') === appId &&
        details?.type === 'SYSTEM_USER' &&
        ['instagram_basic', 'instagram_manage_messages'].every(s => scopes.includes(s));
    } catch {
      throw new ForbiddenException('No se pudo consultar la validez en Meta. No se cambió la conexión.');
    }
    if (!confirmed) {
      throw new ForbiddenException('Meta no confirmó los permisos de la autorización pendiente.');
    }
    return {
      ok: true,
      pending: true,
      authorizationValid: true,
      connectionEnabled: false,
      webhooksEnabled: false,
      instagram: { username: 'chatpro_mw1' },
      message: 'Meta confirmó la autorización del piloto. La recepción de mensajes continúa deshabilitada.',
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
        process.env.MW1_STAGING_INSTAGRAM_TOKEN_EXCHANGE_ENABLED !== 'true' ||
        process.env.MW1_STAGING_INSTAGRAM_LOGIN_UI_ENABLED !== 'true') {
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
    // Business Integration System User Token via Meta Unified Login.
    // Never log credentials or subscribe webhooks during OAuth.
    if (appId !== '1079916404666757' ||
        process.env.META_INSTAGRAM_UNIFIED_CONFIG_ID?.trim() !== '2371579683591784') {
      throw new ForbiddenException('La configuración de Unified Login no corresponde al piloto.');
    }
    const version = (process.env.META_INSTAGRAM_API_VERSION || 'v26.0').trim();
    if (!/^v[0-9]+\.[0-9]+$/.test(version)) {
      throw new BadRequestException('Versión de la API de Meta no válida.');
    }
    const tokenUrl = new URL(`https://graph.facebook.com/${version}/oauth/access_token`);
    tokenUrl.searchParams.set('client_id', appId);
    tokenUrl.searchParams.set('client_secret', appSecret);
    tokenUrl.searchParams.set('redirect_uri', expectedRedirect);
    tokenUrl.searchParams.set('code', code);
    let accessToken = '';
    try {
      const response = await fetch(tokenUrl, {
        method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(15000),
      });
      const payload = await response.json() as { access_token?: unknown };
      if (!response.ok || typeof payload.access_token !== 'string' ||
          payload.access_token.length < 20) throw new Error('exchange failed');
      accessToken = payload.access_token;
    } catch {
      throw new BadRequestException('Meta rechazó el código de Unified Login.');
    }
    // Inspect the returned token before trusting or encrypting it. The
    // app token is held server-side only; no secrets are sent to the browser.
    try {
      const debugUrl = new URL(`https://graph.facebook.com/${version}/debug_token`);
      debugUrl.searchParams.set('input_token', accessToken);
      const debugResponse = await fetch(debugUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${appId}|${appSecret}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });
      const debug = await debugResponse.json() as {
        data?: { app_id?: unknown; type?: unknown; is_valid?: unknown; scopes?: unknown };
      };
      const info = debug.data;
      const granted = Array.isArray(info?.scopes) ? info.scopes : [];
      if (!debugResponse.ok || !info ||
          String(info.app_id || '') !== appId ||
          info.is_valid !== true ||
          info.type !== 'SYSTEM_USER' ||
          !['instagram_basic', 'instagram_manage_messages'].every(scope => granted.includes(scope))) {
        throw new Error('unexpected Meta token');
      }
    } catch {
      throw new ForbiddenException(
        'Meta no confirmó que el token pertenezca al piloto y tenga permisos de Instagram. No se guardó ninguna autorización.',
      );
    }
    const graphHeaders = { Authorization: `Bearer ${accessToken}` };
    let clientBusinessId = '';
    let assigned: Array<{ id?: unknown; username?: unknown }> = [];
    try {
      const identityUrl = new URL(`https://graph.facebook.com/${version}/me`);
      identityUrl.searchParams.set('fields', 'client_business_id');
      const identityResponse = await fetch(identityUrl, {
        headers: graphHeaders, cache: 'no-store', signal: AbortSignal.timeout(15000),
      });
      const identity = await identityResponse.json() as { client_business_id?: unknown };
      if (!identityResponse.ok) throw new Error('business lookup failed');
      clientBusinessId = typeof identity.client_business_id === 'string'
        ? identity.client_business_id : '';
      const accountsUrl = new URL(`https://graph.facebook.com/${version}/me/assigned_instagram_accounts`);
      accountsUrl.searchParams.set('fields', 'id,username');
      accountsUrl.searchParams.set('limit', '100');
      const accountsResponse = await fetch(accountsUrl, {
        headers: graphHeaders, cache: 'no-store', signal: AbortSignal.timeout(15000),
      });
      const accounts = await accountsResponse.json() as { data?: unknown; paging?: unknown };
      const nextPage = accounts.paging && typeof accounts.paging === 'object' &&
        'next' in accounts.paging && typeof accounts.paging.next === 'string'
        ? accounts.paging.next : null;
      if (!accountsResponse.ok || !Array.isArray(accounts.data) || nextPage) {
        throw new Error('account lookup failed or paginated');
      }
      assigned = accounts.data;
    } catch {
      throw new BadRequestException('No se pudieron verificar los activos de Instagram autorizados.');
    }
    // Never guess which account was granted: pilot authorization accepts only one.
    if (assigned.length === 0) {
      throw new BadRequestException(
        'Meta no devolvió cuentas de Instagram asignadas. Comprueba que la cuenta sea profesional y pertenezca al portafolio seleccionado; no se guardó ninguna autorización.',
      );
    }
    if (assigned.length !== 1 || typeof assigned[0]?.id !== 'string' ||
        !/^[0-9]+$/.test(assigned[0].id)) {
      throw new BadRequestException('Selecciona exactamente una cuenta profesional de Instagram durante la autorización.');
    }
    const externalId = assigned[0].id;
    let username = typeof assigned[0].username === 'string'
      ? assigned[0].username.trim() : '';
    // Meta may return the shared asset ID without username. Query only that
    // exact authorized ID; never use a search or a different account as fallback.
    if (!username) {
      try {
        const profileUrl = new URL(`https://graph.facebook.com/${version}/${externalId}`);
        profileUrl.searchParams.set('fields', 'id,username');
        const profileResponse = await fetch(profileUrl, {
          headers: graphHeaders, cache: 'no-store', signal: AbortSignal.timeout(15000),
        });
        const profile = await profileResponse.json() as { id?: unknown; username?: unknown };
        if (!profileResponse.ok || String(profile.id || '') !== externalId ||
            typeof profile.username !== 'string') {
          throw new Error('Instagram account verification failed');
        }
        username = profile.username.trim();
      } catch {
        throw new ForbiddenException(
          'Meta no permitió verificar el usuario de la cuenta de Instagram autorizada. No se guardó ninguna conexión.',
        );
      }
    }
    // The first staging pilot must only authorize the dedicated test account.
    if (username.toLowerCase() !== 'chatpro_mw1') {
      throw new ForbiddenException(
        'Este piloto solo acepta la cuenta de pruebas @chatpro_mw1; no se guardó ninguna autorización.',
      );
    }
    const db = this.supabase.getClient();
    const { data: existing, error: checkError } = await db.from('company_integrations')
      .select('id').eq('provider', 'meta').eq('integration_type', 'instagram')
      .eq('external_id', externalId).maybeSingle();
    if (checkError || existing) {
      throw new ForbiddenException('La cuenta ya está registrada o no pudo verificarse.');
    }
    const { error: saveError } = await db.from('company_integrations').insert({
      company_id: companyId,
      provider: 'meta',
      integration_type: 'instagram',
      external_id: externalId,
      status: 'pending',
      config: {
        setup_source: 'mw1_staging_unified_login',
        api_version: version,
        username,
        account_type: 'PROFESSIONAL',
        client_business_id: clientBusinessId || null,
        token_expires_at: null,
        webhooks_subscribed: false,
      },
      credential_mode: 'encrypted',
      credential_reference: { token_format: 'business_integration_system_user_access_token' },
      credentials_encrypted: this.credentials.encrypt({ access_token: accessToken }),
    });
    if (saveError) throw new ForbiddenException('No se pudo guardar la cuenta pendiente.');
    return {
      ok: true, pending: true, connectionEnabled: false,
      message: 'Cuenta validada y guardada como pendiente. No se activaron mensajes.',
      instagram: { username },
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
    @Body() body: {signupEvent?: unknown; code?: unknown; wabaId?: unknown; phoneNumberId?: unknown; businessId?: unknown} = {},
  ) {
    // Defense in depth against accidental routing of a coexistence completion
    // through the conventional Cloud API signup. The browser supplies this
    // marker, so it is NOT cryptographic proof of Meta's signup mode.
    // A real coexistence flow must verify mode/number on Meta's server side.
    if (body?.signupEvent !== 'FINISH') {
      throw new ForbiddenException(
        'La conexión de WhatsApp Business App requiere el flujo separado de coexistencia.',
      );
    }
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
