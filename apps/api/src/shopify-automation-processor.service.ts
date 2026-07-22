import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseService } from './supabase.service';
import { CompanyShopifyService } from './company-shopify.service';
import { ShopifyAutomaticTestSendService } from './shopify-automatic-test-send.service';

type JsonObject = Record<string, unknown>;
type AutomationKey =
  | 'order_created'
  | 'fulfillment_created'
  | 'cod_order_created'
  | 'payment_pending'
  | 'order_cancelled'
  | 'post_purchase_bonus';

type WebhookRow = {
  id: string;
  webhook_id: string;
  company_id: string;
  shop_domain: string;
  topic: string;
  status: 'received' | 'processing' | 'processed' | 'failed' | 'ignored';
  payload: unknown;
  attempt_count: number | null;
  next_retry_at: string | null;
  received_at: string;
};

type MessageConfig = {
  automationId: string | null;
  body: string;
  deliveryMode: 'session' | 'template';
  templateName: string | null;
  templateLanguage: string;
};

type PreparedAutomation = {
  companyId: string;
  automationId: string | null;
  automationKey: AutomationKey;
  eventKey: string;
  recipient: string | null;
  rawRecipient: string;
  message: string;
  orderId: string;
  orderNumber: string;
  sourceEventId: string;
  sourceWebhookId: string;
  sourceTopic: string;
  deliveryMode: 'session' | 'template';
  templateName: string | null;
  templateLanguage: string;
  variables: JsonObject;
};

const DEFAULT_ORDER_MESSAGE = [
  'Hola {{nombre_cliente}}, gracias por tu compra.',
  'Tu pedido {{numero_pedido}} fue recibido correctamente.',
  '{{resumen_compra}}',
  'Total: {{total_pedido}}',
  'Consulta tu pedido aquí:',
  '{{enlace_pedido}}',
].join('\n\n');

const DEFAULT_FULFILLMENT_MESSAGE = [
  'Hola {{nombre_cliente}} 👋',
  'Tu pedido {{numero_pedido}} ya tiene información de envío.',
  'Transportadora: {{transportadora}}',
  'Guía: {{numero_guia}}',
  'Haz seguimiento aquí:',
  '{{enlace_seguimiento}}',
].join('\n\n');

const DEFAULT_COD_MESSAGE = [
  'Hola {{nombre_cliente}}.',
  'Recibimos tu pedido {{numero_pedido}} contraentrega.',
  'Total: {{total_pedido}}',
  'Medio de pago: {{medio_pago}}',
  'Confirma el pedido para continuar con la entrega.',
].join('\n\n');

const DEFAULT_PAYMENT_PENDING_MESSAGE = [
  'Hola {{nombre_cliente}}.',
  'Tu pedido {{numero_pedido}} está pendiente de pago.',
  'Total: {{total_pedido}}',
  'Completa el proceso aquí:',
  '{{enlace_pago}}',
].join('\n\n');

const DEFAULT_CANCELLED_MESSAGE = [
  'Hola {{nombre_cliente}}.',
  'Tu pedido {{numero_pedido}} fue cancelado.',
  'Puedes volver a comprar aquí:',
  '{{url_tienda}}',
].join('\n\n');

const DEFAULT_POST_PURCHASE_BONUS_MESSAGE = [
  'Hola {{nombre_cliente}}.',
  'Gracias por tu compra.',
  'Tenemos un beneficio posterior a tu compra.',
  'Consulta la tienda aquí:',
  '{{url_tienda}}',
].join('\n\n');

