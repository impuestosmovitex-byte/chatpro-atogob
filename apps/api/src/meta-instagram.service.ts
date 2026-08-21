import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';

import { IntegrationCredentialsService } from './integration-credentials.service';
import { SupabaseService } from './supabase.service';

type JsonObject = Record<string, unknown>;

@Injectable()
export class MetaInstagramService {
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
      appId: settings.appId || null,
      apiVersion: settings.apiVersion,
      scopes: [
        'pages_show_list',
        'pages_manage_metadata',
        'pages_read_engagement',
        'instagram_basic',
        'instagram_manage_messages',
      ],
      missing,
    };
  }

  async exchangeAuthorizationCode(
    codeInput: unknown,
    redirectUriInput: unknown,
  ) {
    const code = this.text(codeInput);
    const redirectUri = this.text(redirectUriInput);

    if (!code) {
      throw new BadRequestException(
        'Meta no devolvió un código de autorización.',
      );
    }

    if (
      !redirectUri ||
      !redirectUri.startsWith('https://')
    ) {
      throw new BadRequestException(
        'La URI de retorno de Instagram no es válida.',
      );
    }

    const settings = this.requireSettings();

    const url = new URL(
      `https://graph.facebook.com/${settings.apiVersion}/oauth/access_token`,
    );

    url.searchParams.set(
      'client_id',
      settings.appId,
    );

    url.searchParams.set(
      'client_secret',
      settings.appSecret,
    );

    url.searchParams.set(
      'redirect_uri',
      redirectUri,
    );

    url.searchParams.set(
      'code',
      code,
    );

    const payload =
      await this.metaJson(
        url,
        { method: 'GET' },
        'Meta no permitió completar la autorización de Instagram',
      );

    const accessToken =
      this.text(payload.access_token);

    if (
      !accessToken ||
      accessToken.length < 20
    ) {
      throw new BadRequestException(
        'Meta no devolvió una autorización válida.',
      );
    }

    await this.validateUserToken(
      accessToken,
    );

    return {
      accessToken,
    };
  }

  async discoverAccounts(
    accessTokenInput: unknown,
  ) {
    const accessToken =
      this.text(accessTokenInput);

    if (
      !accessToken ||
      accessToken.length < 20
    ) {
      throw new BadRequestException(
        'Meta no devolvió un token de autorización válido.',
      );
    }

    await this.validateUserToken(
      accessToken,
    );

    const pages =
      await this.getPagesWithInstagram(
        accessToken,
      );

    return pages
      .filter(
        (page) =>
          this.toRecord(
            page.instagram_business_account,
          ).id,
      )
      .map((page) => {
        const instagram =
          this.toRecord(
            page.instagram_business_account,
          );

        return {
          pageId:
            this.digits(page.id),
          pageName:
            this.text(page.name) ||
            'Página de Facebook',
          instagramId:
            this.digits(instagram.id),
          username:
            this.text(instagram.username),
          name:
            this.text(instagram.name),
        };
      });
  }

  async connect(input: {
    companyId: string;
    accessToken: unknown;
    instagramId: unknown;
  }) {
    const suppliedToken =
      this.text(input.accessToken);

    const requestedInstagramId =
      this.digits(input.instagramId);

    if (
      !suppliedToken ||
      suppliedToken.length < 20
    ) {
      throw new BadRequestException(
        'Meta no devolvió un token de autorización válido.',
      );
    }

    if (
      !requestedInstagramId ||
      requestedInstagramId.length < 6
    ) {
      throw new BadRequestException(
        'Selecciona una cuenta de Instagram válida.',
      );
    }

    await this.validateUserToken(
      suppliedToken,
    );

    const userAccessToken =
      await this.exchangeLongLivedUserToken(
        suppliedToken,
      );

    await this.validateUserToken(
      userAccessToken,
    );

    const pages =
      await this.getPagesWithInstagram(
        userAccessToken,
      );

    const selectedPage =
      pages.find((page) => {
        const instagram =
          this.toRecord(
            page.instagram_business_account,
          );

        return (
          this.digits(instagram.id) ===
          requestedInstagramId
        );
      });

    if (!selectedPage) {
      throw new BadRequestException(
        'La cuenta de Instagram seleccionada no pertenece a una Página autorizada.',
      );
    }

    const instagram =
      this.toRecord(
        selectedPage.instagram_business_account,
      );

    const instagramId =
      this.digits(instagram.id);

    const username =
      this.text(instagram.username);

    const instagramName =
      this.text(instagram.name) ||
      username ||
      'Instagram';

    const pageId =
      this.digits(selectedPage.id);

    const pageAccessToken =
      this.text(
        selectedPage.access_token,
      );

    if (
      !pageAccessToken ||
      pageAccessToken.length < 20
    ) {
      throw new BadRequestException(
        'Meta no devolvió un token válido para la Página vinculada a Instagram.',
      );
    }

    const client =
      this.supabaseService.getClient();

    const {
      data: existing,
      error: existingError,
    } =
      await client
        .from('company_integrations')
        .select('id, company_id')
        .eq('provider', 'meta')
        .eq(
          'integration_type',
          'instagram',
        )
        .eq(
          'external_id',
          instagramId,
        )
        .maybeSingle();

    if (existingError) {
      throw new BadRequestException(
        `No se pudo validar Instagram: ${existingError.message}`,
      );
    }

    if (
      existing &&
      existing.company_id !==
        input.companyId
    ) {
      throw new BadRequestException(
        'Esta cuenta de Instagram ya está conectada a otra empresa en ChatPro.',
      );
    }

    const now =
      new Date().toISOString();

    const settings =
      this.settings();

    const { error: saveError } =
      await client
        .from('company_integrations')
        .upsert(
          {
            company_id:
              input.companyId,

            provider: 'meta',

            integration_type:
              'instagram',

            external_id:
              instagramId,

            status: 'active',

            config: {
              api_version:
                settings.apiVersion,

              display_name:
                instagramName,

              username:
                username || null,

              instagram_id:
                instagramId,

              page_id:
                pageId,

              setup_source:
                'meta_facebook_login',

              meta_health_status:
                'healthy',

              meta_health_checked_at:
                now,

              meta_health_error:
                null,
            },

            credential_mode:
              'encrypted',

            credential_reference: {
              token_format:
                'meta_page_access_token',

              instagram_id:
                instagramId,

              page_id:
                pageId,
            },

            credentials_encrypted:
              this.credentialsService.encrypt({
                access_token:
                  pageAccessToken,
              }),

            updated_at:
              now,
          },
          {
            onConflict:
              'provider,integration_type,external_id',
          },
        );

    if (saveError) {
      throw new BadRequestException(
        `No se pudo guardar Instagram: ${saveError.message}`,
      );
    }

    await client
      .from('company_integrations')
      .update({
        status: 'disconnected',
        updated_at: now,
      })
      .eq(
        'company_id',
        input.companyId,
      )
      .eq(
        'provider',
        'meta',
      )
      .eq(
        'integration_type',
        'instagram',
      )
      .neq(
        'external_id',
        instagramId,
      )
      .eq(
        'status',
        'active',
      );

    return {
      instagramId,
      username:
        username || null,
      name: instagramName,
      pageId,
    };
  }

  private async getPagesWithInstagram(
    accessToken: string,
  ): Promise<JsonObject[]> {
    const settings =
      this.requireSettings();

    const url = new URL(
      `https://graph.facebook.com/${settings.apiVersion}/me/accounts`,
    );

    url.searchParams.set(
      'fields',
      [
        'id',
        'name',
        'access_token',
        'tasks',
        'instagram_business_account{id,username,name}',
      ].join(','),
    );

    url.searchParams.set(
      'limit',
      '100',
    );

    const payload =
      await this.metaJson(
        url,
        {
          method: 'GET',
          headers: {
            Authorization:
              `Bearer ${accessToken}`,
          },
        },
        'Meta no permitió consultar las cuentas de Instagram',
      );

    return Array.isArray(payload.data)
      ? payload.data.map((value) =>
          this.toRecord(value),
        )
      : [];
  }

  private async validateUserToken(
    accessToken: string,
  ) {
    const settings =
      this.requireSettings();

    const url = new URL(
      `https://graph.facebook.com/${settings.apiVersion}/debug_token`,
    );

    url.searchParams.set(
      'input_token',
      accessToken,
    );

    url.searchParams.set(
      'access_token',
      `${settings.appId}|${settings.appSecret}`,
    );

    const payload =
      await this.metaJson(
        url,
        { method: 'GET' },
        'Meta no permitió validar la autorización',
      );

    const data =
      this.toRecord(
        payload.data,
      );

    const valid =
      data.is_valid === true;

    const tokenAppId =
      String(
        data.app_id ?? '',
      ).trim();

    if (
      !valid ||
      tokenAppId !==
        settings.appId
    ) {
      throw new BadRequestException(
        'La autorización de Meta no es válida para esta aplicación.',
      );
    }
  }

  private async exchangeLongLivedUserToken(
    accessToken: string,
  ) {
    const settings =
      this.requireSettings();

    const url = new URL(
      `https://graph.facebook.com/${settings.apiVersion}/oauth/access_token`,
    );

    url.searchParams.set(
      'grant_type',
      'fb_exchange_token',
    );

    url.searchParams.set(
      'client_id',
      settings.appId,
    );

    url.searchParams.set(
      'client_secret',
      settings.appSecret,
    );

    url.searchParams.set(
      'fb_exchange_token',
      accessToken,
    );

    const payload =
      await this.metaJson(
        url,
        { method: 'GET' },
        'Meta no permitió extender la autorización',
      );

    const longLived =
      this.text(
        payload.access_token,
      );

    if (
      !longLived ||
      longLived.length < 20
    ) {
      throw new BadRequestException(
        'Meta no devolvió una autorización de larga duración.',
      );
    }

    return longLived;
  }

  private settings() {
    const rawVersion =
      process.env
        .META_MESSENGER_GRAPH_VERSION
        ?.trim() ||
      'v25.0';

    const apiVersion =
      /^v\d+\.\d+$/.test(
        rawVersion,
      )
        ? rawVersion
        : 'v25.0';

    return {
      appId:
        process.env
          .META_MESSENGER_APP_ID
          ?.trim() ||
        '',

      appSecret:
        process.env
          .META_MESSENGER_APP_SECRET
          ?.trim() ||
        '',

      apiVersion,
    };
  }

  private requireSettings() {
    const settings =
      this.settings();

    if (
      !settings.appId ||
      !settings.appSecret
    ) {
      throw new BadRequestException(
        'Falta configurar la aplicación de Meta para Instagram en Railway.',
      );
    }

    return settings;
  }

  private async metaJson(
    url: URL,
    init: RequestInit,
    context: string,
  ): Promise<JsonObject> {
    const response =
      await fetch(url, {
        ...init,
        headers: {
          accept:
            'application/json',
          ...(init.headers || {}),
        },
      });

    const raw =
      await response.text();

    const payload =
      this.parseJsonObject(raw);

    if (!response.ok) {
      const metaError =
        this.toRecord(
          payload.error,
        );

      const message =
        this.text(
          metaError.message,
        ) ||
        `Meta respondió HTTP ${response.status}`;

      throw new BadRequestException(
        `${context}: ${message}`,
      );
    }

    return payload;
  }

  private parseJsonObject(
    value: string,
  ): JsonObject {
    try {
      const parsed: unknown =
        JSON.parse(value);

      return this.toRecord(
        parsed,
      );
    } catch {
      return {};
    }
  }

  private toRecord(
    value: unknown,
  ): JsonObject {
    return (
      value &&
      typeof value ===
        'object' &&
      !Array.isArray(value)
        ? value as JsonObject
        : {}
    );
  }

  private text(
    value: unknown,
  ): string {
    return typeof value ===
      'string'
      ? value.trim()
      : '';
  }

  private digits(
    value: unknown,
  ): string {
    return this.text(
      value,
    ).replace(/\D/g, '');
  }
}
