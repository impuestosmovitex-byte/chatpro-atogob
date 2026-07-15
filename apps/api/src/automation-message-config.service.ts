import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from './supabase.service';

type JsonObject = Record<string, unknown>;
type DeliveryMode = 'session' | 'template';
type MessageKey = 'abandoned_cart' | 'order_created' | 'fulfillment_created';

type MessageConfig = {
  body: string;
  deliveryMode: DeliveryMode;
  templateName: string;
  templateLanguage: string;
};

type CartRuleConfig = MessageConfig & {
  sequence: number;
  delayMinutes: number;
  active: boolean;
};

const CART_VARIABLES = [
  '{{nombre_cliente}}',
  '{{resumen_carrito}}',
  '{{total_carrito}}',
  '{{enlace_checkout}}',
];

const ORDER_VARIABLES = [
  '{{nombre_cliente}}',
  '{{numero_pedido}}',
  '{{resumen_compra}}',
  '{{total_pedido}}',
  '{{enlace_pedido}}',
];

const FULFILLMENT_VARIABLES = [
  '{{nombre_cliente}}',
  '{{numero_pedido}}',
  '{{transportadora}}',
  '{{numero_guia}}',
  '{{enlace_seguimiento}}',
];

const DEFAULT_CART_BODIES: Record<number, string> = {
  1: [
    'Hola {{nombre_cliente}} 👋',
    'Vimos que dejaste productos en tu carrito:',
    '{{resumen_carrito}}',
    'Puedes retomar tu compra aquí:',
    '{{enlace_checkout}}',
  ].join('\n\n'),
  2: [
    'Hola {{nombre_cliente}} 👋',
    'Tu carrito todavía está disponible.',
    'Puedes retomarlo aquí:',
    '{{enlace_checkout}}',
  ].join('\n\n'),
  3: [
    'Hola {{nombre_cliente}} 👋',
    'Este es el último recordatorio de tu carrito.',
    'Retoma tu compra aquí:',
    '{{enlace_checkout}}',
  ].join('\n\n'),
};

const DEFAULT_MESSAGES: Record<
  Exclude<MessageKey, 'abandoned_cart'>,
  MessageConfig
> = {
  order_created: {
    body: [
      'Hola {{nombre_cliente}}, gracias por tu compra.',
      'Tu pedido {{numero_pedido}} fue recibido correctamente.',
      '{{resumen_compra}}',
      'Total: {{total_pedido}}',
      'Consulta tu pedido aquí:',
      '{{enlace_pedido}}',
    ].join('\n\n'),
    deliveryMode: 'session',
    templateName: '',
    templateLanguage: 'es_CO',
  },
  fulfillment_created: {
    body: [
      'Hola {{nombre_cliente}} 👋',
      'Tu pedido {{numero_pedido}} ya tiene información de envío.',
      'Transportadora: {{transportadora}}',
      'Guía: {{numero_guia}}',
      'Haz seguimiento aquí:',
      '{{enlace_seguimiento}}',
    ].join('\n\n'),
    deliveryMode: 'session',
    templateName: '',
    templateLanguage: 'es_CO',
  },
};

@Injectable()
export class AutomationMessageConfigService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async list(companyId: string) {
    const client = this.supabaseService.getClient();
    const [cartResult, automationResult] = await Promise.all([
      client
        .from('company_cart_recovery_rules')
        .select(
          'sequence, delay_minutes, message_body, delivery_mode, template_name, template_language, active',
        )
        .eq('company_id', companyId)
        .in('sequence', [1, 2, 3])
        .order('sequence', { ascending: true }),
      client
        .from('company_automations')
        .select('automation_key, config')
        .eq('company_id', companyId)
        .in('automation_key', ['order_created', 'fulfillment_created']),
    ]);

    if (cartResult.error) {
      throw new BadRequestException(
        `No se pudieron consultar los mensajes del carrito: ${cartResult.error.message}`,
      );
    }

    if (automationResult.error) {
      throw new BadRequestException(
        `No se pudieron consultar los mensajes automáticos: ${automationResult.error.message}`,
      );
    }

    const cartRows = new Map(
      (cartResult.data ?? []).map((row: any) => [
        Number(row.sequence),
        row,
      ]),
    );

    const automationRows = new Map(
      (automationResult.data ?? []).map((row: any) => [
        String(row.automation_key),
        row,
      ]),
    );

