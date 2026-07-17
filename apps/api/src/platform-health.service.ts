import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CompanyIntegrationService } from './company-integration.service';
import { CompanyShopifyService } from './company-shopify.service';
import { SupabaseService } from './supabase.service';
import { WhatsappMessagingService } from './whatsapp-messaging.service';

type JsonObject = Record<string, unknown>;
type HealthStatus = 'healthy' | 'warning' | 'critical';

export type PlatformHealthCheck = {
  component: string;
  label: string;
  status: HealthStatus;
  summary: string;
  detail: string;
  latencyMs: number | null;
  checkedAt: string;
  metadata: JsonObject;
};

@Injectable()
export class PlatformHealthService {
  private readonly logger = new Logger(PlatformHealthService.name);
  private readonly runningCompanies = new Set<string>();
  private scheduledRunning = false;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly integrationService: CompanyIntegrationService,
    private readonly shopifyService: CompanyShopifyService,
    private readonly whatsappService: WhatsappMessagingService,
  ) {}

  @Cron('0 */5 * * * *')
  async scheduledCheck(): Promise<void> {
    if (this.scheduledRunning) return;
    this.scheduledRunning = true;

    try {
      const { data, error } = await this.supabaseService
        .getClient()
        .from('companies')
        .select('id')
        .limit(200);

      if (error) {
        throw new Error(
          `No se pudieron cargar las empresas: ${error.message}`,
        );
      }

      for (const company of data ?? []) {
        if (typeof company.id !== 'string') continue;

        try {
          await this.runChecks(company.id);
        } catch (error) {
          this.logger.error(
            `Falló la revisión de salud de ${company.id}: ${
              error instanceof Error ? error.message : 'error desconocido'
            }`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `No se pudo ejecutar la revisión programada: ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
    } finally {
      this.scheduledRunning = false;
    }
  }

  async dashboard(companyId: string, refresh = true) {
    let liveChecks: PlatformHealthCheck[] | null = null;

    if (refresh) {
      liveChecks = await this.runChecks(companyId);
    }

    const client = this.supabaseService.getClient();
    const [statesResult, incidentsResult] = await Promise.all([
      client
        .from('platform_health_states')
        .select(
          'component,label,status,summary,detail,latency_ms,metadata,checked_at,changed_at',
        )
        .eq('company_id', companyId)
        .order('component', { ascending: true }),
      client
        .from('platform_health_incidents')
        .select(
          'id,component,label,status,title,detail,started_at,last_seen_at,resolved_at,resolution_detail,metadata',
        )
        .eq('company_id', companyId)
        .order('started_at', { ascending: false })
        .limit(40),
    ]);

    if (statesResult.error) {
      throw new Error(
        `No se pudo consultar el estado de la plataforma: ${statesResult.error.message}`,
      );
    }

    if (incidentsResult.error) {
      throw new Error(
        `No se pudo consultar el historial de alertas: ${incidentsResult.error.message}`,
      );
    }

    const storedChecks = (statesResult.data ?? []).map((row: any) => ({
      component: String(row.component),
      label: String(row.label),
      status: this.healthStatus(row.status),
      summary: String(row.summary ?? ''),
      detail: String(row.detail ?? ''),
      latencyMs:
        Number.isFinite(Number(row.latency_ms))
          ? Number(row.latency_ms)
          : null,
      checkedAt: String(row.checked_at),
      changedAt: String(row.changed_at),
      metadata: this.object(row.metadata),
    }));

    const checks = liveChecks?.length ? liveChecks : storedChecks;
    const summary = {
      healthy: checks.filter((item) => item.status === 'healthy').length,
      warning: checks.filter((item) => item.status === 'warning').length,
      critical: checks.filter((item) => item.status === 'critical').length,
      total: checks.length,
    };

    return {
      checkedAt:
        checks
          .map((item) => Date.parse(item.checkedAt))
          .filter(Number.isFinite)
          .sort((a, b) => b - a)
          .map((value) => new Date(value).toISOString())[0] ??
        new Date().toISOString(),
      summary,
      checks,
      incidents: (incidentsResult.data ?? []).map((row: any) => ({
        id: String(row.id),
        component: String(row.component),
        label: String(row.label),
        status: this.healthStatus(row.status),
        title: String(row.title),
        detail: String(row.detail ?? ''),
        startedAt: String(row.started_at),
        lastSeenAt: String(row.last_seen_at),
        resolvedAt:
          typeof row.resolved_at === 'string' ? row.resolved_at : null,
        resolutionDetail:
          typeof row.resolution_detail === 'string'
            ? row.resolution_detail
            : null,
        metadata: this.object(row.metadata),
      })),
    };
  }

  async runChecks(companyId: string): Promise<PlatformHealthCheck[]> {
    if (this.runningCompanies.has(companyId)) {
      return this.readCurrentChecks(companyId);
    }

    this.runningCompanies.add(companyId);

    try {
      const checks = await Promise.all([
        this.checkApi(),
        this.checkDeployment(),
        this.checkSupabase(),
        this.checkWhatsapp(companyId),
        this.checkShopify(companyId),
        this.checkAutomations(companyId),
        this.checkCartRecovery(companyId),
      ]);

      for (const check of checks) {
        try {
          await this.persist(companyId, check);
        } catch (error) {
          this.logger.error(
            `No se pudo guardar ${check.component}: ${
              error instanceof Error ? error.message : 'error desconocido'
            }`,
          );
        }
      }

      return checks;
    } finally {
      this.runningCompanies.delete(companyId);
    }
  }

  private async checkApi(): Promise<PlatformHealthCheck> {
    return this.result(
      'api',
      'API ChatPro',
      'healthy',
      'API activa',
      'El proceso principal de ChatPro está respondiendo.',
      0,
      {
        node: process.version,
        uptimeSeconds: Math.floor(process.uptime()),
      },
    );
  }

  private async checkDeployment(): Promise<PlatformHealthCheck> {
    const domain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim() || '';
    const environment =
      process.env.RAILWAY_ENVIRONMENT_NAME?.trim() ||
      process.env.RAILWAY_ENVIRONMENT?.trim() ||
      '';
    const commit = process.env.RAILWAY_GIT_COMMIT_SHA?.trim() || '';
    const repository = process.env.RAILWAY_GIT_REPO_NAME?.trim() || '';

    if (domain || commit || environment) {
      return this.result(
        'deployment',
        'Railway y GitHub',
        'healthy',
        'Despliegue identificado',
        commit
          ? `Railway está ejecutando el commit ${commit.slice(0, 8)}.`
          : 'Railway está ejecutando el servicio de ChatPro.',
        0,
        {
          domain,
          environment,
          repository,
          commit: commit ? commit.slice(0, 12) : '',
        },
      );
    }

    return this.result(
      'deployment',
      'Railway y GitHub',
      'warning',
      'Sin metadatos de despliegue',
      'El servicio responde, pero Railway no expuso sus metadatos en este entorno.',
      0,
      {},
    );
  }

  private async checkSupabase(): Promise<PlatformHealthCheck> {
    return this.timed(
      'supabase',
      'Supabase',
      async () => {
        await this.supabaseService.checkConnection();

        return {
          summary: 'Base de datos conectada',
          detail: 'ChatPro puede consultar Supabase correctamente.',
          metadata: {},
        };
      },
      false,
    );
  }

  private async checkWhatsapp(
    companyId: string,
  ): Promise<PlatformHealthCheck> {
    const integration =
      await this.integrationService.getActiveIntegration(
        companyId,
        'meta',
        'whatsapp',
      );

    if (!integration) {
      return this.result(
        'whatsapp',
        'WhatsApp Meta',
        'warning',
        'WhatsApp no está activo',
        'La empresa no tiene una integración activa de WhatsApp.',
        null,
        {},
      );
    }

    return this.timed(
      'whatsapp',
      'WhatsApp Meta',
      async () => {
        const info = await this.withTimeout(
          this.whatsappService.checkConnection(companyId),
          12000,
          'Meta tardó demasiado en responder.',
        );

        return {
          summary: 'Token y número válidos',
          detail: info.displayPhoneNumber
            ? `Meta confirmó el número ${info.displayPhoneNumber}.`
            : 'Meta confirmó el token y el número configurado.',
          metadata: {
            phoneNumberId: info.phoneNumberId,
            displayPhoneNumber: info.displayPhoneNumber,
            verifiedName: info.verifiedName,
            qualityRating: info.qualityRating,
            apiVersion: info.apiVersion,
          },
        };
      },
      false,
    );
  }

  private async checkShopify(
    companyId: string,
  ): Promise<PlatformHealthCheck> {
    const integration =
      await this.integrationService.getActiveIntegration(
        companyId,
        'shopify',
        'store',
      );

    if (!integration) {
      return this.result(
        'shopify',
        'Shopify',
        'warning',
        'Shopify no está activo',
        'La empresa no tiene una tienda Shopify activa.',
        null,
        {},
      );
    }

    return this.timed(
      'shopify',
      'Shopify',
      async () => {
        const storefrontUrl = await this.withTimeout(
          this.shopifyService.getStorefrontUrl(companyId),
          15000,
          'Shopify tardó demasiado en responder.',
        );

        return {
          summary: 'Tienda conectada',
          detail: `Shopify respondió correctamente desde ${storefrontUrl}.`,
          metadata: { storefrontUrl },
        };
      },
      false,
    );
  }

  private async checkAutomations(
    companyId: string,
  ): Promise<PlatformHealthCheck> {
    const startedAt = Date.now();
    const since = new Date(
      Date.now() - 24 * 60 * 60 * 1000,
    ).toISOString();
    const client = this.supabaseService.getClient();
    const [definitionsResult, executionsResult] = await Promise.all([
      client
        .from('company_automations')
        .select('automation_key,enabled')
        .eq('company_id', companyId),
      client
        .from('automation_executions')
        .select(
          'automation_key,status,error_message,created_at,failed_at',
        )
        .eq('company_id', companyId)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

    if (definitionsResult.error) {
      return this.failure(
        'automations',
        'Automatizaciones',
        definitionsResult.error.message,
        startedAt,
      );
    }

    if (executionsResult.error) {
      return this.failure(
        'automations',
        'Automatizaciones',
        executionsResult.error.message,
        startedAt,
      );
    }

    const enabled = (definitionsResult.data ?? []).filter(
      (item: any) => item.enabled === true,
    );
    const failed = (executionsResult.data ?? []).filter(
      (item: any) => item.status === 'failed',
    );
    const status: HealthStatus =
      failed.length >= 5
        ? 'critical'
        : failed.length > 0
          ? 'warning'
          : 'healthy';

    return this.result(
      'automations',
      'Automatizaciones',
      status,
      failed.length
        ? `${failed.length} fallo${failed.length === 1 ? '' : 's'} en 24 horas`
        : 'Sin fallos recientes',
      `${enabled.length} automatización${
        enabled.length === 1 ? '' : 'es'
      } activa${enabled.length === 1 ? '' : 's'}.`,
      Date.now() - startedAt,
      {
        enabled: enabled.length,
        failedLast24Hours: failed.length,
        latestErrors: failed.slice(0, 3).map((item: any) => ({
          automationKey: item.automation_key,
          error: this.clean(item.error_message || 'Fallo sin detalle.'),
          failedAt: item.failed_at || item.created_at,
        })),
      },
    );
  }

  private async checkCartRecovery(
    companyId: string,
  ): Promise<PlatformHealthCheck> {
    const startedAt = Date.now();
    const client = this.supabaseService.getClient();
    const [automationResult, settingsResult] = await Promise.all([
      client
        .from('company_automations')
        .select('enabled')
        .eq('company_id', companyId)
        .eq('automation_key', 'abandoned_cart')
        .maybeSingle(),
      client
        .from('company_settings')
        .select('settings')
        .eq('company_id', companyId)
        .maybeSingle(),
    ]);

    if (automationResult.error) {
      return this.failure(
        'cart_recovery',
        'Carritos abandonados',
        automationResult.error.message,
        startedAt,
      );
    }

    if (settingsResult.error) {
      return this.failure(
        'cart_recovery',
        'Carritos abandonados',
        settingsResult.error.message,
        startedAt,
      );
    }

    if (automationResult.data?.enabled !== true) {
      return this.result(
        'cart_recovery',
        'Carritos abandonados',
        'healthy',
        'Automatización pausada',
        'El envío de carritos está pausado por configuración.',
        Date.now() - startedAt,
        { enabled: false },
      );
    }

    const settings = this.object(settingsResult.data?.settings);
    const lastSyncValue =
      typeof settings.cart_recovery_last_sync_at === 'string'
        ? settings.cart_recovery_last_sync_at
        : '';
    const lastSyncTime = Date.parse(lastSyncValue);

    if (!Number.isFinite(lastSyncTime)) {
      return this.result(
        'cart_recovery',
        'Carritos abandonados',
        'warning',
        'Sin sincronización registrada',
        'La automatización está activa, pero todavía no registra una sincronización.',
        Date.now() - startedAt,
        { enabled: true },
      );
    }

    const ageMinutes = Math.max(
      0,
      Math.round((Date.now() - lastSyncTime) / 60000),
    );
    const status: HealthStatus =
      ageMinutes > 30
        ? 'critical'
        : ageMinutes > 15
          ? 'warning'
          : 'healthy';

    return this.result(
      'cart_recovery',
      'Carritos abandonados',
      status,
      status === 'healthy'
        ? 'Sincronización activa'
        : `Última sincronización hace ${ageMinutes} minutos`,
      status === 'healthy'
        ? 'Shopify está siendo revisado dentro del tiempo esperado.'
        : 'La revisión de carritos está tardando más de lo esperado.',
      Date.now() - startedAt,
      {
        enabled: true,
        lastSyncAt: new Date(lastSyncTime).toISOString(),
        ageMinutes,
      },
    );
  }

  private async timed(
    component: string,
    label: string,
    task: () => Promise<{
      summary: string;
      detail: string;
      metadata: JsonObject;
    }>,
    optional: boolean,
  ): Promise<PlatformHealthCheck> {
    const startedAt = Date.now();

    try {
      const response = await task();

      return this.result(
        component,
        label,
        'healthy',
        response.summary,
        response.detail,
        Date.now() - startedAt,
        response.metadata,
      );
    } catch (error) {
      const detail = this.errorMessage(error);
      const isMissing =
        /no tiene|no hay una conexi[oó]n|no est[aá] activo/i.test(detail);

      return this.result(
        component,
        label,
        optional || isMissing ? 'warning' : 'critical',
        isMissing ? 'Integración no configurada' : 'Conexión fallando',
        detail,
        Date.now() - startedAt,
        {},
      );
    }
  }

  private failure(
    component: string,
    label: string,
    detail: string,
    startedAt: number,
  ): PlatformHealthCheck {
    return this.result(
      component,
      label,
      'critical',
      'No se pudo revisar',
      this.clean(detail),
      Date.now() - startedAt,
      {},
    );
  }

  private result(
    component: string,
    label: string,
    status: HealthStatus,
    summary: string,
    detail: string,
    latencyMs: number | null,
    metadata: JsonObject,
  ): PlatformHealthCheck {
    return {
      component,
      label,
      status,
      summary: this.clean(summary),
      detail: this.clean(detail),
      latencyMs,
      checkedAt: new Date().toISOString(),
      metadata,
    };
  }

  private async persist(
    companyId: string,
    check: PlatformHealthCheck,
  ): Promise<void> {
    const client = this.supabaseService.getClient();
    const { data: previous, error: previousError } = await client
      .from('platform_health_states')
      .select('status')
      .eq('company_id', companyId)
      .eq('component', check.component)
      .maybeSingle();

    if (previousError) {
      throw new Error(previousError.message);
    }

    const now = check.checkedAt;
    const changed =
      !previous || previous.status !== check.status;

    if (check.status === 'healthy') {
      const { error } = await client
        .from('platform_health_incidents')
        .update({
          resolved_at: now,
          last_seen_at: now,
          resolution_detail: check.summary,
          updated_at: now,
        })
        .eq('company_id', companyId)
        .eq('component', check.component)
        .is('resolved_at', null);

      if (error) throw new Error(error.message);
    } else {
      const { data: openIncident, error: openError } = await client
        .from('platform_health_incidents')
        .select('id')
        .eq('company_id', companyId)
        .eq('component', check.component)
        .is('resolved_at', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (openError) throw new Error(openError.message);

      if (openIncident?.id) {
        const { error } = await client
          .from('platform_health_incidents')
          .update({
            status: check.status,
            title: check.summary,
            detail: check.detail,
            last_seen_at: now,
            metadata: check.metadata,
            updated_at: now,
          })
          .eq('id', openIncident.id);

        if (error) throw new Error(error.message);
      } else {
        const { error } = await client
          .from('platform_health_incidents')
          .insert({
            company_id: companyId,
            component: check.component,
            label: check.label,
            status: check.status,
            title: check.summary,
            detail: check.detail,
            started_at: now,
            last_seen_at: now,
            metadata: check.metadata,
          });

        if (error) throw new Error(error.message);
      }
    }

    const { error: stateError } = await client
      .from('platform_health_states')
      .upsert(
        {
          company_id: companyId,
          component: check.component,
          label: check.label,
          status: check.status,
          summary: check.summary,
          detail: check.detail,
          latency_ms: check.latencyMs,
          metadata: check.metadata,
          checked_at: now,
          changed_at: changed ? now : undefined,
          updated_at: now,
        },
        { onConflict: 'company_id,component' },
      );

    if (stateError) throw new Error(stateError.message);
  }

  private async readCurrentChecks(
    companyId: string,
  ): Promise<PlatformHealthCheck[]> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('platform_health_states')
      .select(
        'component,label,status,summary,detail,latency_ms,metadata,checked_at',
      )
      .eq('company_id', companyId);

    if (error) return [];

    return (data ?? []).map((row: any) => ({
      component: String(row.component),
      label: String(row.label),
      status: this.healthStatus(row.status),
      summary: String(row.summary ?? ''),
      detail: String(row.detail ?? ''),
      latencyMs:
        Number.isFinite(Number(row.latency_ms))
          ? Number(row.latency_ms)
          : null,
      metadata: this.object(row.metadata),
      checkedAt: String(row.checked_at),
    }));
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    milliseconds: number,
    message: string,
  ): Promise<T> {
    let timer: NodeJS.Timeout | null = null;

    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(message)),
            milliseconds,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private healthStatus(value: unknown): HealthStatus {
    if (value === 'healthy' || value === 'critical') return value;
    return 'warning';
  }

  private errorMessage(error: unknown): string {
    return this.clean(
      error instanceof Error ? error.message : 'Error desconocido.',
    );
  }

  private clean(value: unknown): string {
    return String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1000);
  }

  private object(value: unknown): JsonObject {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as JsonObject)
      : {};
  }
}
