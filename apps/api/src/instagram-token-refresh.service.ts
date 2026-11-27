import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseService } from './supabase.service';
import { IntegrationCredentialsService } from './integration-credentials.service';

type InstagramIntegration = {
  id: string;
  company_id: string;
  external_id: string;
  credentials_encrypted: string | null;
  config: Record<string, unknown> | null;
};

export function instagramRefreshDue(
  expiresAt: unknown,
  now: number,
  windowDays = 14,
): boolean {
  if (typeof expiresAt !== 'string') return false;
  const expiry = Date.parse(expiresAt);
  return Number.isFinite(expiry) &&
    expiry > now &&
    expiry - now <= windowDays * 24 * 60 * 60 * 1000;
}

/**
 * Instagram Login long-lived tokens last ~60 days. They can be refreshed
 * only while valid. Check each tenant once per day and refresh before expiry.
 *
 * Never attempt to refresh an expired token: the account owner must
 * reconnect through the configured OAuth screen.
 */
@Injectable()
export class InstagramTokenRefreshService {
  private readonly logger = new Logger(InstagramTokenRefreshService.name);
  private running = false;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly credentialsService: IntegrationCredentialsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async refreshExpiringInstagramTokens(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const client = this.supabaseService.getClient();
      const { data, error } = await client
        .from('company_integrations')
        .select('id, company_id, external_id, credentials_encrypted, config')
        .eq('provider', 'meta')
        .eq('integration_type', 'instagram')
        .eq('status', 'active')
        .limit(500);

      if (error) {
        throw new Error(`No se pudieron consultar las integraciones: ${error.message}`);
      }

      for (const row of (data ?? []) as InstagramIntegration[]) {
        const config = row.config ?? {};
        if (
          config.setup_source !== 'instagram_login' ||
          !row.credentials_encrypted ||
          !instagramRefreshDue(config.token_expires_at, Date.now())
        ) continue;

        try {
          await this.refreshOne(row);
        } catch (err) {
          // A failed refresh must never overwrite existing credentials or
          // interrupt WhatsApp/Messenger and other companies.
          this.logger.warn(
            `No se renovó Instagram para empresa ${row.company_id}: ${err instanceof Error ? err.message : 'error desconocido'}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        'Fallo en la revisión preventiva de tokens de Instagram.',
        err instanceof Error ? err.stack : undefined,
      );
    } finally {
      this.running = false;
    }
  }

  private async refreshOne(row: InstagramIntegration): Promise<void> {
    const credentials = this.credentialsService.decrypt(
      row.credentials_encrypted!,
    );
    const previousToken =
      typeof credentials.access_token === 'string'
        ? credentials.access_token.trim()
        : '';
    if (!previousToken) throw new Error('No hay autorización cifrada para renovar.');

    const refreshUrl = new URL('https://graph.instagram.com/refresh_access_token');
    refreshUrl.searchParams.set('grant_type', 'ig_refresh_token');
    refreshUrl.searchParams.set('access_token', previousToken);

    const response = await fetch(refreshUrl, { method: 'GET', cache: 'no-store' });
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      const metaError = payload.error && typeof payload.error === 'object' &&
        !Array.isArray(payload.error)
        ? payload.error as Record<string, unknown>
        : {};
      // Never log returned URLs, token strings, or raw Meta payloads.
      throw new Error(`Meta rechazó renovación (HTTP ${response.status}, código ${Number(metaError.code) || 'n/d'})`);
    }

    const newToken = typeof payload.access_token === 'string'
      ? payload.access_token.trim()
      : '';
    const expiresIn = Number(payload.expires_in);
    if (!newToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new Error('Meta no devolvió una renovación válida.');
    }

    // Confirm that the refreshed credential still belongs to this tenant's
    // Instagram account before overwriting the existing encrypted token.
    const apiVersion =
      typeof row.config?.api_version === 'string' && row.config.api_version
        ? row.config.api_version
        : 'v25.0';
    const profileUrl = new URL(`https://graph.instagram.com/${apiVersion}/me`);
    profileUrl.searchParams.set('fields', 'user_id');
    const verified = await fetch(profileUrl, {
      headers: { Authorization: `Bearer ${newToken}` },
      cache: 'no-store',
    });
    if (!verified.ok) throw new Error('No se pudo verificar la cuenta después de renovar.');
    const profile = await verified.json() as { user_id?: string | number };
    if (String(profile.user_id ?? '') !== row.external_id) {
      throw new Error('La renovación no coincide con el Instagram autorizado.');
    }

    const now = Date.now();
    const nextConfig = {
      ...(row.config ?? {}),
      token_expires_at: new Date(now + expiresIn * 1000).toISOString(),
      token_refreshed_at: new Date(now).toISOString(),
      meta_health_status: 'healthy',
      meta_health_checked_at: new Date(now).toISOString(),
      meta_health_error: null,
    };

    const { data: updated, error } = await this.supabaseService.getClient()
      .from('company_integrations')
      .update({
        credentials_encrypted: this.credentialsService.encrypt({
          ...credentials,
          access_token: newToken,
        }),
        config: nextConfig,
        updated_at: new Date(now).toISOString(),
      })
      .eq('id', row.id)
      .eq('company_id', row.company_id)
      .eq('provider', 'meta')
      .eq('integration_type', 'instagram')
      .eq('status', 'active')
      // If the user reconnects while we are refreshing, do not overwrite
      // their new credentials with this older refresh result.
      .eq('credentials_encrypted', row.credentials_encrypted!)
      .select('id');

    if (error) throw new Error(`No se pudo guardar el token renovado: ${error.message}`);
    if (!updated?.length) {
      this.logger.log(`Renovación obsoleta ignorada para empresa ${row.company_id}`);
      return;
    }
    this.logger.log(`Autorización Instagram renovada para empresa ${row.company_id}`);
  }
}
