import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from './supabase.service';

type JsonObject = Record<string, unknown>;

export type AutomationKey =
  | 'abandoned_cart'
  | 'order_created'
  | 'payment_confirmed'
  | 'fulfillment_created';

export type AutomationDefinition = {
  id: string;
  companyId: string;
  key: AutomationKey;
  name: string;
  description: string;
  enabled: boolean;
  timezone: string;
  allowedDays: number[];
  sendWindowStart: string;
  sendWindowEnd: string;
  maxAttempts: number;
  retryDelayMinutes: number;
  config: JsonObject;
  updatedAt: string | null;
};

export type AutomationClaim = {
  claimed: boolean;
  reason:
    | 'claimed'
    | 'disabled'
    | 'outside_window'
    | 'sent'
    | 'cancelled'
    | 'locked'
    | 'waiting_retry'
    | 'attempts_exhausted';
  executionId: string | null;
  attemptCount: number;
  maxAttempts: number;
  retryDelayMinutes: number;
};

const DEFAULT_AUTOMATIONS: Array<{
  key: AutomationKey;
  name: string;
  description: string;
}> = [
  {
    key: 'abandoned_cart',
    name: 'Carrito abandonado',
    description: 'Recupera compras que quedaron abiertas en Shopify.',
  },
  {
    key: 'order_created',
    name: 'Confirmación de pedido',
    description: 'Confirma automáticamente que el pedido fue recibido.',
  },
  {
    key: 'payment_confirmed',
    name: 'Pago confirmado',
    description: 'Avisa al cliente cuando Shopify confirma el pago.',
  },
  {
    key: 'fulfillment_created',
    name: 'Guía o envío creado',
    description: 'Envía la transportadora y la guía cuando estén disponibles.',
  },
];

@Injectable()
export class AutomationRuntimeService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async listDashboard(companyId: string) {
    await this.ensureDefaults(companyId);
    const client = this.supabaseService.getClient();

    const [
      automationResult,
      executionResult,
      recoveryResult,
      settingsResult,
    ] = await Promise.all([
      client
        .from('company_automations')
        .select(
          'id, company_id, automation_key, name, description, enabled, timezone, allowed_days, send_window_start, send_window_end, max_attempts, retry_delay_minutes, config, updated_at',
        )
        .eq('company_id', companyId)
        .order('created_at', { ascending: true }),
      client
        .from('automation_executions')
        .select(
          'id, automation_key, event_key, channel, recipient, status, attempt_count, scheduled_for, next_retry_at, sent_at, failed_at, error_message, payload, created_at',
        )
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(80),
      client
        .from('company_cart_recovery_rules')
        .select('sequence, delay_minutes, active')
        .eq('company_id', companyId)
        .eq('active', true)
        .order('sequence', { ascending: true }),
      client
        .from('company_settings')
        .select('settings')
        .eq('company_id', companyId)
        .maybeSingle(),
    ]);

    if (automationResult.error) {
      throw new BadRequestException(
        `No se pudieron consultar las automatizaciones: ${automationResult.error.message}`,
      );
    }

    if (executionResult.error) {
      throw new BadRequestException(
        `No se pudo consultar el historial: ${executionResult.error.message}`,
      );
    }

    if (recoveryResult.error) {
      throw new BadRequestException(
        `No se pudo consultar la programación del carrito: ${recoveryResult.error.message}`,
      );
    }

    if (settingsResult.error) {
      throw new BadRequestException(
        `No se pudo consultar el modo de prueba: ${settingsResult.error.message}`,
      );
    }

    const settings = this.object(settingsResult.data?.settings);
    const allowedTestPhones = this.testPhones(settings);

    const automations = (automationResult.data ?? []).map((row) =>
      this.mapDefinition(row),
    );
    const executions = (executionResult.data ?? []).map((row: any) => {
      const payload = this.object(row.payload);

      return {
        id: row.id,
        automationKey: row.automation_key,
        eventKey: row.event_key,
        channel: row.channel,
        recipient: row.recipient,
        status: row.status,
        attemptCount: Number(row.attempt_count ?? 0),
        scheduledFor: row.scheduled_for,
        nextRetryAt: row.next_retry_at,
        sentAt: row.sent_at,
        failedAt: row.failed_at,
        error: this.text(row.error_message) || null,
        preparedOnly: payload.prepared_only === true,
        preparedMessage:
          this.text(payload.prepared_message) || null,
        testSendAllowed:
          payload.prepared_only === true &&
          typeof row.recipient === 'string' &&
          allowedTestPhones.includes(row.recipient) &&
          row.status !== 'sent',
        orderNumber: this.text(payload.order_number) || null,
        sourceTopic: this.text(payload.source_topic) || null,
        createdAt: row.created_at,
      };
    });

