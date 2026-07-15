import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { SupabaseService } from './supabase.service';
import { WhatsappMessagingService } from './whatsapp-messaging.service';

type JsonObject = Record<string, unknown>;

type ExecutionRow = {
  id: string;
  company_id: string;
  automation_key: string;
  recipient: string | null;
  status: string;
  attempt_count: number | null;
  payload: unknown;
};

@Injectable()
export class AutomationTestSendService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly whatsappMessagingService: WhatsappMessagingService,
  ) {}

  async sendPrepared(companyId: string, executionId: string) {
    const client = this.supabaseService.getClient();
    const { data, error } = await client
      .from('automation_executions')
      .select(
        'id, company_id, automation_key, recipient, status, attempt_count, payload',
      )
      .eq('id', executionId.trim())
      .eq('company_id', companyId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(
        `No se pudo consultar el mensaje preparado: ${error.message}`,
      );
    }

    if (!data) {
      throw new BadRequestException(
        'No se encontró el mensaje preparado para esta empresa.',
      );
    }

    const execution = data as ExecutionRow;
    const payload = this.object(execution.payload);
    const message = this.text(payload.prepared_message);
    const recipient = this.normalizePhone(execution.recipient);

    if (payload.prepared_only !== true || !message) {
      throw new BadRequestException(
        'Este registro no contiene un mensaje preparado para pruebas.',
      );
    }

    if (
      execution.automation_key !== 'order_created' &&
      execution.automation_key !== 'fulfillment_created'
    ) {
      throw new BadRequestException(
        'Por ahora solo se prueban pedidos y guías de Shopify.',
      );
    }

    if (execution.status === 'sent') {
      throw new BadRequestException(
        'Este mensaje de prueba ya fue enviado.',
      );
    }

    if (!recipient) {
      throw new BadRequestException(
        'El mensaje no tiene un teléfono válido.',
      );
    }

    const allowedPhones = await this.allowedTestPhones(companyId);

    if (!allowedPhones.length) {
      throw new BadRequestException(
        'No hay teléfonos autorizados para pruebas. Configúralos en Configuración → IA → Recuperación de carritos.',
      );
    }

    if (!allowedPhones.includes(recipient)) {
      throw new BadRequestException(
        `En modo de prueba solo se puede enviar a: ${allowedPhones.join(', ')}.`,
      );
    }

    const attemptCount = Number(execution.attempt_count ?? 0);
    const nextAttempt = attemptCount + 1;
    const now = new Date().toISOString();

    const { data: locked, error: lockError } = await client
      .from('automation_executions')
      .update({
        status: 'running',
        attempt_count: nextAttempt,
        locked_at: now,
        locked_by: 'manual-test-send',
        failed_at: null,
        error_message: null,
        updated_at: now,
      })
      .eq('id', execution.id)
      .eq('attempt_count', attemptCount)
      .select('id')
      .maybeSingle();

    if (lockError) {
      throw new BadRequestException(
        `No se pudo iniciar la prueba: ${lockError.message}`,
      );
    }

    if (!locked) {
      throw new BadRequestException(
        'Otra prueba está procesando este mensaje. Actualiza el historial.',
      );
    }

    try {
      await this.whatsappMessagingService.sendText(
        companyId,
        recipient,
        message,
      );

      const sentAt = new Date().toISOString();
      const { error: sentError } = await client
        .from('automation_executions')
        .update({
          status: 'sent',
          sent_at: sentAt,
          failed_at: null,
          next_retry_at: null,
          locked_at: null,
          locked_by: null,
          error_message: null,
          payload: {
            ...payload,
            test_send: true,
            test_sent_at: sentAt,
            test_recipient: recipient,
          },
          updated_at: sentAt,
        })
        .eq('id', execution.id);

      if (sentError) {
        throw new Error(
          `Meta recibió el mensaje, pero no se pudo cerrar el historial: ${sentError.message}`,
        );
      }

      return {
        ok: true,
        message: 'Mensaje de prueba enviado al número autorizado.',
        executionId: execution.id,
        recipient,
      };
    } catch (caught) {
      const failedAt = new Date().toISOString();
      const errorMessage = this.errorMessage(caught);

      await client
        .from('automation_executions')
        .update({
          status: 'failed',
          failed_at: failedAt,
          locked_at: null,
          locked_by: null,
          error_message: errorMessage,
          updated_at: failedAt,
        })
        .eq('id', execution.id);

      throw new BadRequestException(errorMessage);
    }
  }

  private async allowedTestPhones(
    companyId: string,
  ): Promise<string[]> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('company_settings')
      .select('settings')
      .eq('company_id', companyId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(
        `No se pudo consultar el modo de prueba: ${error.message}`,
      );
    }

    const settings = this.object(data?.settings);
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
          .map((phone) =>
            this.normalizePhone(phone, countryCode),
          )
          .filter((phone): phone is string => Boolean(phone)),
      ),
    );
  }

  private normalizePhone(
    value: unknown,
    countryCode = '57',
  ): string | null {
    const raw = this.text(value);
    const digits = raw.replace(/\D/g, '');

    if (!digits || digits.length < 8 || digits.length > 15) {
      return null;
    }

    if (raw.startsWith('+') || digits.length > 10) {
      return digits;
    }

    if (digits.length === 10 && countryCode) {
      return `${countryCode}${digits}`;
    }

    return null;
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
    return (
      value instanceof Error
        ? value.message
        : 'No se pudo enviar el mensaje de prueba.'
    )
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 900);
  }
}
