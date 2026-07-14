import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ChatAgentService } from './chat-agent.service';
import { CartRecoveryContextService } from './cart-recovery-context.service';
import { CustomerOrderService } from './customer-order.service';
import { CompanyIntegrationService } from './company-integration.service';
import { WhatsappMessagingService } from './whatsapp-messaging.service';
import {
  ConversationMemoryService,
  type CompanyProfile,
  type ConversationSession,
} from './conversation-memory.service';

@Controller('webhook/whatsapp')
export class WhatsappWebhookController {
  private readonly conversationQueues = new Map<string, Promise<void>>();
  private readonly recentProductUrlMessages = new Map<string, number>();

  constructor(
    private readonly chatAgentService: ChatAgentService,
    private readonly conversationMemoryService: ConversationMemoryService,
    private readonly companyIntegrationService: CompanyIntegrationService,
    private readonly whatsappMessagingService: WhatsappMessagingService,
    private readonly cartRecoveryContextService: CartRecoveryContextService,
    private readonly customerOrderService: CustomerOrderService,
  ) {}

  @Get()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') verifyToken: string,
    @Query('hub.challenge') challenge: string,
    @Res() response: Response,
  ) {
    const expectedToken = process.env.META_WEBHOOK_VERIFY_TOKEN;

    if (mode === 'subscribe' && verifyToken === expectedToken) {
      return response.status(200).send(challenge);
    }

    return response.sendStatus(403);
  }

  @Post()
  @HttpCode(200)
  async receiveMessage(@Body() body: unknown) {
    const message = this.getIncomingMessage(body);

    if (!message || message.type !== 'text') {
      return 'EVENT_RECEIVED';
    }

    const phone = message.from?.trim();
    const text = message.text?.body?.trim() ?? '';
    const incomingMessageId = this.getIncomingMessageId(message);

    if (!phone || !text) {
      return 'EVENT_RECEIVED';
    }

    try {
      const incomingPhoneNumberId = this.getIncomingPhoneNumberId(body);
      const conversationKey = `${incomingPhoneNumberId}:${phone}`;
      const suppressReply = this.isRedundantProductReference(
        conversationKey,
        text,
      );

      if (this.isProductUrlMessage(text)) {
        this.recentProductUrlMessages.set(conversationKey, Date.now());
      }

      this.enqueueConversation(conversationKey, () =>
        this.processIncomingText({
          incomingPhoneNumberId,
          phone,
          text,
          incomingMessageId,
          suppressReply,
        }),
      );
    } catch (error) {
      console.error('No se pudo preparar el mensaje entrante:', error);
    }

    return 'EVENT_RECEIVED';
  }

  private enqueueConversation(
    conversationKey: string,
    task: () => Promise<void>,
  ): void {
    const previous =
      this.conversationQueues.get(conversationKey) ?? Promise.resolve();

    const next = previous
      .catch((error) => {
        console.error(
          `Falló una tarea anterior de la conversación ${conversationKey}:`,
          error,
        );
      })
      .then(() => task());

    this.conversationQueues.set(conversationKey, next);

    void next
      .catch((error) => {
        console.error(
          `Falló una tarea de la conversación ${conversationKey}:`,
          error,
        );
      })
      .finally(() => {
        if (this.conversationQueues.get(conversationKey) === next) {
          this.conversationQueues.delete(conversationKey);
        }
      });
  }

  private isProductUrlMessage(text: string): boolean {
    return /https?:\/\/\S+\/products\//i.test(text);
  }

  private isRedundantProductReference(
    conversationKey: string,
    text: string,
  ): boolean {
    const lastUrlAt = this.recentProductUrlMessages.get(conversationKey);

    if (!lastUrlAt) {
      return false;
    }

    if (Date.now() - lastUrlAt > 10_000) {
      this.recentProductUrlMessages.delete(conversationKey);
      return false;
    }

    const normalized = text
      .toLocaleLowerCase('es-CO')
      .trim()
      .replace(/[¡!¿?.,]/g, '');

    const redundantReferences = [
      'esta',
      'este',
      'esa',
      'ese',
      'la de arriba',
      'el de arriba',
    ];

    if (!redundantReferences.includes(normalized)) {
      return false;
    }

    this.recentProductUrlMessages.delete(conversationKey);
    return true;
  }

  private async processIncomingText(input: {
    incomingPhoneNumberId: string;
    phone: string;
    text: string;
    incomingMessageId: string | null;
    suppressReply: boolean;
  }): Promise<void> {
    try {
      const integration =
        await this.companyIntegrationService.findActiveIntegrationByExternalId(
          'meta',
          'whatsapp',
          input.incomingPhoneNumberId,
        );

      if (!integration) {
        throw new Error(
          'No existe una empresa activa para el canal de WhatsApp entrante.',
        );
      }

      const profile =
        await this.conversationMemoryService.getCompanyProfileById(
          integration.companyId,
        );

      let session =
        await this.conversationMemoryService.getOrCreateSessionByCompanyId(
          integration.companyId,
          input.phone,
        );

      const receivedMessage =
        await this.conversationMemoryService.saveMessage({
          companyId: profile.id,
          sessionId: session.id,
          customerPhone: input.phone,
          message: input.text,
          sender: 'customer',
          authorType: 'customer',
          providerMessageId: input.incomingMessageId,
        });

      if (receivedMessage === 'duplicate') {
        console.log(`Mensaje duplicado ignorado de ${input.phone}`);
        return;
      }

      await this.conversationMemoryService.touchSession(session.id);

      if (input.suppressReply) {
        return;
      }

      if (
        session.attentionStatus === 'waiting' ||
        session.attentionStatus === 'human'
      ) {
        console.log(`Mensaje recibido para atención humana de ${input.phone}`);
        return;
      }

      if (session.attentionStatus === 'closed') {
        session = await this.conversationMemoryService.resumeAiConversation(
          session.id,
        );
      }

      session = await this.attachRecoveryContext(
        session,
        profile.id,
        input.phone,
      );

      const reply = await this.resolveReply(profile, session, input.text);

      await this.whatsappMessagingService.sendText(
        profile.id,
        input.phone,
        reply,
      );

      await this.conversationMemoryService.saveMessage({
        companyId: profile.id,
        sessionId: session.id,
        customerPhone: input.phone,
        message: reply,
        sender: 'assistant',
        authorType: 'ai',
        aiResponse: reply,
      });

      await this.conversationMemoryService.touchSession(session.id);
      console.log(`Respuesta enviada a ${input.phone}`);
    } catch (error) {
      console.error('No se pudo procesar la conversación:', error);

      try {
        const fallbackIntegration =
          await this.companyIntegrationService.findActiveIntegrationByExternalId(
            'meta',
            'whatsapp',
            input.incomingPhoneNumberId,
          );

        if (fallbackIntegration) {
          await this.whatsappMessagingService.sendText(
            fallbackIntegration.companyId,
            input.phone,
            'Estamos revisando la información para ayudarte. Por favor intenta nuevamente en unos minutos.',
          );
        }
      } catch (sendError) {
        console.error('No se pudo enviar el mensaje de respaldo:', sendError);
      }
    }
  }

  private async attachRecoveryContext(
    session: ConversationSession,
    companyId: string,
    customerPhone: string,
  ): Promise<ConversationSession> {
    try {
      const recovery =
        await this.cartRecoveryContextService.findForCustomer(
          companyId,
          customerPhone,
        );

      if (!recovery) {
        return session;
      }

      const recoveryContext = recovery.context;
      const initializedCartId =
        typeof session.context.cart_recovery_initialized_id === 'string'
          ? session.context.cart_recovery_initialized_id
          : null;

      if (initializedCartId === recoveryContext.cart_id) {
        return session;
      }

      const nextContext: Record<string, unknown> = {
        ...session.context,
        cart_recovery: recoveryContext,
        cart_recovery_initialized_id: recoveryContext.cart_id,
        cart: recovery.cartLines,
      };

      delete nextContext.selectedProduct;
      delete nextContext.selectedVariant;
      delete nextContext.selectedVariants;
      delete nextContext.selectedAt;
      delete nextContext.selectedVariantAt;
      delete nextContext.purchaseIntent;
      delete nextContext.purchaseIntentAt;
      delete nextContext.lastCartUrl;
      delete nextContext.lastCheckoutUrl;
      delete nextContext.lastCartUpdatedAt;
      delete nextContext.checkoutCreatedAt;

      return this.conversationMemoryService.updateSession(session.id, {
        stage: 'sales',
        context: nextContext,
      });
    } catch (error) {
      console.error(
        `No se pudo adjuntar el contexto de recuperación para ${customerPhone}:`,
        error,
      );
      return session;
    }
  }

  private async resolveReply(
    profile: CompanyProfile,
    session: ConversationSession,
    text: string,
  ): Promise<string> {
    const cleanText = text.toLocaleLowerCase('es-CO').trim();
    const activeAreas =
      await this.conversationMemoryService.listActiveServiceAreas(profile.id);

    if (['hola', 'menu', 'menú', 'inicio', 'volver'].includes(cleanText)) {
      const nextContext = { ...session.context };
      delete nextContext.service_area;

      const resetSession = await this.conversationMemoryService.updateSession(
        session.id,
        { stage: 'area_menu', context: nextContext },
      );

      return this.buildServiceAreaMenu(profile, activeAreas, resetSession);
    }

    if (session.stage === 'main' || session.stage === 'area_menu') {
      const selectedArea = this.resolveServiceAreaChoice(activeAreas, cleanText);

      if (!selectedArea) {
        return this.buildServiceAreaMenu(profile, activeAreas, session);
      }

      const selectedSession = await this.conversationMemoryService.updateSession(
        session.id,
        {
          stage: 'active',
          context: {
            ...session.context,
            service_area: {
              id: selectedArea.id,
              name: selectedArea.name,
              description: selectedArea.description,
              selected_at: new Date().toISOString(),
            },
          },
        },
      );

      if (this.isCustomerServiceSession(selectedSession)) {
        return this.startCustomerServiceMenu(selectedSession);
      }

      return this.chatAgentService.reply(profile, selectedSession, text);
    }

    if (session.stage === 'main' || session.stage === 'area_menu') {
      const defaultArea =
        await this.conversationMemoryService.getDefaultServiceArea(profile.id);

      const nextSession =
        defaultArea
          ? await this.conversationMemoryService.updateSession(session.id, {
              stage: 'active',
              context: {
                ...session.context,
                service_area: {
                  id: defaultArea.id,
                  name: defaultArea.name,
                  description: defaultArea.description,
                  selected_at: new Date().toISOString(),
                  selected_automatically: true,
                },
              },
            })
          : session;

      return this.chatAgentService.reply(profile, nextSession, text);
    }

    const customerServiceReply = await this.resolveCustomerServiceReply(
      session,
      cleanText,
      text,
    );

    if (customerServiceReply) {
      return customerServiceReply;
    }

    return this.chatAgentService.reply(profile, session, text);
  }

  private resolveServiceAreaChoice(
    areas: Array<{ id: string; name: string; description: string }>,
    cleanText: string,
  ): { id: string; name: string; description: string } | null {
    const numericChoice = Number(cleanText);

    if (
      Number.isInteger(numericChoice) &&
      numericChoice >= 1 &&
      numericChoice <= areas.length
    ) {
      return areas[numericChoice - 1] ?? null;
    }

    return (
      areas.find((area) => {
        const name = area.name.toLocaleLowerCase('es-CO');
        return cleanText === name || cleanText.includes(name);
      }) ?? null
    );
  }


  private async startCustomerServiceMenu(session: ConversationSession) {
    await this.conversationMemoryService.updateSession(session.id, {
      stage: 'active',
      context: {
        ...session.context,
        customer_service_flow: {
          type: 'menu',
          updated_at: new Date().toISOString(),
        },
      },
    });

    return this.buildCustomerServiceMenu();
  }

  private async resolveCustomerServiceReply(
    session: ConversationSession,
    cleanText: string,
    originalText: string,
  ): Promise<string | null> {
    if (!this.isCustomerServiceSession(session)) {
      return null;
    }

    const flow = this.readCustomerServiceFlow(session.context);

    if (['menu', 'menú', 'inicio', 'volver'].includes(cleanText)) {
      return this.startCustomerServiceMenu(session);
    }

    if (
      cleanText === '1' ||
      this.includesAny(cleanText, [
        'consultar estado',
        'estado de mi pedido',
        'estado pedido',
        'seguimiento pedido',
        'rastrear pedido',
        'guia',
        'guía',
      ])
    ) {
      await this.conversationMemoryService.updateSession(session.id, {
        stage: 'active',
        context: {
          ...session.context,
          customer_service_flow: {
            type: 'order_lookup',
            identifiers: {},
            attempts: 0,
            updated_at: new Date().toISOString(),
          },
        },
      });

      return 'Perfecto 😊 ¿Me puedes enviar el número de pedido o el celular que usaste en la compra para consultarlo?';
    }

    if (cleanText === '2') {
      await this.conversationMemoryService.updateSession(session.id, {
        stage: 'active',
        context: {
          ...session.context,
          customer_service_flow: {
            type: 'order_problem',
            updated_at: new Date().toISOString(),
          },
        },
      });

      return 'Claro 😊 Cuéntame qué problema tienes con tu pedido y envíame el número de pedido o celular registrado en la compra. Si aplica, también puedes enviar foto o video.';
    }

    if (cleanText === '3') {
      await this.conversationMemoryService.updateSession(session.id, {
        stage: 'active',
        context: {
          ...session.context,
          customer_service_flow: {
            type: 'exchange_warranty',
            updated_at: new Date().toISOString(),
          },
        },
      });

      return 'Claro 😊 Para revisar cambios, garantías o devoluciones, envíame el número de pedido o celular usado en la compra y cuéntame brevemente qué necesitas.';
    }

    if (cleanText === '4') {
      await this.conversationMemoryService.updateSession(session.id, {
        stage: 'active',
        context: {
          ...session.context,
          customer_service_flow: {
            type: 'payment_problem',
            updated_at: new Date().toISOString(),
          },
        },
      });

      return 'Claro 😊 ¿Qué medio de pago estás usando y cuál es el inconveniente? No envíes claves, códigos de seguridad ni datos bancarios sensibles.';
    }

    if (
      cleanText === '5' ||
      this.includesAny(cleanText, ['asesor', 'persona', 'humano'])
    ) {
      return this.requestCustomerServiceHuman(
        session,
        'Cliente solicitó asesor desde el menú de servicio al cliente.',
        'El cliente pidió hablar con un asesor humano.',
      );
    }

    if (flow.type === 'order_lookup') {
      return this.resolveOrderLookup(session, originalText, flow);
    }

    return null;
  }

  private async resolveOrderLookup(
    session: ConversationSession,
    originalText: string,
    flow: Record<string, unknown>,
  ) {
    const identifier = this.parseOrderIdentifier(originalText);

    if (!identifier.orderReference && !identifier.email && !identifier.phone) {
      return 'Para revisarlo necesito un dato concreto 😊 Envíame el número de pedido, el celular o el correo usado en la compra.';
    }

    const previousIdentifiers =
      flow.identifiers &&
      typeof flow.identifiers === 'object' &&
      !Array.isArray(flow.identifiers)
        ? flow.identifiers as Record<string, unknown>
        : {};

    const lookupIdentifiers = {
      orderReference:
        identifier.orderReference ||
        this.cleanFlowString(previousIdentifiers.orderReference),
      email:
        identifier.email ||
        this.cleanFlowString(previousIdentifiers.email),
      phone:
        identifier.phone ||
        this.cleanFlowString(previousIdentifiers.phone),
    };

    let result: Record<string, any>;

    try {
      result = await this.customerOrderService.lookup(
        session.companyId,
        lookupIdentifiers,
      ) as Record<string, any>;
    } catch {
      return this.requestCustomerServiceHuman(
        session,
        'Error técnico al consultar pedido.',
        `Falló la consulta de pedido. Datos usados: pedido=${lookupIdentifiers.orderReference || '-'}, email=${lookupIdentifiers.email || '-'}, phone=${lookupIdentifiers.phone || '-'}.`,
      );
    }

    const nextContext = {
      ...session.context,
      customer_service_flow: {
        type: 'order_lookup',
        identifiers: lookupIdentifiers,
        attempts: Number(flow.attempts ?? 0) + 1,
        updated_at: new Date().toISOString(),
      },
    };

    await this.conversationMemoryService.updateSession(session.id, {
      stage: 'active',
      context: nextContext,
    });

    if (
      result.ok &&
      result.found &&
      Array.isArray(result.orders) &&
      result.orders.length
    ) {
      await this.conversationMemoryService.updateSession(session.id, {
        stage: 'active',
        context: {
          ...nextContext,
          customer_service_flow: {
            type: 'menu',
            updated_at: new Date().toISOString(),
          },
          last_order_lookup: {
            order_name: result.orders[0].name,
            found_at: new Date().toISOString(),
          },
        },
      });

      return this.formatOrderLookupReply(result.orders[0]);
    }

    if (result.next_action === 'ask_alternate_identifier') {
      if (identifier.orderReference) {
        return 'No encontré el pedido con ese número 😕 ¿Me confirmas el celular o correo usado en la compra para revisarlo mejor?';
      }

      return 'No encontré el pedido con ese dato 😕 ¿Me confirmas el número de pedido o algún otro dato de la compra?';
    }

    return this.requestCustomerServiceHuman(
      session,
      'No se pudo encontrar el pedido con los datos enviados.',
      `Consulta de pedido sin resultado. Datos usados: pedido=${lookupIdentifiers.orderReference || '-'}, email=${lookupIdentifiers.email || '-'}, phone=${lookupIdentifiers.phone || '-'}.`,
    );
  }

  private formatOrderLookupReply(order: Record<string, any>) {
    const items = Array.isArray(order.items) ? order.items : [];
    const firstTracking = this.getFirstOrderTracking(order);
    const hasTracking = Boolean(firstTracking);
    const orderName = order.name ? ` ${order.name}` : '';
    const customerName = this.getOrderCustomerName(order);
    const lines: string[] = [];

    if (customerName) {
      lines.push(
        `Perfecto 😊 encontré tu pedido${orderName} a nombre de ${customerName}.`,
      );
    } else {
      lines.push(`Perfecto 😊 encontré tu pedido${orderName}.`);
    }

    const paymentMessage = this.customerPaymentStatusMessage(
      order.financial_status,
    );

    if (paymentMessage) {
      lines.push(paymentMessage);
    }

    const fulfillmentMessage = this.customerFulfillmentStatusMessage(
      order.fulfillment_status,
      hasTracking,
    );

    if (fulfillmentMessage) {
      lines.push(fulfillmentMessage);
    }

    const total = this.formatOrderMoney(order.total);

    if (items.length) {
      const productSummary = items
        .slice(0, 6)
        .map((item) => {
          const title = this.cleanCustomerText(item.title || 'Producto');
          const quantity = Number(item.quantity ?? 1);
          const variant = item.variant_title
            ? ` - ${this.cleanCustomerText(item.variant_title)}`
            : '';

          return `• ${title}${variant} x${quantity}`;
        })
        .join('\n');

      lines.push(`Productos:\n${productSummary}`);
    }

    if (total) {
      lines.push(`Total del pedido: ${total}`);
    }

    if (firstTracking) {
      const trackingLines = ['Información de envío:'];

      if (firstTracking.company) {
        trackingLines.push(
          `Transportadora: ${this.cleanCustomerText(firstTracking.company)}`,
        );
      }

      if (firstTracking.number) {
        trackingLines.push(`Guía: ${this.cleanCustomerText(firstTracking.number)}`);
      }

      if (firstTracking.url) {
        trackingLines.push(`Seguimiento: ${firstTracking.url}`);
      }

      lines.push(trackingLines.join('\n'));
    } else if (this.normalizeOrderStatus(order.fulfillment_status) === 'fulfilled') {
      lines.push(
        'Tu pedido aparece como despachado, pero en este momento no tengo la guía disponible en la información recibida. Puedo dejarlo con un asesor para revisarla.',
      );
    } else {
      lines.push(
        'Cuando el pedido sea despachado, se registrará la guía de seguimiento.',
      );
    }

    return lines.join('\n\n').trim();
  }

  private getFirstOrderTracking(order: Record<string, any>) {
    const tracking = Array.isArray(order.tracking) ? order.tracking : [];

    return tracking.find(
      (item) => item?.number || item?.url || item?.company,
    );
  }

  private getOrderCustomerName(order: Record<string, any>) {
    const customerName = this.cleanCustomerText(order.customer?.name || '');
    const shippingName = this.cleanCustomerText(order.shipping_address?.name || '');
    const name = customerName || shippingName;

    return name.length > 70 ? name.slice(0, 70).trim() : name;
  }

  private customerPaymentStatusMessage(status: unknown) {
    switch (this.normalizeOrderStatus(status)) {
      case 'paid':
        return 'Tu pago ya aparece confirmado.';
      case 'pending':
        return 'Tu pago todavía aparece pendiente de confirmación.';
      case 'authorized':
        return 'Tu pago aparece autorizado y está en proceso de confirmación.';
      case 'partially_paid':
        return 'El pedido aparece con pago parcial.';
      case 'refunded':
        return 'El pedido aparece reembolsado.';
      case 'partially_refunded':
        return 'El pedido aparece con un reembolso parcial.';
      case 'voided':
        return 'El pago aparece anulado.';
      default:
        return '';
    }
  }

  private customerFulfillmentStatusMessage(status: unknown, hasTracking: boolean) {
    switch (this.normalizeOrderStatus(status)) {
      case 'fulfilled':
        return hasTracking
          ? 'Tu pedido ya fue despachado.'
          : 'Tu pedido aparece como despachado.';
      case 'partial':
      case 'partially_fulfilled':
        return 'Tu pedido aparece parcialmente despachado.';
      case 'unfulfilled':
      case 'restocked':
        return 'Tu pedido está en preparación.';
      case 'on_hold':
        return 'Tu pedido está en revisión antes del despacho.';
      case 'scheduled':
        return 'Tu pedido está programado para despacho.';
      case 'request_declined':
        return 'El despacho del pedido requiere revisión.';
      default:
        return '';
    }
  }

  private formatOrderMoney(value: unknown) {
    if (!value || typeof value !== 'object') {
      return '';
    }

    const money = value as { amount?: unknown; currencyCode?: unknown };
    const amount = Number(money.amount);
    const currency = String(money.currencyCode || 'COP').trim() || 'COP';

    if (!Number.isFinite(amount)) {
      return '';
    }

    return `${new Intl.NumberFormat('es-CO', {
      maximumFractionDigits: 0,
    }).format(amount)} ${currency}`;
  }

  private normalizeOrderStatus(status: unknown) {
    return String(status || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
  }

  private cleanCustomerText(value: unknown) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }


  private async requestCustomerServiceHuman(
    session: ConversationSession,
    reason: string,
    summary: string,
  ) {
    await this.conversationMemoryService.requestHumanAttention(session.id, {
      reason,
      summary,
    });

    return 'Claro, voy a dejar tu solicitud para que un asesor continúe contigo. Ya queda con el contexto de lo que revisamos 😊';
  }

  private buildCustomerServiceMenu() {
    return [
      'Hola, cuéntame cómo puedo ayudarte 😊',
      '',
      '1️⃣ Consultar estado de mi pedido',
      '2️⃣ Tengo un problema con mi pedido',
      '3️⃣ Cambios, garantías o devoluciones',
      '4️⃣ Problemas con pago',
      '5️⃣ Hablar con un asesor',
    ].join('\n');
  }

  private isCustomerServiceSession(session: ConversationSession) {
    const context = session.context && typeof session.context === 'object'
      ? session.context as Record<string, unknown>
      : {};
    const area =
      context.service_area &&
      typeof context.service_area === 'object' &&
      !Array.isArray(context.service_area)
        ? context.service_area as Record<string, unknown>
        : {};
    const value = this.normalizeText(
      `${area.name ?? ''} ${area.description ?? ''}`,
    );

    return (
      value.includes('servicio') ||
      value.includes('soporte') ||
      value.includes('pedido') ||
      value.includes('seguimiento') ||
      value.includes('post compra')
    );
  }

  private readCustomerServiceFlow(context: Record<string, unknown>) {
    const flow = context.customer_service_flow;

    return flow && typeof flow === 'object' && !Array.isArray(flow)
      ? flow as Record<string, unknown>
      : {};
  }

  private parseOrderIdentifier(value: string) {
    const text = value.trim();
    const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    const digits = text.replace(/\D/g, '');
    const normalized = this.normalizeText(text);

    if (emailMatch) {
      return {
        orderReference: '',
        email: emailMatch[0].toLowerCase(),
        phone: '',
      };
    }

    if (
      digits.length >= 10 ||
      this.includesAny(normalized, ['celular', 'telefono', 'teléfono', 'whatsapp'])
    ) {
      return {
        orderReference: '',
        email: '',
        phone: digits,
      };
    }

    if (digits.length >= 3) {
      return {
        orderReference: digits,
        email: '',
        phone: '',
      };
    }

    return {
      orderReference: '',
      email: '',
      phone: '',
    };
  }

  private cleanFlowString(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }

  private includesAny(value: string, needles: string[]) {
    return needles.some((needle) => value.includes(this.normalizeText(needle)));
  }

  private humanizeOrderStatus(value: unknown) {
    const status = typeof value === 'string' ? value.trim() : '';

    if (!status) {
      return 'Sin dato';
    }

    return status
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (character) => character.toUpperCase());
  }

  private normalizeText(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('es-CO')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }


  private buildServiceAreaMenu(
    profile: CompanyProfile,
    areas: Array<{ id: string; name: string; description: string }>,
    _session: ConversationSession,
  ): string {
    const assistantName =
      profile.assistantName?.trim() || 'nuestro asistente';
    const configuredWelcome = this.getCommercialWelcome(profile.settings);
    const welcome = this.applyWelcomeTokens(
      configuredWelcome ||
        `Hola, soy ${assistantName} de ${profile.name}. ¿En qué te podemos ayudar?`,
      profile,
      assistantName,
    );

    if (!areas.length) {
      return welcome;
    }

    const options = areas
      .map((area, index) => `${index + 1}. ${area.name}`)
      .join('\n');

    return `${welcome}\n\n${options}\n\nRespóndeme con el número o el nombre de la opción.`;
  }

  private getCommercialWelcome(
    settings: Record<string, unknown>,
  ): string {
    const flow =
      settings.commercial_flow &&
      typeof settings.commercial_flow === 'object' &&
      !Array.isArray(settings.commercial_flow)
        ? settings.commercial_flow as Record<string, unknown>
        : {};

    return typeof flow.welcome_message === 'string'
      ? flow.welcome_message.trim()
      : '';
  }

  private applyWelcomeTokens(
    value: string,
    profile: CompanyProfile,
    assistantName: string,
  ): string {
    return value
      .replace(/\{asistente\}/gi, assistantName)
      .replace(/\{empresa\}/gi, profile.name)
      .trim();
  }

  private buildAreaWelcome(
    areaName: string,
    _session: ConversationSession,
  ): string {
    return `Perfecto, te ayudo con ${areaName}. Cuéntame qué necesitas.`;
  }

  private getIncomingMessage(body: any) {
    return body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0] ?? null;
  }

  private getIncomingMessageId(message: any): string | null {
    const rawMessageId = message?.id;

    return typeof rawMessageId === 'string' && rawMessageId.trim()
      ? rawMessageId.trim()
      : null;
  }

  private getIncomingPhoneNumberId(body: any): string {
    const rawPhoneNumberId =
      body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;

    const phoneNumberId =
      typeof rawPhoneNumberId === 'string' ? rawPhoneNumberId.trim() : '';

    if (!phoneNumberId) {
      throw new Error(
        'Meta no envió el identificador del canal de WhatsApp.',
      );
    }

    return phoneNumberId;
  }

}
