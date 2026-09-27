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
    const settings =
      this.instagramLoginSettings();

    const missing: string[] = [];

    if (!settings.appId) {
      missing.push(
        'META_INSTAGRAM_APP_ID',
      );
    }

    if (!settings.appSecret) {
      missing.push(
        'META_INSTAGRAM_APP_SECRET',
      );
    }

    return {
      ready: missing.length === 0,
      appId:
        settings.appId || null,
      apiVersion:
        settings.apiVersion,
      loginMode:
        'instagram_login',
      scopes: [
        'instagram_business_basic',
        'instagram_business_manage_messages',
      ],
      missing,
    };
  }

  async connectFromInstagramLoginCode(input: {
    companyId: string;
    code: unknown;
    redirectUri: unknown;
  }) {
    const code =
      this.text(input.code);

    const redirectUri =
      this.text(input.redirectUri);

    if (!code) {
      throw new BadRequestException(
        'Instagram no devolvió un código de autorización.',
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

    const settings =
      this.requireInstagramLoginSettings();

    const shortTokenBody =
      new URLSearchParams();

    shortTokenBody.set(
      'client_id',
      settings.appId,
    );

    shortTokenBody.set(
      'client_secret',
      settings.appSecret,
    );

    shortTokenBody.set(
      'grant_type',
      'authorization_code',
    );

    shortTokenBody.set(
      'redirect_uri',
      redirectUri,
    );

    shortTokenBody.set(
      'code',
      code,
    );

    const shortPayload =
      await this.metaJson(
        new URL(
          'https://api.instagram.com/oauth/access_token',
        ),
        {
          method: 'POST',
          headers: {
            'content-type':
              'application/x-www-form-urlencoded',
          },
          body:
            shortTokenBody.toString(),
        },
        'Instagram no permitió completar la autorización',
      );

    const shortAccessToken =
      this.text(
        shortPayload.access_token,
      );

    if (
      !shortAccessToken ||
      shortAccessToken.length < 20
    ) {
      throw new BadRequestException(
        'Instagram no devolvió un token de acceso válido.',
      );
    }

    const longTokenUrl =
      new URL(
        'https://graph.instagram.com/access_token',
      );

    longTokenUrl.searchParams.set(
      'grant_type',
      'ig_exchange_token',
    );

    longTokenUrl.searchParams.set(
      'client_secret',
      settings.appSecret,
    );

    longTokenUrl.searchParams.set(
      'access_token',
      shortAccessToken,
    );

    const longPayload =
      await this.metaJson(
        longTokenUrl,
        {
          method: 'GET',
        },
        'Instagram no permitió extender la autorización',
      );

    const accessToken =
      this.text(
        longPayload.access_token,
      );

    if (
      !accessToken ||
      accessToken.length < 20
    ) {
      throw new BadRequestException(
        'Instagram no devolvió una autorización de larga duración.',
      );
    }

    const expiresInRaw =
      Number(
        longPayload.expires_in,
      );

    const expiresIn =
      Number.isFinite(expiresInRaw) &&
      expiresInRaw > 0
        ? expiresInRaw
        : null;

    const profileUrl =
      new URL(
        `https://graph.instagram.com/${settings.apiVersion}/me`,
      );

    profileUrl.searchParams.set(
      'fields',
      [
        'id',
        'username',
        'name',
        'account_type',
        'profile_picture_url',
      ].join(','),
    );

    profileUrl.searchParams.set(
      'access_token',
      accessToken,
    );

    const profile =
      await this.metaJson(
        profileUrl,
        {
          method: 'GET',
        },
        'Instagram no permitió consultar la cuenta autorizada',
      );

    const instagramId =
      this.digits(profile.id);

    const username =
      this.text(profile.username);

    const instagramName =
      this.text(profile.name) ||
      username ||
      'Instagram';

    const rawAccountType =
      this.text(
        profile.account_type,
      ).toUpperCase();

    const accountType =
      rawAccountType === 'MEDIA_CREATOR'
        ? 'CREATOR'
        : rawAccountType;

    const profilePictureUrl =
      this.text(
        profile.profile_picture_url,
      );

    if (!instagramId) {
      throw new BadRequestException(
        'Instagram no devolvió el identificador de la cuenta autorizada.',
      );
    }

    if (
      accountType !== 'BUSINESS' &&
      accountType !== 'CREATOR'
    ) {
      throw new BadRequestException(
        'La cuenta debe ser profesional de Instagram: Empresa o Creador.',
      );
    }

    const subscribeUrl =
      new URL(
        `https://graph.instagram.com/${settings.apiVersion}/${encodeURIComponent(
          instagramId,
        )}/subscribed_apps`,
      );

    subscribeUrl.searchParams.set(
      'subscribed_fields',
      'messages,messaging_postbacks',
    );

    subscribeUrl.searchParams.set(
      'access_token',
      accessToken,
    );

    const subscription =
      await this.metaJson(
        subscribeUrl,
        {
          method: 'POST',
        },
        'Instagram no permitió suscribir la cuenta a los webhooks de mensajes',
      );

    if (
      subscription.success !== true
    ) {
      throw new BadRequestException(
        'Instagram no confirmó la suscripción de mensajes.',
      );
    }

    const client =
      this.supabaseService.getClient();

    const {
      data: existing,
      error: existingError,
    } =
      await client
        .from(
          'company_integrations',
        )
        .select(
          'id, company_id',
        )
        .eq(
          'provider',
          'meta',
        )
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

    const expiresAt =
      expiresIn
        ? new Date(
            Date.now() +
              expiresIn * 1000,
          ).toISOString()
        : null;

    const { error: saveError } =
      await client
        .from(
          'company_integrations',
        )
        .upsert(
          {
            company_id:
              input.companyId,

            provider:
              'meta',

            integration_type:
              'instagram',

            external_id:
              instagramId,

            status:
              'active',

            config: {
              api_version:
                settings.apiVersion,

              display_name:
                instagramName,

              username:
                username || null,

              instagram_id:
                instagramId,

              account_type:
                accountType,

              profile_picture_url:
                profilePictureUrl ||
                null,

              setup_source:
                'instagram_login',

              token_expires_at:
                expiresAt,

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
                'instagram_user_access_token',

              instagram_id:
                instagramId,
            },

            credentials_encrypted:
              this.credentialsService.encrypt(
                {
                  access_token:
                    accessToken,
                },
              ),

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

    const {
      error: disconnectError,
    } =
      await client
        .from(
          'company_integrations',
        )
        .update({
          status:
            'disconnected',
          updated_at:
            now,
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

    if (disconnectError) {
      throw new BadRequestException(
        `Instagram quedó conectado, pero no se pudo cerrar la conexión anterior: ${disconnectError.message}`,
      );
    }

    return {
      instagramId,
      username:
        username || null,
      name:
        instagramName,
      accountType,
      profilePictureUrl:
        profilePictureUrl ||
        null,
      expiresAt,
      setupSource:
        'instagram_login',
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


    await this.subscribeInstagramMessages({
      pageId,
      pageAccessToken,
    });

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


  private async subscribeInstagramMessages(input: {
    pageId: string;
    pageAccessToken: string;
  }): Promise<void> {
    const settings =
      this.requireSettings();

    const url = new URL(
      `https://graph.facebook.com/${settings.apiVersion}/${encodeURIComponent(
        input.pageId,
      )}/subscribed_apps`,
    );

    url.searchParams.set(
      'subscribed_fields',
      'messages',
    );

    url.searchParams.set(
      'access_token',
      input.pageAccessToken,
    );

    const payload =
      await this.metaJson(
        url,
        {
          method: 'POST',
        },
        'Meta no permitió suscribir Instagram a los webhooks de mensajes',
      );

    if (payload.success !== true) {
      throw new BadRequestException(
        'Meta no confirmó la suscripción de Instagram a los mensajes.',
      );
    }

    console.log(
      `[ChatPro][Instagram] Página suscrita a messages pageId=${input.pageId}`,
    );
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

    const scopes =
      Array.isArray(data.scopes)
        ? data.scopes
            .map((value) =>
              typeof value === 'string'
                ? value.trim()
                : '',
            )
            .filter(Boolean)
        : [];

    const granularScopes =
      Array.isArray(data.granular_scopes)
        ? data.granular_scopes
            .map((value) =>
              this.toRecord(value),
            )
            .map((value) =>
              this.text(value.scope),
            )
            .filter(Boolean)
        : [];

    const grantedScopes =
      Array.from(
        new Set([
          ...scopes,
          ...granularScopes,
        ]),
      );

    console.log(
      `[ChatPro][Instagram] permisos concedidos: ${grantedScopes.join(', ') || 'ninguno-visible'}`,
    );

    const requiredScopes = [
      'instagram_basic',
      'instagram_manage_messages',
      'pages_manage_metadata',
    ];

    const missingScopes =
      requiredScopes.filter(
        (scope) =>
          !grantedScopes.includes(scope),
      );

    if (missingScopes.length) {
      throw new BadRequestException(
        `Meta no concedió estos permisos necesarios para Instagram: ${missingScopes.join(', ')}`,
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

  private instagramLoginSettings() {
    const rawVersion =
      process.env
        .META_INSTAGRAM_GRAPH_VERSION
        ?.trim() ||
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
          .META_INSTAGRAM_APP_ID
          ?.trim() ||
        '',

      appSecret:
        process.env
          .META_INSTAGRAM_APP_SECRET
          ?.trim() ||
        '',

      apiVersion,
    };
  }

  private requireInstagramLoginSettings() {
    const settings =
      this.instagramLoginSettings();

    if (
      !settings.appId ||
      !settings.appSecret
    ) {
      throw new BadRequestException(
        'Falta configurar la aplicación de Instagram Login en Railway.',
      );
    }

    return settings;
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
