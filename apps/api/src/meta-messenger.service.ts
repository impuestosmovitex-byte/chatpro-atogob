import { BadRequestException, Injectable } from '@nestjs/common';
import { IntegrationCredentialsService } from './integration-credentials.service';
import { SupabaseService } from './supabase.service';

type JsonObject = Record<string, unknown>;

@Injectable()
export class MetaMessengerService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly credentialsService: IntegrationCredentialsService,
  ) {}

  publicConfig() {
    const settings = this.settings();

    const missing: string[] = [];

    if (!settings.appId) {
      missing.push('META_MESSENGER_APP_ID');
    }

    if (!settings.appSecret) {
      missing.push('META_MESSENGER_APP_SECRET');
    }

    return {
      ready: missing.length === 0,
      appId: settings.appId,
      apiVersion: settings.apiVersion,
      scopes: [
        'pages_show_list',
        'pages_manage_metadata',
        'pages_messaging',
      ],
      missing,
    };
  }

  async discoverPages(accessTokenInput: unknown) {
    const accessToken = this.text(accessTokenInput);

    if (!accessToken || accessToken.length < 20) {
      throw new BadRequestException(
        'Meta no devolvió un token de autorización válido.',
      );
    }

    await this.validateUserToken(accessToken);

    const pages = await this.getPages(accessToken);

    return pages.map((page) => ({
      id: this.digits(page.id),
      name: this.text(page.name) || 'Página de Facebook',
      tasks: Array.isArray(page.tasks)
        ? page.tasks
            .map((value) => this.text(value))
            .filter(Boolean)
        : [],
    }));
  }

  async connect(input: {
    companyId: string;
    accessToken: unknown;
    pageId: unknown;
  }) {
    const suppliedToken = this.text(input.accessToken);
    const requestedPageId = this.digits(input.pageId);

    if (!suppliedToken || suppliedToken.length < 20) {
      throw new BadRequestException(
        'Meta no devolvió un token de autorización válido.',
      );
    }

    if (!requestedPageId || requestedPageId.length < 6) {
      throw new BadRequestException(
        'Selecciona una Página de Facebook válida.',
      );
    }

    await this.validateUserToken(suppliedToken);

    const userAccessToken =
      await this.exchangeLongLivedUserToken(suppliedToken);

    await this.validateUserToken(userAccessToken);

    const pages = await this.getPages(userAccessToken);

    const selectedPage = pages.find(
      (page) => this.digits(page.id) === requestedPageId,
    );

    if (!selectedPage) {
      throw new BadRequestException(
        'La Página seleccionada no pertenece a la cuenta autorizada.',
      );
    }

    const pageId = this.digits(selectedPage.id);
    const pageName =
      this.text(selectedPage.name) || 'Página de Facebook';
    const pageAccessToken = this.text(selectedPage.access_token);

    if (!pageAccessToken || pageAccessToken.length < 20) {
      throw new BadRequestException(
        'Meta no devolvió un token válido para la Página seleccionada.',
      );
    }

    await this.subscribePage(pageId, pageAccessToken);

    const client = this.supabaseService.getClient();

    const { data: existing, error: existingError } = await client
      .from('company_integrations')
      .select('id, company_id')
      .eq('provider', 'meta')
      .eq('integration_type', 'messenger')
      .eq('external_id', pageId)
      .maybeSingle();

    if (existingError) {
      throw new BadRequestException(
        `No se pudo validar Messenger: ${existingError.message}`,
      );
    }

    if (existing && existing.company_id !== input.companyId) {
      throw new BadRequestException(
        'Esta Página de Facebook ya está conectada a otra empresa en ChatPro.',
      );
    }

    const now = new Date().toISOString();
    const settings = this.settings();

    const { error: saveError } = await client
      .from('company_integrations')
      .upsert(
        {
          company_id: input.companyId,
          provider: 'meta',
          integration_type: 'messenger',
          external_id: pageId,
          status: 'active',
          config: {
            api_version: settings.apiVersion,
            display_name: pageName,
            page_id: pageId,
            setup_source: 'meta_facebook_login',
            meta_health_status: 'healthy',
            meta_health_checked_at: now,
            meta_health_error: null,
          },
          credential_mode: 'encrypted',
          credential_reference: {
            token_format: 'meta_page_access_token',
            page_id: pageId,
          },
          credentials_encrypted: this.credentialsService.encrypt({
            access_token: pageAccessToken,
          }),
          updated_at: now,
        },
        {
          onConflict: 'provider,integration_type,external_id',
        },
      );

    if (saveError) {
      throw new BadRequestException(
        `No se pudo guardar Messenger: ${saveError.message}`,
      );
    }

    const { error: disconnectError } = await client
      .from('company_integrations')
      .update({
        status: 'disconnected',
        updated_at: now,
      })
      .eq('company_id', input.companyId)
      .eq('provider', 'meta')
      .eq('integration_type', 'messenger')
      .neq('external_id', pageId)
      .eq('status', 'active');

    if (disconnectError) {
      throw new BadRequestException(
        `Messenger quedó conectado, pero no se pudo cerrar la conexión anterior: ${disconnectError.message}`,
      );
    }

    return {
      pageId,
      pageName,
    };
  }

  private async validateUserToken(accessToken: string) {
    const settings = this.requireSettings();

    const url = new URL(
      `https://graph.facebook.com/${settings.apiVersion}/debug_token`,
    );

    url.searchParams.set('input_token', accessToken);
    url.searchParams.set(
      'access_token',
      `${settings.appId}|${settings.appSecret}`,
    );

    const payload = await this.metaJson(
      url,
      { method: 'GET' },
      'Meta no permitió validar la autorización',
    );

    const data = this.toRecord(payload.data);
    const valid = data.is_valid === true;
    const tokenAppId = String(data.app_id ?? '').trim();

    if (!valid || tokenAppId !== settings.appId) {
      throw new BadRequestException(
        'La autorización de Meta no es válida para esta aplicación.',
      );
    }
  }

  private async exchangeLongLivedUserToken(accessToken: string) {
    const settings = this.requireSettings();

    const url = new URL(
      `https://graph.facebook.com/${settings.apiVersion}/oauth/access_token`,
    );

    url.searchParams.set('grant_type', 'fb_exchange_token');
    url.searchParams.set('client_id', settings.appId);
    url.searchParams.set('client_secret', settings.appSecret);
    url.searchParams.set('fb_exchange_token', accessToken);

    const payload = await this.metaJson(
      url,
      { method: 'GET' },
      'Meta no permitió extender la autorización',
    );

    const longLived = this.text(payload.access_token);

    if (!longLived || longLived.length < 20) {
      throw new BadRequestException(
        'Meta no devolvió una autorización de larga duración.',
      );
    }

    return longLived;
  }

  private async getPages(accessToken: string): Promise<JsonObject[]> {
    const settings = this.requireSettings();

    const url = new URL(
      `https://graph.facebook.com/${settings.apiVersion}/me/accounts`,
    );

    url.searchParams.set(
      'fields',
      'id,name,access_token,tasks',
    );
    url.searchParams.set('limit', '100');

    const payload = await this.metaJson(
      url,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      'Meta no permitió consultar las Páginas autorizadas',
    );

    return Array.isArray(payload.data)
      ? payload.data.map((value) => this.toRecord(value))
      : [];
  }

  private async subscribePage(
    pageId: string,
    pageAccessToken: string,
  ) {
    const settings = this.requireSettings();

    const url = new URL(
      `https://graph.facebook.com/${settings.apiVersion}/${pageId}/subscribed_apps`,
    );

    url.searchParams.set(
      'subscribed_fields',
      'messages,messaging_postbacks',
    );

    const payload = await this.metaJson(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pageAccessToken}`,
        },
      },
      'Meta no permitió suscribir la Página a Messenger',
    );

    if (payload.success !== true) {
      throw new BadRequestException(
        'Meta no confirmó la suscripción de Messenger.',
      );
    }
  }

  private settings() {
    const rawVersion =
      process.env.META_MESSENGER_GRAPH_VERSION?.trim() ||
      process.env.META_WHATSAPP_GRAPH_VERSION?.trim() ||
      'v25.0';

    const apiVersion = /^v\d+\.\d+$/.test(rawVersion)
      ? rawVersion
      : 'v25.0';

    return {
      appId:
        process.env.META_MESSENGER_APP_ID?.trim() ||
        process.env.META_WHATSAPP_APP_ID?.trim() ||
        '',
      appSecret:
        process.env.META_MESSENGER_APP_SECRET?.trim() ||
        process.env.META_WHATSAPP_APP_SECRET?.trim() ||
        '',
      apiVersion,
    };
  }

  private requireSettings() {
    const settings = this.settings();

    if (!settings.appId || !settings.appSecret) {
      throw new BadRequestException(
        'Falta configurar la aplicación de Meta para Messenger en Railway.',
      );
    }

    return settings;
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
    const payload = this.parseJsonObject(raw);

    if (!response.ok) {
      const metaError = this.toRecord(payload.error);
      const message =
        this.text(metaError.message) ||
        `Meta respondió HTTP ${response.status}`;

      throw new BadRequestException(
        `${context}: ${message}`,
      );
    }

    return payload;
  }

  private parseJsonObject(value: string): JsonObject {
    try {
      const parsed: unknown = JSON.parse(value);
      return this.toRecord(parsed);
    } catch {
      return {};
    }
  }

  private toRecord(value: unknown): JsonObject {
    return value &&
      typeof value === 'object' &&
      !Array.isArray(value)
      ? (value as JsonObject)
      : {};
  }

  private text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private digits(value: unknown): string {
    return this.text(value).replace(/\D/g, '');
  }
}
