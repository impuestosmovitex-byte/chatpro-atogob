import { Injectable, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { IntegrationCredentialsService } from './integration-credentials.service';
import { SupabaseService } from './supabase.service';

type JsonObject = Record<string, unknown>;

const TARGET_COMPANY_SLUG = 'emprende-con-maogo';
const REFRESH_INTERVAL_MS = 15 * 60 * 1000;

@Injectable()
export class MetaAdsReferralSubscriptionService implements OnModuleInit {
  private running = false;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly credentialsService: IntegrationCredentialsService,
  ) {}

  onModuleInit(): void {
    setTimeout(() => {
      void this.ensureSubscriptions();
    }, 5000);
  }

  @Interval(REFRESH_INTERVAL_MS)
  async scheduledRefresh(): Promise<void> {
    await this.ensureSubscriptions();
  }

  private async ensureSubscriptions(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const client = this.supabaseService.getClient();
      const { data: company, error: companyError } = await client
        .from('companies')
        .select('id')
        .eq('slug', TARGET_COMPANY_SLUG)
        .eq('status', 'active')
        .maybeSingle();

      if (companyError || !company?.id) {
        if (companyError) {
          console.error(
            `[ChatPro][MetaAds] No se pudo preparar suscripción de referrals: ${companyError.message}`,
          );
        }
        return;
      }

      const { data: integrations, error: integrationsError } = await client
        .from('company_integrations')
        .select(
          'id, integration_type, external_id, config, credentials_encrypted, status',
        )
        .eq('company_id', company.id)
        .eq('provider', 'meta')
        .eq('status', 'active')
        .in('integration_type', ['instagram', 'messenger']);

      if (integrationsError) {
        throw new Error(
          `No se pudieron consultar integraciones Meta: ${integrationsError.message}`,
        );
      }

      for (const raw of integrations ?? []) {
        const type = this.text(raw.integration_type);
        const externalId = this.digits(raw.external_id);
        const encrypted = this.text(raw.credentials_encrypted);
        const config = this.record(raw.config);

        if (!externalId || !encrypted) continue;

        let token = '';
        try {
          const credentials = this.credentialsService.decrypt(encrypted);
          token = this.text(credentials.access_token);
        } catch (decryptError) {
          console.error(
            `[ChatPro][MetaAds] No se pudieron leer credenciales de ${type}:`,
            decryptError,
          );
          continue;
        }

        if (!token) continue;

        try {
          if (type === 'messenger') {
            await this.subscribeMessenger({
              pageId: externalId,
              accessToken: token,
              apiVersion: this.apiVersion(config),
            });
            continue;
          }

          if (type === 'instagram') {
            const setupSource = this.text(config.setup_source);

            // Instagram Login usa el endpoint propio de Instagram y requiere
            // messaging_referral para recibir el contexto de anuncios/referrals.
            if (setupSource === 'instagram_login') {
              await this.subscribeInstagramLogin({
                accessToken: token,
                apiVersion: this.apiVersion(config),
              });
            }
          }
        } catch (subscriptionError) {
          // Nunca bloqueamos mensajes existentes por un problema de atribución.
          console.error(
            `[ChatPro][MetaAds] No se pudo asegurar referral ${type} ${externalId}:`,
            subscriptionError,
          );
        }
      }
    } catch (error) {
      console.error(
        '[ChatPro][MetaAds] Falló la actualización de suscripciones de referrals:',
        error,
      );
    } finally {
      this.running = false;
    }
  }

  private async subscribeMessenger(input: {
    pageId: string;
    accessToken: string;
    apiVersion: string;
  }): Promise<void> {
    const url = new URL(
      `https://graph.facebook.com/${input.apiVersion}/${encodeURIComponent(
        input.pageId,
      )}/subscribed_apps`,
    );
    url.searchParams.set(
      'subscribed_fields',
      'messages,messaging_postbacks,messaging_referrals',
    );
    url.searchParams.set('access_token', input.accessToken);

    await this.expectSuccess(url, 'Messenger');
  }

  private async subscribeInstagramLogin(input: {
    accessToken: string;
    apiVersion: string;
  }): Promise<void> {
    const url = new URL(
      `https://graph.instagram.com/${input.apiVersion}/me/subscribed_apps`,
    );
    url.searchParams.set(
      'subscribed_fields',
      'messages,messaging_postbacks,messaging_referral',
    );
    url.searchParams.set('access_token', input.accessToken);

    await this.expectSuccess(url, 'Instagram');
  }

  private async expectSuccess(url: URL, label: string): Promise<void> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { accept: 'application/json' },
    });
    const raw = await response.text();
    let payload: JsonObject = {};

    try {
      payload = this.record(JSON.parse(raw));
    } catch {
      payload = {};
    }

    if (!response.ok || payload.success !== true) {
      const metaError = this.record(payload.error);
      const detail =
        this.text(metaError.message) ||
        raw.trim().slice(0, 500) ||
        `HTTP ${response.status}`;
      throw new Error(`${label}: ${detail}`);
    }

    console.log(
      `[ChatPro][MetaAds] referral webhook activo para ${label}.`,
    );
  }

  private apiVersion(config: JsonObject): string {
    const value = this.text(config.api_version);
    return /^v\d+\.\d+$/.test(value) ? value : 'v25.0';
  }

  private record(value: unknown): JsonObject {
    return value && typeof value === 'object' && !Array.isArray(value)
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