    return {
      automations,
      executions,
      testSafety: {
        enabled: allowedTestPhones.length > 0,
        allowedPhones: allowedTestPhones,
      },
      abandonedCartSchedule: (recoveryResult.data ?? []).map(
        (row: any) => ({
          sequence: Number(row.sequence ?? 0),
          delayMinutes: Number(row.delay_minutes ?? 0),
        }),
      ),
      summary: {
        enabled: automations.filter((item) => item.enabled).length,
        sent: executions.filter((item) => item.status === 'sent').length,
        failed: executions.filter((item) => item.status === 'failed').length,
        pending: executions.filter((item) =>
          ['pending', 'running'].includes(item.status),
        ).length,
      },
    };
  }

  async updateDefinition(
    companyId: string,
    key: string,
    input: Record<string, unknown>,
  ): Promise<AutomationDefinition> {
    const automationKey = this.validKey(key);
    await this.ensureDefaults(companyId);

    const timezone = 'America/Bogota';
    const sendWindowStart = '00:00';
    const sendWindowEnd = '00:00';
    const maxAttempts = this.boundedInt(input.maxAttempts, 3, 1, 10);
    const retryDelayMinutes = this.boundedInt(
      input.retryDelayMinutes,
      15,
      1,
      1440,
    );
    const allowedDays = [0, 1, 2, 3, 4, 5, 6];
    const enabled = input.enabled === true;
    const now = new Date().toISOString();

    const { data, error } = await this.supabaseService
      .getClient()
      .from('company_automations')
      .update({
        enabled,
        timezone,
        allowed_days: allowedDays,
        send_window_start: sendWindowStart,
        send_window_end: sendWindowEnd,
        max_attempts: maxAttempts,
        retry_delay_minutes: retryDelayMinutes,
        updated_at: now,
      })
      .eq('company_id', companyId)
      .eq('automation_key', automationKey)
      .select(
        'id, company_id, automation_key, name, description, enabled, timezone, allowed_days, send_window_start, send_window_end, max_attempts, retry_delay_minutes, config, updated_at',
      )
      .single();

    if (error || !data) {
      throw new BadRequestException(
        `No se pudo actualizar la automatización: ${
          error?.message ?? 'registro no encontrado'
        }`,
      );
    }

    if (automationKey === 'abandoned_cart') {
      await this.syncCartRecoverySettings(
        companyId,
        enabled,
        now,
      );
    }

    return this.mapDefinition(data);
  }

  async getDefinition(
    companyId: string,
    key: AutomationKey,
  ): Promise<AutomationDefinition> {
    await this.ensureDefaults(companyId);

    const { data, error } = await this.supabaseService
      .getClient()
      .from('company_automations')
      .select(
        'id, company_id, automation_key, name, description, enabled, timezone, allowed_days, send_window_start, send_window_end, max_attempts, retry_delay_minutes, config, updated_at',
      )
      .eq('company_id', companyId)
      .eq('automation_key', key)
      .single();

    if (error || !data) {
      throw new Error(
        `No se pudo consultar la automatización ${key}: ${
          error?.message ?? 'registro no encontrado'
        }`,
      );
    }

    return this.mapDefinition(data);
  }

  isInsideWindow(
    definition: AutomationDefinition,
    now: Date = new Date(),
  ): boolean {
    let parts: Intl.DateTimeFormatPart[];

    try {
      parts = new Intl.DateTimeFormat('en-US', {
        timeZone: definition.timezone,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(now);
    } catch {
      return false;
    }

    const values = new Map(parts.map((part) => [part.type, part.value]));
    const weekday = values.get('weekday') ?? '';
    const dayByName: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    const day = dayByName[weekday];
    const hour = Number(values.get('hour'));
    const minute = Number(values.get('minute'));

    if (
      !Number.isInteger(day) ||
      !Number.isFinite(hour) ||
      !Number.isFinite(minute) ||
      !definition.allowedDays.includes(day)
    ) {
      return false;
    }

    const current = hour * 60 + minute;
    const start = this.timeMinutes(definition.sendWindowStart);
    const end = this.timeMinutes(definition.sendWindowEnd);

    if (start === end) {
      return true;
    }

    if (start < end) {
      return current >= start && current < end;
    }

    return current >= start || current < end;
  }

  async claim(input: {
    companyId: string;
    automationKey: AutomationKey;
    eventKey: string;
    recipient: string | null;
    payload?: JsonObject;
  }): Promise<AutomationClaim> {
    const definition = await this.getDefinition(
      input.companyId,
      input.automationKey,
    );

    if (!definition.enabled) {
      return this.emptyClaim('disabled', definition);
    }

    const client = this.supabaseService.getClient();
    const now = new Date();
    const nowIso = now.toISOString();
    const worker =
      process.env.RAILWAY_REPLICA_ID?.trim() ||
      process.env.HOSTNAME?.trim() ||
      'chatpro-api';

    const { data: inserted, error: insertError } = await client
      .from('automation_executions')
      .insert({
        company_id: input.companyId,
        automation_id: definition.id,
        automation_key: input.automationKey,
        event_key: input.eventKey.trim(),
        channel: 'whatsapp',
        recipient: input.recipient,
        status: 'running',
        attempt_count: 1,
        scheduled_for: nowIso,
        locked_at: nowIso,
        locked_by: worker,
        payload: input.payload ?? {},
        updated_at: nowIso,
      })
      .select('id, status, attempt_count')
      .single();

    if (!insertError && inserted) {
      return {
        claimed: true,
        reason: 'claimed',
        executionId: inserted.id,
        attemptCount: Number(inserted.attempt_count ?? 1),
        maxAttempts: definition.maxAttempts,
        retryDelayMinutes: definition.retryDelayMinutes,
      };
    }

    if ((insertError as any)?.code !== '23505') {
      throw new Error(
        `No se pudo registrar la automatización: ${
          insertError?.message ?? 'error desconocido'
        }`,
      );
    }

    const { data: existing, error: existingError } = await client
      .from('automation_executions')
      .select(
        'id, status, attempt_count, next_retry_at, locked_at, sent_at',
      )
      .eq('company_id', input.companyId)
      .eq('automation_key', input.automationKey)
      .eq('event_key', input.eventKey.trim())
      .single();

    if (existingError || !existing) {
      throw new Error(
        `No se pudo revisar la ejecución existente: ${
          existingError?.message ?? 'registro no encontrado'
        }`,
      );
    }

    const attemptCount = Number(existing.attempt_count ?? 0);

    if (existing.status === 'sent' || existing.sent_at) {
      return {
        claimed: false,
        reason: 'sent',
        executionId: existing.id,
        attemptCount,
        maxAttempts: definition.maxAttempts,
        retryDelayMinutes: definition.retryDelayMinutes,
      };
    }

    if (existing.status === 'cancelled') {
      return this.existingClaim(
        'cancelled',
        existing.id,
        attemptCount,
        definition,
      );
    }

    if (attemptCount >= definition.maxAttempts) {
      return this.existingClaim(
        'attempts_exhausted',
        existing.id,
        attemptCount,
        definition,
      );
    }

    const lockedAt = Date.parse(existing.locked_at ?? '');
    const lockIsFresh =
      existing.status === 'running' &&
      Number.isFinite(lockedAt) &&
      now.getTime() - lockedAt < 15 * 60 * 1000;

    if (lockIsFresh) {
      return this.existingClaim(
        'locked',
        existing.id,
        attemptCount,
        definition,
      );
    }

    const nextRetryAt = Date.parse(existing.next_retry_at ?? '');

    if (
      existing.status === 'failed' &&
      Number.isFinite(nextRetryAt) &&
      nextRetryAt > now.getTime()
    ) {
      return this.existingClaim(
        'waiting_retry',
        existing.id,
        attemptCount,
        definition,
      );
    }

    const nextAttempt = attemptCount + 1;
    const { data: reclaimed, error: reclaimError } = await client
      .from('automation_executions')
      .update({
        status: 'running',
        attempt_count: nextAttempt,
        locked_at: nowIso,
        locked_by: worker,
        next_retry_at: null,
        failed_at: null,
        error_message: null,
        updated_at: nowIso,
      })
      .eq('id', existing.id)
      .eq('attempt_count', attemptCount)
      .select('id, attempt_count')
      .maybeSingle();

    if (reclaimError) {
      throw new Error(
        `No se pudo reintentar la automatización: ${reclaimError.message}`,
      );
    }

    if (!reclaimed) {
      return this.existingClaim(
        'locked',
        existing.id,
        attemptCount,
        definition,
      );
    }

    return {
      claimed: true,
      reason: 'claimed',
      executionId: reclaimed.id,
      attemptCount: Number(reclaimed.attempt_count ?? nextAttempt),
      maxAttempts: definition.maxAttempts,
      retryDelayMinutes: definition.retryDelayMinutes,
    };
  }

  async markSent(executionId: string): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.supabaseService
      .getClient()
      .from('automation_executions')
      .update({
        status: 'sent',
        sent_at: now,
        failed_at: null,
        next_retry_at: null,
        locked_at: null,
        locked_by: null,
        error_message: null,
        updated_at: now,
      })
      .eq('id', executionId);

    if (error) {
      throw new Error(
        `No se pudo cerrar la ejecución enviada: ${error.message}`,
      );
    }
  }

  async markFailed(
    executionId: string,
    errorValue: unknown,
    attemptCount: number,
    maxAttempts: number,
    retryDelayMinutes: number,
  ): Promise<void> {
    const now = new Date();
    const canRetry = attemptCount < maxAttempts;
    const nextRetryAt = canRetry
      ? new Date(
          now.getTime() + retryDelayMinutes * 60 * 1000,
        ).toISOString()
      : null;
    const message = this.errorMessage(errorValue);

    const { error } = await this.supabaseService
      .getClient()
      .from('automation_executions')
      .update({
        status: 'failed',
        failed_at: now.toISOString(),
        next_retry_at: nextRetryAt,
        locked_at: null,
        locked_by: null,
        error_message: message,
        updated_at: now.toISOString(),
      })
      .eq('id', executionId);

    if (error) {
      throw new Error(
        `No se pudo registrar el error de automatización: ${error.message}`,
      );
    }
  }

  private async syncCartRecoverySettings(
    companyId: string,
    enabled: boolean,
    now: string,
  ): Promise<void> {
    const client = this.supabaseService.getClient();
    const { data, error } = await client
      .from('company_settings')
      .select('settings')
      .eq('company_id', companyId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(
        `No se pudo sincronizar la activación del carrito: ${error.message}`,
      );
    }

    const settings = this.object(data?.settings);
    const wasEnabled = settings.cart_recovery_enabled === true;
    const nextSettings: JsonObject = {
      ...settings,
      cart_recovery_enabled: enabled,
    };

    if (enabled && !wasEnabled) {
      nextSettings.cart_recovery_activation_from = now;
      nextSettings.cart_recovery_last_sync_at = null;
    }

    const { error: saveError } = await client
      .from('company_settings')
      .upsert(
        {
          company_id: companyId,
          settings: nextSettings,
          updated_at: now,
        },
        { onConflict: 'company_id' },
      );

    if (saveError) {
      throw new BadRequestException(
        `No se pudo guardar la activación del carrito: ${saveError.message}`,
      );
    }
  }

  private async ensureDefaults(companyId: string): Promise<void> {
    const rows = DEFAULT_AUTOMATIONS.map((item) => ({
      company_id: companyId,
      automation_key: item.key,
      name: item.name,
      description: item.description,
      enabled: false,
    }));

    const { error } = await this.supabaseService
      .getClient()
      .from('company_automations')
      .upsert(rows, {
        onConflict: 'company_id,automation_key',
        ignoreDuplicates: true,
      });

    if (error) {
      throw new BadRequestException(
        `No se pudo preparar la configuración de automatizaciones: ${error.message}`,
      );
    }
  }

  private mapDefinition(row: any): AutomationDefinition {
    return {
      id: row.id,
      companyId: row.company_id,
      key: this.validKey(row.automation_key),
      name: this.text(row.name) || 'Automatización',
      description: this.text(row.description),
      enabled: row.enabled === true,
      timezone: this.text(row.timezone) || 'America/Bogota',
      allowedDays: Array.isArray(row.allowed_days)
        ? row.allowed_days
            .map((value: unknown) => Number(value))
            .filter(
              (value: number) =>
                Number.isInteger(value) && value >= 0 && value <= 6,
            )
        : [0, 1, 2, 3, 4, 5, 6],
      sendWindowStart: this.timeText(row.send_window_start, '08:00'),
      sendWindowEnd: this.timeText(row.send_window_end, '20:00'),
      maxAttempts: this.boundedInt(row.max_attempts, 3, 1, 10),
      retryDelayMinutes: this.boundedInt(
        row.retry_delay_minutes,
        15,
        1,
        1440,
      ),
      config: this.object(row.config),
      updatedAt: this.text(row.updated_at) || null,
    };
  }

  private emptyClaim(
    reason: 'disabled' | 'outside_window',
    definition: AutomationDefinition,
  ): AutomationClaim {
    return {
      claimed: false,
      reason,
      executionId: null,
      attemptCount: 0,
      maxAttempts: definition.maxAttempts,
      retryDelayMinutes: definition.retryDelayMinutes,
    };
  }

  private existingClaim(
    reason:
      | 'cancelled'
      | 'locked'
      | 'waiting_retry'
      | 'attempts_exhausted',
    executionId: string,
    attemptCount: number,
    definition: AutomationDefinition,
  ): AutomationClaim {
    return {
      claimed: false,
      reason,
      executionId,
      attemptCount,
      maxAttempts: definition.maxAttempts,
      retryDelayMinutes: definition.retryDelayMinutes,
    };
  }

  private validKey(value: unknown): AutomationKey {
    const key = this.text(value) as AutomationKey;

    if (!DEFAULT_AUTOMATIONS.some((item) => item.key === key)) {
      throw new BadRequestException('Automatización no válida.');
    }

    return key;
  }

  private validTimezone(value: unknown): string {
    const timezone = this.text(value) || 'America/Bogota';

    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    } catch {
      throw new BadRequestException('Zona horaria no válida.');
    }

    return timezone;
  }

  private validTime(value: unknown, errorMessage: string): string {
    const time = this.text(value);
    const match = time.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);

    if (!match) {
      throw new BadRequestException(errorMessage);
    }

    return `${match[1]}:${match[2]}`;
  }

  private timeText(value: unknown, fallback: string): string {
    const text = this.text(value);
    const match = text.match(/^([01]\d|2[0-3]):([0-5]\d)/);
    return match ? `${match[1]}:${match[2]}` : fallback;
  }

  private timeMinutes(value: string): number {
    const [hour, minute] = value.split(':').map(Number);
    return hour * 60 + minute;
  }

  private allowedDays(value: unknown): number[] {
    if (!Array.isArray(value)) {
      return [0, 1, 2, 3, 4, 5, 6];
    }

    const days = Array.from(
      new Set(
        value
          .map((item) => Number(item))
          .filter(
            (item) => Number.isInteger(item) && item >= 0 && item <= 6,
          ),
      ),
    ).sort((left, right) => left - right);

    if (!days.length) {
      throw new BadRequestException(
        'Selecciona al menos un día de envío.',
      );
    }

    return days;
  }

  private boundedInt(
    value: unknown,
    fallback: number,
    minimum: number,
    maximum: number,
  ): number {
    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
      return fallback;
    }

    return Math.min(Math.max(Math.floor(parsed), minimum), maximum);
  }

  private testPhones(settings: JsonObject): string[] {
    const recovery = this.object(settings.cart_recovery);
    const value =
      recovery.test_phones ??
      settings.cart_recovery_test_phones;
    const countryCode = (
      this.text(
        recovery.default_country_code ??
          settings.cart_recovery_default_country_code,
      ) || '57'
    ).replace(/\D/g, '');

    if (!Array.isArray(value)) {
      return [];
    }

    return Array.from(
      new Set(
        value
          .map((phone) => this.normalizeTestPhone(phone, countryCode))
          .filter((phone): phone is string => Boolean(phone)),
      ),
    );
  }

  private normalizeTestPhone(
    value: unknown,
    countryCode: string,
  ): string | null {
    const raw = this.text(value);
    const digits = raw.replace(/\D/g, '');

    if (!digits || digits.length < 8 || digits.length > 15) {
      return null;
    }

    if (raw.startsWith('+') || digits.length > 10) {
      return digits;
    }

    return digits.length === 10 && countryCode
      ? `${countryCode}${digits}`
      : null;
  }

  private object(value: unknown): JsonObject {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as JsonObject)
      : {};
  }

  private text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private errorMessage(value: unknown): string {
    const message =
      value instanceof Error ? value.message : 'Error desconocido.';
    return message.replace(/\s+/g, ' ').trim().slice(0, 700);
  }
}