@Injectable()
export class ShopifyAutomationProcessorService implements OnModuleInit {
  private readonly logger = new Logger(ShopifyAutomationProcessorService.name);
  private processing = false;
  private processingStartedAt: number | null = null;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly companyShopifyService: CompanyShopifyService,
    private readonly automaticTestSendService: ShopifyAutomaticTestSendService,
  ) {}

  onModuleInit(): void {
    this.logger.log(
      'Procesador automático de eventos Shopify iniciado.',
    );

    setTimeout(() => {
      void this.processPending();
    }, 5000);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processPending(): Promise<void> {
    const now = Date.now();

    if (this.processing) {
      const elapsed =
        this.processingStartedAt === null
          ? 0
          : now - this.processingStartedAt;

      if (elapsed < 30000) {
        return;
      }

      this.logger.warn(
        `Se liberó un procesamiento Shopify bloqueado hace ${Math.round(
          elapsed / 1000,
        )} segundos.`,
      );
      this.processing = false;
      this.processingStartedAt = null;
    }

    this.processing = true;
    this.processingStartedAt = now;

    try {
      this.logger.log('Consultando la cola pendiente de Shopify.');

      const rows = await this.withTimeout(
        this.pendingRows(),
        15000,
        'La consulta de eventos Shopify tardó más de 15 segundos.',
      );

      if (rows.length) {
        this.logger.log(
          `Procesando ${rows.length} evento(s) pendiente(s) de Shopify.`,
        );
      }

      for (const row of rows) {
        await this.processOne(row);
      }
    } catch (error) {
      this.logger.error(
        `No se pudieron procesar eventos Shopify: ${this.errorMessage(error)}`,
      );
    } finally {
      this.processing = false;
      this.processingStartedAt = null;
    }
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    milliseconds: number,
    message: string,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(message)), milliseconds);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private async pendingRows(): Promise<WebhookRow[]> {
    const client = this.supabaseService.getClient();
    const fields =
      'id, webhook_id, company_id, shop_domain, topic, status, payload, attempt_count, next_retry_at, received_at';
    const now = new Date().toISOString();

    const [receivedResult, failedResult] = await Promise.all([
      client
        .from('shopify_webhook_events')
        .select(fields)
        .eq('status', 'received')
        .order('received_at', { ascending: true })
        .limit(40),
      client
        .from('shopify_webhook_events')
        .select(fields)
        .eq('status', 'failed')
        .lte('next_retry_at', now)
        .order('next_retry_at', { ascending: true })
        .limit(40),
    ]);

    if (receivedResult.error) {
      throw new Error(
        `No se pudieron consultar los eventos recibidos: ${receivedResult.error.message}`,
      );
    }

    if (failedResult.error) {
      throw new Error(
        `No se pudieron consultar los reintentos pendientes: ${failedResult.error.message}`,
      );
    }

    const received = (receivedResult.data ?? []) as WebhookRow[];
    const failed = (failedResult.data ?? []) as WebhookRow[];

    return [...received, ...failed]
      .sort(
        (left, right) =>
          Date.parse(left.received_at) - Date.parse(right.received_at),
      )
      .slice(0, 40);
  }

  private async processOne(row: WebhookRow): Promise<void> {
    const claimed = await this.claim(row);

    if (!claimed) {
      return;
    }

    try {
      let prepared: PreparedAutomation | null;

      if (claimed.topic === 'orders/create') {
        prepared = await this.prepareOrder(claimed);

        const automationEnabled = await this.isAutomationEnabled(
          claimed.company_id,
          prepared.automationKey,
        );

        if (!automationEnabled) {
          await this.markIgnored(
            claimed.id,
            `La automatización ${prepared.automationKey} está pausada.`,
          );
          return;
        }
      } else if (claimed.topic === 'orders/cancelled') {
        const [automationEnabled, templateEnabled] = await Promise.all([
          this.isAutomationEnabled(
            claimed.company_id,
            'order_cancelled',
          ),
          this.hasEnabledTemplateBinding(
            claimed.company_id,
            'order_cancelled',
          ),
        ]);

        if (!automationEnabled) {
          await this.markIgnored(
            claimed.id,
            'La automatización de pedido cancelado está pausada.',
          );
          return;
        }

        if (!templateEnabled) {
          await this.markIgnored(
            claimed.id,
            'La empresa no tiene activa una plantilla de pedido cancelado.',
          );
          return;
        }

        prepared = await this.prepareOrder(
          claimed,
          'order_cancelled',
        );
      } else if (this.isDeliveredFulfillment(claimed.payload)) {
        const [automationEnabled, templateEnabled] = await Promise.all([
          this.isAutomationEnabled(
            claimed.company_id,
            'post_purchase_bonus',
          ),
          this.hasEnabledTemplateBinding(
            claimed.company_id,
            'post_purchase_bonus',
          ),
        ]);

        if (!automationEnabled) {
          await this.markIgnored(
            claimed.id,
            'La automatización de beneficio posterior a la compra está pausada.',
          );
          return;
        }

        if (!templateEnabled) {
          await this.markIgnored(
            claimed.id,
            'La empresa no tiene activa una plantilla de beneficio posterior a la compra.',
          );
          return;
        }

        prepared = await this.preparePostPurchaseBonus(claimed);
      } else {
        prepared = await this.prepareFulfillment(claimed);

        if (
          prepared &&
          !(await this.isAutomationEnabled(
            claimed.company_id,
            'fulfillment_created',
          ))
        ) {
          await this.markIgnored(
            claimed.id,
            'La automatización de guía o envío creado está pausada.',
          );
          return;
        }
      }

      if (!prepared) {
        await this.markIgnored(
          claimed.id,
          this.isDeliveredFulfillment(claimed.payload)
            ? 'No se pudo resolver el pedido entregado para preparar el beneficio.'
            : 'El evento no tiene guía suficiente o no se pudo resolver el pedido relacionado.',
        );
        return;
      }

      const executionId =
        await this.savePreparedExecution(prepared);

      await this.automaticTestSendService.sendIfAllowed(
        prepared.companyId,
        executionId,
      );

      await this.markProcessed(claimed.id);
    } catch (error) {
      await this.markFailed(claimed, error);
    }
  }

  private async claim(row: WebhookRow): Promise<WebhookRow | null> {
    const now = new Date().toISOString();
    const nextAttempt = Number(row.attempt_count ?? 0) + 1;

    const { data, error } = await this.supabaseService
      .getClient()
      .from('shopify_webhook_events')
      .update({
        status: 'processing',
        processing_started_at: now,
        attempt_count: nextAttempt,
        error_message: null,
        updated_at: now,
      })
      .eq('id', row.id)
      .eq('status', row.status)
      .select(
        'id, webhook_id, company_id, shop_domain, topic, status, payload, attempt_count, next_retry_at, received_at',
      )
      .maybeSingle();

    if (error) {
      throw new Error(`No se pudo tomar el evento ${row.id}: ${error.message}`);
    }

    return data ? (data as WebhookRow) : null;
  }

  private async prepareOrder(
    row: WebhookRow,
    forcedKey?: 'order_cancelled',
  ): Promise<PreparedAutomation> {
    const payload = this.object(row.payload);
    const orderId = this.firstText(payload.id, payload.order_id);

    if (!orderId) {
      throw new Error('El pedido de Shopify no tiene identificador.');
    }

    const orderNumber =
      this.firstText(payload.name) ||
      (this.firstText(payload.order_number)
        ? `#${this.firstText(payload.order_number)}`
        : orderId);
    const customer = this.object(payload.customer);
    const shipping = this.object(payload.shipping_address);
    const billing = this.object(payload.billing_address);
    const defaultAddress = this.object(customer.default_address);
    const customerName =
      this.fullName(customer) ||
      this.fullName(shipping) ||
      this.fullName(billing) ||
      'cliente';
    const rawRecipient = this.firstText(
      payload.phone,
      shipping.phone,
      billing.phone,
      customer.phone,
      defaultAddress.phone,
    );
    const recipient = await this.normalizeRecipient(
      row.company_id,
      rawRecipient,
    );
    const paymentMethod = this.paymentMethod(payload);
    const statusUrl = this.firstText(
      payload.order_status_url,
      payload.status_url,
    );
    const automationKey =
      forcedKey ??
      (await this.orderAutomationKey(
        row.company_id,
        payload,
      ));
    const variables: JsonObject = {
      nombre_cliente: customerName,
      numero_pedido: orderNumber,
      resumen_compra: this.orderSummary(payload),
      total_pedido: this.money(
        payload.total_price,
        payload.currency,
      ),
      medio_pago: paymentMethod,
      enlace_pedido: statusUrl,
      enlace_pago: statusUrl,
      url_tienda: await this.storefrontUrl(
        row.company_id,
        row.shop_domain,
      ),
    };
    const config = await this.messageConfig(
      row.company_id,
      automationKey,
    );
    const eventKey =
      automationKey === 'order_created'
        ? `shopify-order:${orderId}`
        : `shopify-${automationKey}:${orderId}`;

    return {
      companyId: row.company_id,
      automationId: config.automationId,
      automationKey,
      eventKey,
      recipient,
      rawRecipient,
      message: this.render(config.body, variables),
      orderId,
      orderNumber,
      sourceEventId: row.id,
      sourceWebhookId: row.webhook_id,
      sourceTopic: row.topic,
      deliveryMode: config.deliveryMode,
      templateName: config.templateName,
      templateLanguage: config.templateLanguage,
      variables,
    };
  }


  private async preparePostPurchaseBonus(
    row: WebhookRow,
  ): Promise<PreparedAutomation | null> {
    const payload = this.object(row.payload);
    const orderId = this.firstText(payload.order_id);

    if (!orderId) {
      throw new Error(
        'La entrega confirmada por Shopify no tiene pedido relacionado.',
      );
    }

    const orderContext = await this.resolveOrderContext(
      row.company_id,
      orderId,
    );

    if (!orderContext) {
      return null;
    }

    const recipient = await this.normalizeRecipient(
      row.company_id,
      orderContext.rawRecipient,
    );

    const variables: JsonObject = {
      nombre_cliente: orderContext.customerName,
      numero_pedido: orderContext.orderNumber,
      url_tienda: await this.storefrontUrl(
        row.company_id,
        row.shop_domain,
      ),
    };

    const config = await this.messageConfig(
      row.company_id,
      'post_purchase_bonus',
    );

    return {
      companyId: row.company_id,
      automationId: config.automationId,
      automationKey: 'post_purchase_bonus',
      eventKey: `shopify-post-purchase-bonus:${orderId}`,
      recipient,
      rawRecipient: orderContext.rawRecipient,
      message: this.render(config.body, variables),
      orderId,
      orderNumber: orderContext.orderNumber,
      sourceEventId: row.id,
      sourceWebhookId: row.webhook_id,
      sourceTopic: row.topic,
      deliveryMode: config.deliveryMode,
      templateName: config.templateName,
      templateLanguage: config.templateLanguage,
      variables,
    };
  }

  private async prepareFulfillment(
    row: WebhookRow,
  ): Promise<PreparedAutomation | null> {
    const payload = this.object(row.payload);
    const fulfillmentId = this.firstText(payload.id) || row.webhook_id;
    const orderId = this.firstText(payload.order_id);
    const trackingNumbers = this.stringArray(payload.tracking_numbers);
    const trackingUrls = this.stringArray(payload.tracking_urls);
    const trackingNumber = this.firstText(
      payload.tracking_number,
      trackingNumbers[0],
    );
    const trackingUrl = this.firstText(
      payload.tracking_url,
      trackingUrls[0],
    );

    if (!trackingNumber && !trackingUrl) {
      return null;
    }

    if (!orderId) {
      throw new Error('La guía de Shopify no tiene pedido relacionado.');
    }

    const orderContext = await this.resolveOrderContext(
      row.company_id,
      orderId,
    );

    if (!orderContext) {
      return null;
    }

    const customerName = orderContext.customerName;
    const rawRecipient = orderContext.rawRecipient;
    const recipient = await this.normalizeRecipient(
      row.company_id,
      rawRecipient,
    );
    const orderNumber = orderContext.orderNumber;
    const variables: JsonObject = {
      nombre_cliente: customerName,
      numero_pedido: orderNumber,
      transportadora:
        this.firstText(payload.tracking_company) ||
        'Transportadora registrada por la tienda',
      numero_guia: trackingNumber,
      enlace_seguimiento: trackingUrl,
    };
    const config = await this.messageConfig(
      row.company_id,
      'fulfillment_created',
    );

    return {
      companyId: row.company_id,
      automationId: config.automationId,
      automationKey: 'fulfillment_created',
      eventKey: `shopify-fulfillment:${fulfillmentId}`,
      recipient,
      rawRecipient,
      message: this.render(config.body, variables),
      orderId,
      orderNumber,
      sourceEventId: row.id,
      sourceWebhookId: row.webhook_id,
      sourceTopic: row.topic,
      deliveryMode: config.deliveryMode,
      templateName: config.templateName,
      templateLanguage: config.templateLanguage,
      variables,
    };
  }

  private async orderAutomationKey(
    companyId: string,
    payload: JsonObject,
  ): Promise<AutomationKey> {
    if (
      this.isCashOnDelivery(payload) &&
      (await this.hasEnabledTemplateBinding(
        companyId,
        'cod_order_created',
      ))
    ) {
      return 'cod_order_created';
    }

    if (
      this.isPaymentPending(payload) &&
      (await this.hasEnabledTemplateBinding(
        companyId,
        'payment_pending',
      ))
    ) {
      return 'payment_pending';
    }

    return 'order_created';
  }

  private async isAutomationEnabled(
    companyId: string,
    automationKey: AutomationKey,
  ): Promise<boolean> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('company_automations')
      .select('enabled')
      .eq('company_id', companyId)
      .eq('automation_key', automationKey)
      .maybeSingle();

    if (error) {
      throw new Error(
        `No se pudo validar la automatización ${automationKey}: ${error.message}`,
      );
    }

    return data?.enabled === true;
  }

  private async hasEnabledTemplateBinding(
    companyId: string,
    eventKey: AutomationKey,
  ): Promise<boolean> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('company_template_bindings')
      .select('id')
      .eq('company_id', companyId)
      .eq('event_key', eventKey)
      .eq('enabled', true)
      .not('template_id', 'is', null)
      .maybeSingle();

    if (error) {
      throw new Error(
        `No se pudo validar la plantilla ${eventKey}: ${error.message}`,
      );
    }

    return Boolean(data?.id);
  }

  private isCashOnDelivery(payload: JsonObject): boolean {
    const values = [
      this.firstText(payload.gateway),
      this.firstText(payload.payment_gateway),
      ...this.stringArray(payload.payment_gateway_names),
      this.firstText(payload.tags),
      this.firstText(payload.note),
    ]
      .filter(Boolean)
      .join(' ');
    const normalized = this.normalizeSearchText(values);

    return (
      /\bcod\b/.test(normalized) ||
      normalized.includes('cash on delivery') ||
      normalized.includes('contra entrega') ||
      normalized.includes('contraentrega') ||
      normalized.includes('pago al recibir')
    );
  }

  private isPaymentPending(payload: JsonObject): boolean {
    const status = this.normalizeSearchText(
      this.firstText(
        payload.financial_status,
        payload.payment_status,
      ),
    );

    return ['pending', 'partially paid'].includes(status);
  }

  private isDeliveredFulfillment(value: unknown): boolean {
    const payload = this.object(value);
    const status = this.normalizeSearchText(
      this.firstText(
        payload.shipment_status,
        payload.delivery_status,
      ),
    );

    return status === 'delivered';
  }

  private paymentMethod(payload: JsonObject): string {
    const values = [
      ...this.stringArray(payload.payment_gateway_names),
      this.firstText(payload.gateway),
      this.firstText(payload.payment_gateway),
    ].filter(Boolean);

    return (
      Array.from(new Set(values)).join(', ') ||
      'Método de pago registrado por Shopify'
    );
  }

  private async storefrontUrl(
    companyId: string,
    shopDomain: string,
  ): Promise<string> {
    try {
      const publicUrl =
        await this.companyShopifyService.getStorefrontUrl(companyId);

      if (publicUrl) {
        return publicUrl.trim().replace(/\/+$/, '');
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo obtener el dominio público de Shopify para ${companyId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const domain = shopDomain.trim().replace(/^https?:\/\//i, '');

    return domain ? `https://${domain}` : '';
  }

  private normalizeSearchText(value: unknown): string {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }


  private async resolveOrderContext(
    companyId: string,
    orderId: string,
  ): Promise<{
    customerName: string;
    rawRecipient: string;
    orderNumber: string;
  } | null> {
    const payload = await this.findOrderPayload(companyId, orderId);

    if (payload) {
      const customer = this.object(payload.customer);
      const shipping = this.object(payload.shipping_address);
      const billing = this.object(payload.billing_address);
      const defaultAddress = this.object(customer.default_address);

      return {
        customerName:
          this.fullName(customer) ||
          this.fullName(shipping) ||
          this.fullName(billing) ||
          'cliente',
        rawRecipient: this.firstText(
          payload.phone,
          shipping.phone,
          billing.phone,
          customer.phone,
          defaultAddress.phone,
        ),
        orderNumber:
          this.firstText(payload.name) ||
          (this.firstText(payload.order_number)
            ? `#${this.firstText(payload.order_number)}`
            : orderId),
      };
    }

    const order = await this.companyShopifyService.lookupOrderById(
      companyId,
      orderId,
    );

    if (!order) {
      return null;
    }

    return {
      customerName:
        order.customer.name ||
        order.shippingAddress?.name ||
        'cliente',
      rawRecipient:
        order.customer.phone ||
        order.shippingAddress?.phone ||
        '',
      orderNumber: order.name || orderId,
    };
  }

  private async findOrderPayload(
    companyId: string,
    orderId: string,
  ): Promise<JsonObject | null> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('shopify_webhook_events')
      .select('payload')
      .eq('company_id', companyId)
      .eq('topic', 'orders/create')
      .order('received_at', { ascending: false })
      .limit(250);

    if (error) {
      throw new Error(
        `No se pudo buscar el pedido de la guía: ${error.message}`,
      );
    }

    for (const row of data ?? []) {
      const payload = this.object((row as { payload?: unknown }).payload);

      if (this.firstText(payload.id, payload.order_id) === orderId) {
        return payload;
      }
    }

    return null;
  }

  private async messageConfig(
    companyId: string,
    key: AutomationKey,
  ): Promise<MessageConfig> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('company_automations')
      .select('id, config')
      .eq('company_id', companyId)
      .eq('automation_key', key)
      .maybeSingle();

    if (error) {
      throw new Error(
        `No se pudo consultar el mensaje configurado: ${error.message}`,
      );
    }

    const config = this.object(data?.config);
    const message = this.object(config.message);
    const body =
      this.firstText(message.body) ||
      this.defaultMessage(key);
    const deliveryMode =
      this.firstText(message.delivery_mode) === 'template'
        ? 'template'
        : 'session';

    return {
      automationId: data?.id ?? null,
      body,
      deliveryMode,
      templateName:
        deliveryMode === 'template'
          ? this.firstText(message.template_name) || null
          : null,
      templateLanguage:
        this.firstText(message.template_language) || 'es_CO',
    };
  }

  private defaultMessage(key: AutomationKey): string {
    if (key === 'fulfillment_created') {
      return DEFAULT_FULFILLMENT_MESSAGE;
    }

    if (key === 'cod_order_created') {
      return DEFAULT_COD_MESSAGE;
    }

    if (key === 'payment_pending') {
      return DEFAULT_PAYMENT_PENDING_MESSAGE;
    }

    if (key === 'order_cancelled') {
      return DEFAULT_CANCELLED_MESSAGE;
    }

    if (key === 'post_purchase_bonus') {
      return DEFAULT_POST_PURCHASE_BONUS_MESSAGE;
    }

    return DEFAULT_ORDER_MESSAGE;
  }

  private async savePreparedExecution(
    prepared: PreparedAutomation,
  ): Promise<string> {
    const now = new Date().toISOString();
    const status = prepared.recipient ? 'pending' : 'skipped';
    const payload: JsonObject = {
      prepared_only: true,
      prepared_message: prepared.message,
      source_event_id: prepared.sourceEventId,
      source_webhook_id: prepared.sourceWebhookId,
      source_topic: prepared.sourceTopic,
      order_id: prepared.orderId,
      order_number: prepared.orderNumber,
      raw_recipient: prepared.rawRecipient,
      variables: prepared.variables,
      delivery_mode: prepared.deliveryMode,
      template_name: prepared.templateName,
      template_language: prepared.templateLanguage,
      automatic_test_pending: true,
      send_blocked_reason:
        'Pendiente de validación del modo de prueba automático.',
    };

    const client = this.supabaseService.getClient();
    const { data, error } = await client
      .from('automation_executions')
      .upsert(
        {
          company_id: prepared.companyId,
          automation_id: prepared.automationId,
          automation_key: prepared.automationKey,
          event_key: prepared.eventKey,
          channel: 'whatsapp',
          recipient: prepared.recipient,
          status,
          attempt_count: 0,
          scheduled_for: now,
          error_message: prepared.recipient
            ? null
            : 'No se encontró un teléfono válido para preparar el envío.',
          payload,
          updated_at: now,
        },
        {
          onConflict: 'company_id,automation_key,event_key',
          ignoreDuplicates: true,
        },
      )
      .select('id')
      .maybeSingle();

    if (error) {
      throw new Error(
        `No se pudo guardar el mensaje preparado: ${error.message}`,
      );
    }

    if (data?.id) {
      return String(data.id);
    }

    const { data: existing, error: existingError } = await client
      .from('automation_executions')
      .select('id')
      .eq('company_id', prepared.companyId)
      .eq('automation_key', prepared.automationKey)
      .eq('event_key', prepared.eventKey)
      .maybeSingle();

    if (existingError || !existing?.id) {
      throw new Error(
        `No se pudo recuperar la ejecución preparada: ${
          existingError?.message ?? 'registro no encontrado'
        }`,
      );
    }

    return String(existing.id);
  }

  private async normalizeRecipient(
    companyId: string,
    rawValue: string,
  ): Promise<string | null> {
    const raw = rawValue.trim();
    const digits = raw.replace(/\D/g, '');

    if (!digits || digits.length < 8 || digits.length > 15) {
      return null;
    }

    if (raw.startsWith('+') || digits.length > 10) {
      return digits;
    }

    const settings = await this.companySettings(companyId);
    const recovery = this.object(settings.cart_recovery);
    const countryCode = (
      this.firstText(
        recovery.default_country_code,
        settings.cart_recovery_default_country_code,
      ) || '57'
    ).replace(/\D/g, '');

    if (digits.length === 10 && countryCode) {
      return `${countryCode}${digits}`;
    }

    return null;
  }

  private async companySettings(companyId: string): Promise<JsonObject> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('company_settings')
      .select('settings')
      .eq('company_id', companyId)
      .maybeSingle();

    if (error) {
      throw new Error(
        `No se pudo consultar el código de país: ${error.message}`,
      );
    }

    return this.object(data?.settings);
  }

  private render(body: string, variables: JsonObject): string {
    let rendered = body;

    for (const [key, value] of Object.entries(variables)) {
      rendered = rendered
        .split(`{{${key}}}`)
        .join(this.firstText(value));
    }

    const unresolved = rendered.match(/{{[a-z0-9_]+}}/gi);

    if (unresolved?.length) {
      throw new Error(
        `No se pudieron completar estas variables: ${Array.from(
          new Set(unresolved),
        ).join(', ')}.`,
      );
    }

    return rendered.trim().slice(0, 4000);
  }

  private orderSummary(payload: JsonObject): string {
    const items = Array.isArray(payload.line_items)
      ? payload.line_items
      : [];
    const lines = items.slice(0, 20).map((value) => {
      const item = this.object(value);
      const quantity = Math.max(
        Math.floor(Number(item.quantity) || 1),
        1,
      );
      const title = this.firstText(item.title, item.name) || 'Producto';
      const variant = this.firstText(item.variant_title);
      const visibleVariant =
        variant && variant.toLowerCase() !== 'default title'
          ? ` · ${variant}`
          : '';

      return `• ${quantity} x ${title}${visibleVariant}`;
    });

    return lines.join('\n') || '• Compra registrada en Shopify';
  }

  private money(amountValue: unknown, currencyValue: unknown): string {
    const amount = Number(amountValue);
    const currency = this.firstText(currencyValue).toUpperCase() || 'COP';

    if (!Number.isFinite(amount)) {
      return this.firstText(amountValue);
    }

    try {
      return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      }).format(amount);
    } catch {
      return `${amount} ${currency}`;
    }
  }

  private fullName(value: JsonObject): string {
    return [
      this.firstText(value.first_name),
      this.firstText(value.last_name),
    ]
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value
          .map((item) => this.firstText(item))
          .filter(Boolean)
      : [];
  }

  private object(value: unknown): JsonObject {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as JsonObject)
      : {};
  }

  private firstText(...values: unknown[]): string {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }

      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
      }
    }

    return '';
  }

  private async markProcessed(eventId: string): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.supabaseService
      .getClient()
      .from('shopify_webhook_events')
      .update({
        status: 'processed',
        processed_at: now,
        failed_at: null,
        next_retry_at: null,
        error_message: null,
        updated_at: now,
      })
      .eq('id', eventId);

    if (error) {
      throw new Error(
        `No se pudo cerrar el evento procesado: ${error.message}`,
      );
    }
  }

  private async markIgnored(
    eventId: string,
    reason: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.supabaseService
      .getClient()
      .from('shopify_webhook_events')
      .update({
        status: 'ignored',
        processed_at: now,
        next_retry_at: null,
        error_message: reason,
        updated_at: now,
      })
      .eq('id', eventId);

    if (error) {
      throw new Error(
        `No se pudo omitir el evento sin guía: ${error.message}`,
      );
    }
  }

  private async markFailed(
    row: WebhookRow,
    errorValue: unknown,
  ): Promise<void> {
    const now = new Date();
    const attempts = Number(row.attempt_count ?? 0);
    const retry = attempts < 5;
    const { error } = await this.supabaseService
      .getClient()
      .from('shopify_webhook_events')
      .update({
        status: 'failed',
        failed_at: now.toISOString(),
        next_retry_at: retry
          ? new Date(now.getTime() + 2 * 60 * 1000).toISOString()
          : null,
        error_message: this.errorMessage(errorValue),
        updated_at: now.toISOString(),
      })
      .eq('id', row.id);

    if (error) {
      this.logger.error(
        `No se pudo registrar el error del evento ${row.id}: ${error.message}`,
      );
    }
  }

  private errorMessage(value: unknown): string {
    return (value instanceof Error ? value.message : 'Error desconocido.')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 700);
  }
}