    return {
      cartRules: [1, 2, 3].map((sequence) =>
        this.mapCartRule(cartRows.get(sequence), sequence),
      ),
      orderCreated: this.mapMessage(
        automationRows.get('order_created')?.config,
        DEFAULT_MESSAGES.order_created,
      ),
      fulfillmentCreated: this.mapMessage(
        automationRows.get('fulfillment_created')?.config,
        DEFAULT_MESSAGES.fulfillment_created,
      ),
      variables: {
        abandonedCart: CART_VARIABLES,
        orderCreated: ORDER_VARIABLES,
        fulfillmentCreated: FULFILLMENT_VARIABLES,
      },
      samples: {
        nombre_cliente: 'Estefanía',
        resumen_carrito: '• 1 x Blusa satinada · Talla M',
        total_carrito: '$32.800',
        enlace_checkout: 'https://tienda.com/checkouts/ejemplo',
        numero_pedido: '#44635',
        resumen_compra: '• 1 x Blusa satinada · Talla M',
        total_pedido: '$32.800',
        enlace_pedido: 'https://tienda.com/pedidos/44635',
        transportadora: 'Envia',
        numero_guia: '014160592128',
        enlace_seguimiento: 'https://envia.co/seguimiento',
      },
    };
  }

  async update(
    companyId: string,
    keyValue: string,
    input: Record<string, unknown>,
  ) {
    const key = this.validKey(keyValue);

    if (key === 'abandoned_cart') {
      await this.saveCartRules(companyId, input.rules);
      return this.list(companyId);
    }

    await this.saveAutomationMessage(companyId, key, input.message);
    return this.list(companyId);
  }

  private async saveCartRules(
    companyId: string,
    value: unknown,
  ): Promise<void> {
    if (!Array.isArray(value) || value.length !== 3) {
      throw new BadRequestException(
        'Configura exactamente los tres mensajes del carrito.',
      );
    }

    const rules = value.map((item) => this.cartRule(item));
    const sequences = new Set(rules.map((rule) => rule.sequence));

    if (
      sequences.size !== 3 ||
      ![1, 2, 3].every((sequence) => sequences.has(sequence))
    ) {
      throw new BadRequestException(
        'Los mensajes del carrito deben ser 1, 2 y 3.',
      );
    }

    const client = this.supabaseService.getClient();
    const now = new Date().toISOString();

    for (const rule of rules) {
      const { error } = await client
        .from('company_cart_recovery_rules')
        .upsert(
          {
            company_id: companyId,
            sequence: rule.sequence,
            delay_minutes: rule.delayMinutes,
            message_body: rule.body,
            message_instructions:
              'Usa el mensaje base exacto y reemplaza únicamente variables con datos reales.',
            delivery_mode: rule.deliveryMode,
            template_name:
              rule.deliveryMode === 'template'
                ? rule.templateName
                : null,
            template_language: rule.templateLanguage,
            active: rule.active,
            updated_at: now,
          },
          { onConflict: 'company_id,sequence' },
        );

      if (error) {
        throw new BadRequestException(
          `No se pudo guardar el mensaje ${rule.sequence}: ${error.message}`,
        );
      }
    }
  }

  private async saveAutomationMessage(
    companyId: string,
    key: Exclude<MessageKey, 'abandoned_cart'>,
    value: unknown,
  ): Promise<void> {
    const message = this.message(
      value,
      key === 'order_created' ? ORDER_VARIABLES : FULFILLMENT_VARIABLES,
      key === 'order_created'
        ? '{{numero_pedido}}'
        : '{{numero_guia}}',
    );
    const client = this.supabaseService.getClient();

    const { data: existing, error: existingError } = await client
      .from('company_automations')
      .select('id, config')
      .eq('company_id', companyId)
      .eq('automation_key', key)
      .maybeSingle();

    if (existingError) {
      throw new BadRequestException(
        `No se pudo consultar la automatización: ${existingError.message}`,
      );
    }

    const nextConfig = {
      ...this.object(existing?.config),
      message: {
        body: message.body,
        delivery_mode: message.deliveryMode,
        template_name:
          message.deliveryMode === 'template'
            ? message.templateName
            : null,
        template_language: message.templateLanguage,
      },
    };
    const now = new Date().toISOString();

    if (existing?.id) {
      const { error } = await client
        .from('company_automations')
        .update({ config: nextConfig, updated_at: now })
        .eq('id', existing.id);

      if (error) {
        throw new BadRequestException(
          `No se pudo guardar el mensaje: ${error.message}`,
        );
      }

      return;
    }

    const defaults =
      key === 'order_created'
        ? {
            name: 'Confirmación de pedido',
            description:
              'Confirma automáticamente que el pedido fue recibido.',
          }
        : {
            name: 'Guía o envío creado',
            description:
              'Envía la transportadora y la guía cuando estén disponibles.',
          };

    const { error } = await client.from('company_automations').insert({
      company_id: companyId,
      automation_key: key,
      name: defaults.name,
      description: defaults.description,
      enabled: false,
      config: nextConfig,
      updated_at: now,
    });

    if (error) {
      throw new BadRequestException(
        `No se pudo crear la configuración del mensaje: ${error.message}`,
      );
    }
  }

  private cartRule(value: unknown): CartRuleConfig {
    const row = this.object(value);
    const sequence = this.integer(row.sequence, 0, 1, 3);
    const delayMinutes = this.integer(
      row.delayMinutes,
      sequence === 1 ? 5 : sequence === 2 ? 45 : 720,
      1,
      43200,
    );
    const message = this.message(
      row,
      CART_VARIABLES,
      '{{enlace_checkout}}',
    );

    return {
      sequence,
      delayMinutes,
      active: row.active !== false,
      ...message,
    };
  }

  private message(
    value: unknown,
    allowedVariables: string[],
    requiredVariable: string,
  ): MessageConfig {
    const row = this.object(value);
    const body = this.normalizeBody(row.body);
    const deliveryMode = this.deliveryMode(row.deliveryMode);
    const templateName = this.shortText(row.templateName, 120);
    const templateLanguage =
      this.shortText(row.templateLanguage, 20) || 'es_CO';

    this.validateVariables(body, allowedVariables);

    if (!body.includes(requiredVariable)) {
      throw new BadRequestException(
        `El mensaje debe incluir ${requiredVariable}.`,
      );
    }

    if (deliveryMode === 'template' && !templateName) {
      throw new BadRequestException(
        'Escribe el nombre de la plantilla aprobada en Meta.',
      );
    }

    return {
      body,
      deliveryMode,
      templateName,
      templateLanguage,
    };
  }

  private mapCartRule(row: any, sequence: number): CartRuleConfig {
    return {
      sequence,
      delayMinutes: this.integer(
        row?.delay_minutes,
        sequence === 1 ? 5 : sequence === 2 ? 45 : 720,
        1,
        43200,
      ),
      body:
        this.text(row?.message_body) ||
        DEFAULT_CART_BODIES[sequence],
      deliveryMode:
        row?.delivery_mode === 'template' ? 'template' : 'session',
      templateName: this.text(row?.template_name),
      templateLanguage:
        this.text(row?.template_language) || 'es_CO',
      active: row?.active !== false,
    };
  }

  private mapMessage(
    configValue: unknown,
    fallback: MessageConfig,
  ): MessageConfig {
    const config = this.object(configValue);
    const message = this.object(config.message);

    return {
      body: this.text(message.body) || fallback.body,
      deliveryMode:
        message.delivery_mode === 'template' ? 'template' : 'session',
      templateName: this.text(message.template_name),
      templateLanguage:
        this.text(message.template_language) ||
        fallback.templateLanguage,
    };
  }

  private validateVariables(
    body: string,
    allowedVariables: string[],
  ): void {
    const allowed = new Set(allowedVariables);
    const matches = body.match(/\{\{[a-z_]+\}\}/g) ?? [];
    const invalid = [...new Set(matches.filter((item) => !allowed.has(item)))];

    if (invalid.length) {
      throw new BadRequestException(
        `Variables no permitidas: ${invalid.join(', ')}.`,
      );
    }

    const malformed = body.match(/\{\{[^}\n]*$|^[^{\n]*\}\}/m);

    if (malformed) {
      throw new BadRequestException(
        'Revisa las llaves de las variables del mensaje.',
      );
    }
  }

  private normalizeBody(value: unknown): string {
    const body = this.text(value)
      .replace(/\{\{\s*([a-z_]+)\s*\}\}/g, '{{$1}}')
      .replace(/\r\n/g, '\n');

    if (!body) {
      throw new BadRequestException('Escribe el mensaje base.');
    }

    if (body.length > 2500) {
      throw new BadRequestException(
        'El mensaje base no puede superar 2.500 caracteres.',
      );
    }

    return body;
  }

  private validKey(value: string): MessageKey {
    const key = value.trim() as MessageKey;

    if (
      key !== 'abandoned_cart' &&
      key !== 'order_created' &&
      key !== 'fulfillment_created'
    ) {
      throw new BadRequestException('Tipo de mensaje no válido.');
    }

    return key;
  }

  private deliveryMode(value: unknown): DeliveryMode {
    return value === 'template' ? 'template' : 'session';
  }

  private integer(
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

  private shortText(value: unknown, maximum: number): string {
    return this.text(value).slice(0, maximum);
  }

  private object(value: unknown): JsonObject {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as JsonObject)
      : {};
  }

  private text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }
}
