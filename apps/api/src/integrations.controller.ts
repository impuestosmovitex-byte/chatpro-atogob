import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { IntegrationCredentialsService } from './integration-credentials.service';
import { SupabaseService } from './supabase.service';
import { WhatsappMessagingService } from './whatsapp-messaging.service';

type IntegrationRow = {
  id: string;
  provider: string;
  integration_type: string;
  external_id: string;
  status: 'pending' | 'active' | 'disconnected' | 'error';
  config: unknown;
  credential_mode: 'environment' | 'encrypted';
  credential_reference: unknown;
  credentials_encrypted: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type JsonObject = Record<string, unknown>;

type WhatsappConfigureBody = {
  phoneNumberId?: unknown;
  accessToken?: unknown;
  apiVersion?: unknown;
  displayName?: unknown;
  businessAccountId?: unknown;
};

type WhatsappTestBody = {
  to?: unknown;
  message?: unknown;
};

type WhatsappEmbeddedCompleteBody = {
  code?: unknown;
  wabaId?: unknown;
  phoneNumberId?: unknown;
  businessId?: unknown;
};

const CATALOG = [
  {
    provider: 'meta',
    integrationType: 'whatsapp',
    key: 'whatsapp',
    name: 'WhatsApp Business',
    description: 'Recibe conversaciones de WhatsApp y permite responder desde la Bandeja con asesor humano o agente IA cuando el plan lo permita.',
    connectionReady: true,
  },
  {
    provider: 'shopify',
    integrationType: 'store',
    key: 'shopify',
    name: 'Shopify',
    description: 'Catálogo, productos, variantes y enlaces de compra de tu tienda.',
    connectionReady: true,
  },
  {
    provider: 'meta',
    integrationType: 'instagram',
    key: 'instagram',
    name: 'Instagram',
    description: 'Mensajes directos de Instagram dentro de la Bandeja cuando el canal esté habilitado.',
    connectionReady: false,
  },
  {
    provider: 'meta',
    integrationType: 'messenger',
    key: 'messenger',
    name: 'Messenger',
    description: 'Mensajes de Facebook Messenger dentro de la Bandeja cuando el canal esté habilitado.',
    connectionReady: false,
  },
  {
    provider: 'meta',
    integrationType: 'ads',
    key: 'meta-ads',
    name: 'Meta Ads',
    description: 'Publicidad, campañas, inversión y ROAS para reportes, alertas y análisis por empresa.',
    connectionReady: false,
  },
] as const;

@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly credentialsService: IntegrationCredentialsService,
    private readonly whatsappMessagingService: WhatsappMessagingService,
  ) {}

  @Get()
  async list(
    @Headers('x-chatpro-inbox-key') accessKey: string | undefined,
    @Query('company') companySlug: string | undefined,
  ) {
    this.requireAccess(accessKey);
    const company = await this.getCompany(companySlug);

    const { data, error } = await this.supabaseService
      .getClient()
      .from('company_integrations')
      .select(
        'id, provider, integration_type, external_id, status, config, credential_mode, credential_reference, credentials_encrypted, created_at, updated_at',
      )
      .eq('company_id', company.id)
      .order('created_at', { ascending: true });

    if (error) {
      throw new BadRequestException(
        `No se pudieron cargar las integraciones: ${error.message}`,
      );
    }

    const rows = (data ?? []) as IntegrationRow[];
    await this.refreshWhatsappHealth(rows);

    const known = CATALOG.map((item) => {
      const matches = (candidate: IntegrationRow) =>
        candidate.provider === item.provider &&
        candidate.integration_type === item.integrationType;

      const row =
        rows.find(
          (candidate) =>
            matches(candidate) &&
            candidate.status === 'active' &&
            candidate.credential_mode === 'encrypted',
        ) ??
        rows.find(
          (candidate) =>
            matches(candidate) && candidate.status === 'active',
        ) ??
        rows.find(
          (candidate) =>
            matches(candidate) &&
            candidate.credential_mode === 'encrypted',
        ) ??
        rows.find(matches);

      return row
        ? this.toIntegration(item, row)
        : {
            key: item.key,
            provider: item.provider,
            integrationType: item.integrationType,
            name: item.name,
            description: item.description,
            status: 'disconnected',
            statusLabel: 'No conectada',
            connectionReady: item.connectionReady,
            credentialMode: null,
            details: {},
            health: {
              status: 'not_checked',
              statusLabel: 'Sin verificar',
              checkedAt: null,
              error: null,
              verifiedName: null,
              displayPhoneNumber: null,
              qualityRating: null,
            },
            connectedAt: null,
            updatedAt: null,
          };
    });

    const extra = rows
      .filter(
        (row) =>
          !CATALOG.some(
            (item) =>
              item.provider === row.provider &&
              item.integrationType === row.integration_type,
          ),
      )
      .map((row) =>
        this.toIntegration(
          {
            key: `${row.provider}-${row.integration_type}`,
            provider: row.provider,
            integrationType: row.integration_type,
            name: `${row.provider} · ${row.integration_type}`,
            description: 'Integración configurada para esta empresa.',
            connectionReady: false,
          },
          row,
        ),
      );

    return {
      ok: true,
      company,
      integrations: [...known, ...extra],
    };
  }

  @Get('whatsapp/embedded/config')
  async getWhatsappEmbeddedConfig(
    @Headers('x-chatpro-inbox-key') accessKey: string | undefined,
    @Query('company') companySlug: string | undefined,
  ) {
    this.requireAccess(accessKey);
    await this.getCompany(companySlug);

    const settings = this.whatsappEmbeddedSettings();
    const missing: string[] = [];

    if (!settings.appId) missing.push('META_WHATSAPP_APP_ID');
    if (!settings.appSecret) missing.push('META_WHATSAPP_APP_SECRET');
    if (!settings.configurationId) {
      missing.push('META_WHATSAPP_EMBEDDED_CONFIG_ID');
    }

    return {
      ok: true,
      ready: missing.length === 0,
      appId: settings.appId || null,
      configurationId: settings.configurationId || null,
      apiVersion: settings.apiVersion,
      sessionInfoVersion: settings.sessionInfoVersion,
      flowVersion: settings.flowVersion,
      featureType: settings.featureType,
      missing,
      message: missing.length
        ? `Faltan variables de Meta en Railway: ${missing.join(', ')}.`
        : 'Embedded Signup está listo para abrirse.',
    };
  }

  @Post('whatsapp/embedded/complete')
  async completeWhatsappEmbeddedSignup(
    @Headers('x-chatpro-inbox-key') accessKey: string | undefined,
    @Query('company') companySlug: string | undefined,
    @Body() body: WhatsappEmbeddedCompleteBody,
  ) {
    this.requireAccess(accessKey);
    const company = await this.getCompany(companySlug);
    const code = this.text(body.code);
    const wabaId = this.digits(body.wabaId);
    const requestedPhoneNumberId = this.digits(body.phoneNumberId);
    const businessId = this.digits(body.businessId);
    const settings = this.whatsappEmbeddedSettings();

    if (!settings.appId || !settings.appSecret || !settings.configurationId) {
      throw new BadRequestException(
        'Faltan META_WHATSAPP_APP_ID, META_WHATSAPP_APP_SECRET o META_WHATSAPP_EMBEDDED_CONFIG_ID en Railway.',
      );
    }

    if (!code || code.length < 20) {
      throw new BadRequestException(
        'Meta no devolvió un código de autorización válido.',
      );
    }

    if (!wabaId || wabaId.length < 6) {
      throw new BadRequestException(
        'Meta no devolvió el identificador de la cuenta de WhatsApp.',
      );
    }

    const tokenUrl = new URL(
      `https://graph.facebook.com/${settings.apiVersion}/oauth/access_token`,
    );
    tokenUrl.searchParams.set('client_id', settings.appId);
    tokenUrl.searchParams.set('client_secret', settings.appSecret);
    tokenUrl.searchParams.set('code', code);

    const tokenPayload = await this.metaJson(
      tokenUrl,
      { method: 'GET' },
      'Meta no permitió intercambiar el código de Embedded Signup',
    );
    const accessToken = this.text(tokenPayload.access_token);

    if (!accessToken || accessToken.length < 20) {
      throw new BadRequestException(
        'Meta no devolvió el token empresarial de WhatsApp.',
      );
    }

    const phonesUrl = new URL(
      `https://graph.facebook.com/${settings.apiVersion}/${wabaId}/phone_numbers`,
    );
    phonesUrl.searchParams.set(
      'fields',
      'id,verified_name,display_phone_number,quality_rating,platform_type,code_verification_status',
    );
    phonesUrl.searchParams.set('limit', '100');

    const phonesPayload = await this.metaJson(
      phonesUrl,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      'Meta no permitió consultar los números autorizados',
    );
    const phones = Array.isArray(phonesPayload.data)
      ? phonesPayload.data.map((value) => this.toRecord(value))
      : [];
    const selectedPhone = requestedPhoneNumberId
      ? phones.find((phone) => this.digits(phone.id) === requestedPhoneNumberId)
      : phones.length === 1
        ? phones[0]
        : null;

    if (!selectedPhone) {
      throw new BadRequestException(
        requestedPhoneNumberId
          ? 'El número seleccionado no pertenece a la cuenta de WhatsApp autorizada.'
          : 'Meta autorizó varias líneas y no indicó cuál debe conectarse. Repite el flujo y selecciona una sola línea.',
      );
    }

    const phoneNumberId = this.digits(selectedPhone.id);
    const displayName = this.text(selectedPhone.verified_name);
    const displayPhoneNumber = this.text(selectedPhone.display_phone_number);
    const qualityRating = this.text(selectedPhone.quality_rating);
    const platformType = this.text(selectedPhone.platform_type);
    const codeVerificationStatus = this.text(
      selectedPhone.code_verification_status,
    );

    const subscribeUrl = new URL(
      `https://graph.facebook.com/${settings.apiVersion}/${wabaId}/subscribed_apps`,
    );
    const subscribePayload = await this.metaJson(
      subscribeUrl,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      'Meta no permitió suscribir la app a la cuenta de WhatsApp',
    );

    if (subscribePayload.success !== true) {
      throw new BadRequestException(
        'Meta no confirmó la suscripción de webhooks para esta cuenta.',
      );
    }

    const client = this.supabaseService.getClient();
    const { data: existing, error: existingError } = await client
      .from('company_integrations')
      .select('id, company_id')
      .eq('provider', 'meta')
      .eq('integration_type', 'whatsapp')
      .eq('external_id', phoneNumberId)
      .maybeSingle();

    if (existingError) {
      throw new BadRequestException(
        `No se pudo validar el canal de WhatsApp: ${existingError.message}`,
      );
    }

    if (existing && existing.company_id !== company.id) {
      throw new BadRequestException(
        'Este Phone Number ID ya está conectado a otra empresa en Chat Pro.',
      );
    }

    const now = new Date().toISOString();
    const { error: saveError } = await client
      .from('company_integrations')
      .upsert(
        {
          company_id: company.id,
          provider: 'meta',
          integration_type: 'whatsapp',
          external_id: phoneNumberId,
          status: 'active',
          config: {
            api_version: settings.apiVersion,
            display_name: displayName || null,
            display_phone_number: displayPhoneNumber || null,
            business_account_id: wabaId,
            meta_business_id: businessId || null,
            quality_rating: qualityRating || null,
            platform_type: platformType || null,
            code_verification_status: codeVerificationStatus || null,
            setup_source: 'meta_embedded_signup_business_app',
          },
          credential_mode: 'encrypted',
          credential_reference: {
            token_format: 'meta_business_integration_system_user_token',
            phone_number_id: phoneNumberId,
            waba_id: wabaId,
          },
          credentials_encrypted: this.credentialsService.encrypt({
            access_token: accessToken,
          }),
          updated_at: now,
        },
        { onConflict: 'provider,integration_type,external_id' },
      );

    if (saveError) {
      throw new BadRequestException(
        `No se pudo guardar WhatsApp: ${saveError.message}`,
      );
    }

    const { error: disconnectError } = await client
      .from('company_integrations')
      .update({ status: 'disconnected', updated_at: now })
      .eq('company_id', company.id)
      .eq('provider', 'meta')
      .eq('integration_type', 'whatsapp')
      .neq('external_id', phoneNumberId)
      .eq('status', 'active');

    if (disconnectError) {
      throw new BadRequestException(
        `WhatsApp quedó guardado, pero no se pudo cerrar la conexión anterior: ${disconnectError.message}`,
      );
    }

    return {
      ok: true,
      message: 'WhatsApp quedó autorizado y conectado mediante Meta.',
      company,
      whatsapp: {
        phoneNumberId,
        wabaId,
        displayName: displayName || null,
        displayPhoneNumber: displayPhoneNumber || null,
        platformType: platformType || null,
      },
    };
  }

  @Post('whatsapp/configure')
  async configureWhatsapp(
    @Headers('x-chatpro-inbox-key') accessKey: string | undefined,
    @Query('company') companySlug: string | undefined,
    @Body() body: WhatsappConfigureBody,
  ) {
    this.requireAccess(accessKey);
    const company = await this.getCompany(companySlug);
    const phoneNumberId = this.digits(body.phoneNumberId);
    const accessToken = this.text(body.accessToken);
    const apiVersion = this.apiVersion(body.apiVersion);
    const displayName = this.text(body.displayName);
    const businessAccountId = this.digits(body.businessAccountId);

    if (!phoneNumberId || phoneNumberId.length < 6) {
      throw new BadRequestException('Escribe un Phone Number ID válido.');
    }

    if (!accessToken || accessToken.length < 20) {
      throw new BadRequestException('Escribe un access token válido de Meta.');
    }

    const client = this.supabaseService.getClient();

    const { data: existing, error: existingError } = await client
      .from('company_integrations')
      .select('id, company_id')
      .eq('provider', 'meta')
      .eq('integration_type', 'whatsapp')
      .eq('external_id', phoneNumberId)
      .maybeSingle();

    if (existingError) {
      throw new BadRequestException(
        `No se pudo validar el canal de WhatsApp: ${existingError.message}`,
      );
    }

    if (existing && existing.company_id !== company.id) {
      throw new BadRequestException(
        'Este Phone Number ID ya está conectado a otra empresa en Chat Pro.',
      );
    }

    const now = new Date().toISOString();

    const { error: saveError } = await client
      .from('company_integrations')
      .upsert(
        {
          company_id: company.id,
          provider: 'meta',
          integration_type: 'whatsapp',
          external_id: phoneNumberId,
          status: 'active',
          config: {
            api_version: apiVersion,
            display_name: displayName || null,
            business_account_id: businessAccountId || null,
            setup_source: 'manual_meta_whatsapp',
          },
          credential_mode: 'encrypted',
          credential_reference: {
            token_format: 'meta_whatsapp_access_token',
            phone_number_id: phoneNumberId,
          },
          credentials_encrypted: this.credentialsService.encrypt({
            access_token: accessToken,
          }),
          updated_at: now,
        },
        { onConflict: 'provider,integration_type,external_id' },
      );

    if (saveError) {
      throw new BadRequestException(
        `No se pudo guardar WhatsApp: ${saveError.message}`,
      );
    }

    const { error: disconnectError } = await client
      .from('company_integrations')
      .update({ status: 'disconnected', updated_at: now })
      .eq('company_id', company.id)
      .eq('provider', 'meta')
      .eq('integration_type', 'whatsapp')
      .neq('external_id', phoneNumberId)
      .eq('status', 'active');

    if (disconnectError) {
      throw new BadRequestException(
        `WhatsApp quedó guardado, pero no se pudo cerrar la conexión anterior: ${disconnectError.message}`,
      );
    }

    return {
      ok: true,
      message: 'WhatsApp Business quedó conectado para esta empresa.',
      company,
      whatsapp: {
        phoneNumberId,
        apiVersion,
        displayName: displayName || null,
      },
    };
  }

  @Post('whatsapp/test')
  async testWhatsapp(
    @Headers('x-chatpro-inbox-key') accessKey: string | undefined,
    @Query('company') companySlug: string | undefined,
    @Body() body: WhatsappTestBody,
  ) {
    this.requireAccess(accessKey);
    const company = await this.getCompany(companySlug);
    const recipient = this.digits(body.to);
    const message =
      this.text(body.message) ||
      `Mensaje de prueba de Chat Pro para ${company.name}. Tu canal de WhatsApp está conectado.`;

    if (!recipient || recipient.length < 8 || recipient.length > 15) {
      throw new BadRequestException(
        'Escribe el teléfono de prueba con indicativo de país.',
      );
    }

    await this.whatsappMessagingService.sendText(
      company.id,
      recipient,
      message.slice(0, 1000),
    );

    return {
      ok: true,
      message: 'Mensaje de prueba enviado por WhatsApp.',
    };
  }

  private requireAccess(accessKey: string | undefined) {
    const expected = process.env.CHATPRO_INBOX_KEY?.trim();

    if (!expected || accessKey?.trim() !== expected) {
      throw new UnauthorizedException('Acceso no autorizado.');
    }
  }

  private async getCompany(companySlug: string | undefined) {
    const slug = companySlug?.trim().toLowerCase();

    if (!slug) {
      throw new BadRequestException('Falta la empresa.');
    }

    const { data, error } = await this.supabaseService
      .getClient()
      .from('companies')
      .select('id, slug, name')
      .eq('slug', slug)
      .eq('status', 'active')
      .maybeSingle();

    if (error || !data) {
      throw new BadRequestException(
        error?.message || 'No existe una empresa activa con ese identificador.',
      );
    }

    return data as { id: string; slug: string; name: string };
  }

  private toIntegration(
    item: {
      key: string;
      provider: string;
      integrationType: string;
      name: string;
      description: string;
      connectionReady: boolean;
    },
    row: IntegrationRow,
  ) {
    const config = this.toRecord(row.config);
    const health = this.healthDetails(row, config);
    const displayStatus =
      row.provider === 'meta' &&
      row.integration_type === 'whatsapp' &&
      row.status === 'active' &&
      health.status === 'error'
        ? 'error'
        : row.status;

    return {
      id: row.id,
      key: item.key,
      provider: row.provider,
      integrationType: row.integration_type,
      name: item.name,
      description: item.description,
      status: displayStatus,
      statusLabel: this.statusLabel(displayStatus),
      connectionReady: item.connectionReady,
      credentialMode: row.credential_mode,
      details: this.safeDetails(row, config),
      health,
      connectedAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private safeDetails(row: IntegrationRow, config: JsonObject) {
    const apiVersion = this.text(config.api_version);
    const displayName =
      this.text(config.display_name) ||
      this.text(config.verified_name) ||
      this.text(config.shop_name);
    const storeUrl = this.text(config.store_url);

    return {
      displayName: displayName || null,
      storeUrl: storeUrl || null,
      apiVersion: apiVersion || null,
      phoneNumberId:
        row.provider === 'meta' && row.integration_type === 'whatsapp'
          ? row.external_id
          : null,
      businessAccountId: this.text(config.business_account_id) || null,
      setupSource:
        row.credential_mode === 'environment'
          ? 'Configuración técnica existente'
          : 'Credenciales protegidas',
    };
  }

  private async refreshWhatsappHealth(
    rows: IntegrationRow[],
  ): Promise<void> {
    const row = rows.find(
      (candidate) =>
        candidate.provider === 'meta' &&
        candidate.integration_type === 'whatsapp' &&
        candidate.status === 'active',
    );

    if (!row) return;

    const currentConfig = this.toRecord(row.config);
    const checkedAt = new Date().toISOString();
    let nextConfig: JsonObject;

    try {
      const accessToken = this.integrationAccessToken(row);
      const apiVersion = this.text(currentConfig.api_version) || 'v25.0';
      const response = await fetch(
        `https://graph.facebook.com/${apiVersion}/${row.external_id}?fields=id,display_phone_number,verified_name,quality_rating`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: 'no-store',
        },
      );
      const raw = await response.text();

      if (!response.ok) {
        throw new Error(this.metaErrorMessage(raw, response.status));
      }

      const payload = this.parseJsonObject(raw);
      nextConfig = {
        ...currentConfig,
        meta_health_status: 'healthy',
        meta_health_checked_at: checkedAt,
        meta_health_error: null,
        display_phone_number:
          this.text(payload.display_phone_number) ||
          this.text(currentConfig.display_phone_number) ||
          null,
        verified_name:
          this.text(payload.verified_name) ||
          this.text(currentConfig.verified_name) ||
          null,
        quality_rating:
          this.text(payload.quality_rating) ||
          this.text(currentConfig.quality_rating) ||
          null,
      };
    } catch (error) {
      nextConfig = {
        ...currentConfig,
        meta_health_status: 'error',
        meta_health_checked_at: checkedAt,
        meta_health_error: this.safeError(error),
      };
    }

    row.config = nextConfig;

    const { error: saveError } = await this.supabaseService
      .getClient()
      .from('company_integrations')
      .update({ config: nextConfig })
      .eq('id', row.id);

    if (saveError) {
      console.error(
        `No se pudo guardar el estado técnico de WhatsApp: ${saveError.message}`,
      );
    }
  }

  private integrationAccessToken(row: IntegrationRow): string {
    if (row.credential_mode === 'environment') {
      const reference = this.toRecord(row.credential_reference);
      const tokenEnv = this.text(reference.access_token_env);
      const accessToken = tokenEnv
        ? process.env[tokenEnv]?.trim() ?? ''
        : '';

      if (!accessToken) {
        throw new Error(
          tokenEnv
            ? `Falta la variable segura ${tokenEnv}.`
            : 'Falta la referencia segura del token de WhatsApp.',
        );
      }

      return accessToken;
    }

    if (!row.credentials_encrypted) {
      throw new Error('La integración no tiene un token cifrado guardado.');
    }

    const credentials = this.credentialsService.decrypt(
      row.credentials_encrypted,
    );
    const accessToken = this.text(credentials.access_token);

    if (!accessToken) {
      throw new Error('No se encontró el token guardado de WhatsApp.');
    }

    return accessToken;
  }

  private healthDetails(row: IntegrationRow, config: JsonObject) {
    const configuredStatus = this.text(config.meta_health_status);
    const status =
      row.status === 'active' && configuredStatus === 'healthy'
        ? 'healthy'
        : row.status === 'active' && configuredStatus === 'error'
          ? 'error'
          : 'not_checked';
    const labels = {
      healthy: 'Conexión verificada',
      error: 'Meta requiere revisión',
      not_checked: 'Sin verificar',
    } as const;

    return {
      status,
      statusLabel: labels[status],
      checkedAt: this.text(config.meta_health_checked_at) || null,
      error: this.text(config.meta_health_error) || null,
      verifiedName: this.text(config.verified_name) || null,
      displayPhoneNumber: this.text(config.display_phone_number) || null,
      qualityRating: this.text(config.quality_rating) || null,
    };
  }

  private whatsappEmbeddedSettings() {
    return {
      appId: process.env.META_WHATSAPP_APP_ID?.trim() || '',
      appSecret: process.env.META_WHATSAPP_APP_SECRET?.trim() || '',
      configurationId:
        process.env.META_WHATSAPP_EMBEDDED_CONFIG_ID?.trim() || '',
      apiVersion: this.apiVersion(
        process.env.META_WHATSAPP_GRAPH_VERSION?.trim() || 'v25.0',
      ),
      sessionInfoVersion:
        process.env.META_WHATSAPP_EMBEDDED_SESSION_VERSION?.trim() || '3',
      flowVersion:
        process.env.META_WHATSAPP_EMBEDDED_FLOW_VERSION?.trim() || 'v3',
      featureType:
        process.env.META_WHATSAPP_EMBEDDED_FEATURE_TYPE?.trim() ||
        'whatsapp_business_app_onboarding',
    };
  }

  private async metaJson(
    url: URL,
    init: RequestInit,
    context: string,
  ): Promise<JsonObject> {
    const response = await fetch(url, {
      ...init,
      headers: {
        accept: 'application/json',
        ...(init.headers || {}),
      },
    });
    const raw = await response.text();

    if (!response.ok) {
      throw new BadRequestException(
        `${context}: ${this.metaErrorMessage(raw, response.status)}`,
      );
    }

    const payload = this.parseJsonObject(raw);

    if (!Object.keys(payload).length) {
      throw new BadRequestException(`${context}: Meta devolvió una respuesta vacía.`);
    }

    return payload;
  }

  private metaErrorMessage(raw: string, status: number): string {
    const payload = this.parseJsonObject(raw);
    const metaError = this.toRecord(payload.error);
    const message = this.text(metaError.message);
    const code = Number(metaError.code);

    return `${message || `Meta respondió HTTP ${status}`}${
      Number.isFinite(code) ? ` (código ${code})` : ''
    }`;
  }

  private parseJsonObject(value: string): JsonObject {
    try {
      const parsed: unknown = JSON.parse(value);
      return this.toRecord(parsed);
    } catch {
      return {};
    }
  }

  private safeError(value: unknown): string {
    const message =
      value instanceof Error ? value.message : 'No se pudo validar Meta.';
    return message.replace(/\s+/g, ' ').trim().slice(0, 500);
  }

  private statusLabel(
    status: 'pending' | 'active' | 'disconnected' | 'error',
  ) {
    const labels = {
      active: 'Activa',
      pending: 'Pendiente',
      disconnected: 'No conectada',
      error: 'Requiere revisión',
    };

    return labels[status];
  }

  private toRecord(value: unknown): JsonObject {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as JsonObject;
    }

    return {};
  }

  private text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private digits(value: unknown): string {
    return this.text(value).replace(/\D/g, '');
  }

  private apiVersion(value: unknown): string {
    const clean = this.text(value) || 'v25.0';

    if (!/^v\d+\.\d+$/.test(clean)) {
      throw new BadRequestException('La versión de Meta debe tener formato v25.0.');
    }

    return clean;
  }
}
