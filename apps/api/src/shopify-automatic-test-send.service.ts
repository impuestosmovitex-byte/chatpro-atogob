import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from './supabase.service';
import { WhatsappMessagingService } from './whatsapp-messaging.service';
import { WhatsappTemplateExecutionService } from './whatsapp-template-execution.service';

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
export class ShopifyAutomaticTestSendService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly whatsappMessagingService: WhatsappMessagingService,
    private readonly whatsappTemplateExecutionService: WhatsappTemplateExecutionService,
  ) {}

  async sendIfAllowed(
    companyId: string,
    executionId: string,
  ): Promise<'sent' | 'blocked' | 'already_sent'> {
    const client = this.supabaseService.getClient();
    const { data, error } = await client
      .from('automation_executions')
      .select(
        'id, company_id, automation_key, recipient, status, attempt_count, payload',
      )
      .eq('id', executionId)
      .eq('company_id', companyId)
      .maybeSingle();

    if (error || !data) {
      throw new BadRequestException(
        `No se pudo consultar el mensaje automático: ${
          error?.message ?? 'registro no encontrado'
        }`,
      );
    }

    const execution = data as ExecutionRow;
    const payload = this.object(execution.payload);
    const message = this.text(payload.prepared_message);
    const recipient = this.normalizePhone(execution.recipient);

    if (execution.status === 'sent') {
      return 'already_sent';
    }

    if (payload.prepared_only !== true || !message) {
      throw new BadRequestException(
        'La ejecución no contiene un mensaje preparado.',
      );
    }

    if (
      ![
        'order_created',
        'fulfillment_created',
        'cod_order_created',
        'payment_pending',
        'order_cancelled',
        'post_purchase_bonus',
      ].includes(execution.automation_key)
    ) {
      throw new BadRequestException(
        'La ejecución no corresponde a un evento transaccional compatible.',
      );
    }

    const delivery = await this.deliveryPolicy(companyId);

    if (
      !recipient ||
      (delivery.mode === 'test' &&
        !delivery.allowedPhones.includes(recipient))
    ) {
      const reason = !recipient
        ? 'Bloqueado: el evento no tiene un teléfono válido.'
        : delivery.allowedPhones.length
          ? `Bloqueado por modo de prueba. Solo se permite: ${delivery.allowedPhones.join(', ')}.`
          : 'Bloqueado: no hay teléfonos autorizados para pruebas.';

      await this.markBlocked(execution, payload, reason);
      return 'blocked';
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
        locked_by: 'shopify-automatic-send',
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
        `No se pudo iniciar el envío automático: ${lockError.message}`,
      );
    }

    if (!locked) {
      return 'already_sent';
    }

    try {
      const templateResult =
        await this.whatsappTemplateExecutionService.sendAssignedTemplate({
          companyId,
          eventKey: execution.automation_key,
          to: recipient,
          context: this.templateContext(
            execution.automation_key,
            payload,
          ),
        });
      const sendResult =
        templateResult ??
        (await this.whatsappMessagingService.sendText(
          companyId,
          recipient,
          message,
        ));

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
            prepared_only: true,
            test_send: delivery.mode === 'test',
            automatic_test_send: delivery.mode === 'test',
            production_send: delivery.mode === 'production',
            delivery_mode: delivery.mode,
            test_sent_at: delivery.mode === 'test' ? sentAt : null,
            test_recipient:
              delivery.mode === 'test' ? recipient : null,
            auto_test_blocked: false,
            send_blocked_reason: null,
            used_assigned_template: Boolean(templateResult),
            provider_message_id: sendResult.messageId,
          },
          updated_at: sentAt,
        })
        .eq('id', execution.id);

      if (sentError) {
        throw new Error(
          `Meta recibió el mensaje, pero no se pudo cerrar el historial: ${sentError.message}`,
        );
      }

      return 'sent';
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

  private async markBlocked(
    execution: ExecutionRow,
    payload: JsonObject,
    reason: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.supabaseService
      .getClient()
      .from('automation_executions')
      .update({
        status: 'skipped',
        failed_at: null,
        next_retry_at: null,
        locked_at: null,
        locked_by: null,
        error_message: reason,
        payload: {
          ...payload,
          prepared_only: true,
          automatic_test_send: true,
          auto_test_blocked: true,
          send_blocked_reason: reason,
        },
        updated_at: now,
      })
      .eq('id', execution.id);

    if (error) {
      throw new BadRequestException(
        `No se pudo registrar el bloqueo de seguridad: ${error.message}`,
      );
    }
  }

  private templateContext(
    automationKey: string,
    payload: JsonObject,
  ): JsonObject {
    const variables = this.object(payload.variables);
    const fullName =
      this.text(variables.nombre_cliente) || 'Cliente';
    const firstName =
      fullName.split(/\s+/)[0]?.trim() || 'Cliente';

    if (automationKey === 'fulfillment_created') {
      return {
        customer: {
          first_name: firstName,
          full_name: fullName,
        },
        order: {
          number: this.normalizeOrderNumber(this.text(variables.numero_pedido)),
        },
        fulfillment: {
          carrier: this.normalizeCarrierName(this.text(variables.transportadora)),
          tracking_number: this.text(variables.numero_guia),
          tracking_url: this.text(variables.enlace_seguimiento),
        },
      };
    }

    return {
      customer: {
        first_name: firstName,
        full_name: fullName,
      },
      order: {
        number: this.normalizeOrderNumber(this.text(variables.numero_pedido)),
        items_summary: this.text(variables.resumen_compra),
        total: this.text(variables.total_pedido),
        payment_method: this.text(variables.medio_pago),
        status_url: this.text(variables.enlace_pedido),
        payment_url: this.text(
          variables.enlace_pago ?? variables.enlace_pedido,
        ),
      },
      storefront: {
        url: this.text(variables.url_tienda),
      },
    };
  }

  private normalizeOrderNumber(value: string): string {
    return value.replace(/^#+\s*/, '').trim();
  }

  private normalizeCarrierName(value: string): string {
    const clean = value.trim();
    const normalized = clean
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    if (
      !clean ||
      ['other', 'otro', 'unknown', 'desconocido'].includes(
        normalized,
      )
    ) {
      return 'Transportadora del pedido';
    }

    return clean;
  }

  private async deliveryPolicy(
    companyId: string,
  ): Promise<{
    mode: 'test' | 'production';
    allowedPhones: string[];
  }> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('company_settings')
      .select('settings')
      .eq('company_id', companyId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(
        `No se pudo consultar el modo de envío: ${error.message}`,
      );
    }

    const settings = this.object(data?.settings);
    const recovery = this.object(settings.cart_recovery);
    const mode =
      settings.automation_delivery_mode === 'production' ||
      recovery.test_mode === false
        ? 'production'
        : 'test';
    const value =
      recovery.test_phones ??
      settings.cart_recovery_test_phones;
    const countryCode = (
      this.text(
        recovery.default_country_code ??
          settings.cart_recovery_default_country_code,
      ) || '57'
    ).replace(/\D/g, '');

    const phones = Array.isArray(value)
      ? Array.from(
          new Set(
            value
              .map((phone) =>
                this.normalizePhone(phone, countryCode),
              )
              .filter((phone): phone is string => Boolean(phone)),
          ),
        )
      : [];

    return {
      mode,
      allowedPhones: phones,
    };
  }

  private normalizePhone(
    value: unknown,
    countryCode = '57',
  ): string | null {
    const raw = this.text(value);
    const digits = raw.replace(/\\D/g, '');

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
        : 'No se pudo enviar el mensaje automático de prueba.'
    )
      .replace(/\\s+/g, ' ')
      .trim()
      .slice(0, 900);
  }
}
