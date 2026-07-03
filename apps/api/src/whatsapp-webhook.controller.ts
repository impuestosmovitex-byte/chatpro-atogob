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
import { CompanyIntegrationService } from './company-integration.service';
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
    private readonly cartRecoveryContextService: CartRecoveryContextService,
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

      await this.sendTextMessage(input.phone, reply);

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
        await this.sendTextMessage(
          input.phone,
          'Estamos revisando la información para ayudarte. Por favor intenta nuevamente en unos minutos.',
        );
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

      return this.buildServiceAreaMenu(activeAreas, resetSession);
    }

    if (session.stage === 'main' || session.stage === 'area_menu') {
      const selectedArea = this.resolveServiceAreaChoice(activeAreas, cleanText);

      if (!selectedArea) {
        return this.buildServiceAreaMenu(activeAreas, session);
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

      return this.buildAreaWelcome(selectedArea.name, selectedSession);
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

  private buildServiceAreaMenu(
    areas: Array<{ id: string; name: string; description: string }>,
    _session: ConversationSession,
  ): string {
    if (!areas.length) {
      return 'Hola. Cuéntame en qué te podemos ayudar.';
    }

    const options = areas
      .map((area, index) => `${index + 1}. ${area.name}`)
      .join('\n');

    return `Hola, soy Sofía. ¿En qué te podemos ayudar?\n\n${options}\n\nRespóndeme con el número o el nombre de la opción.`;
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

  private async sendTextMessage(to: string, body: string) {
    const accessToken = process.env.META_WHATSAPP_ACCESS_TOKEN?.trim();
    const phoneNumberId = process.env.META_PHONE_NUMBER_ID?.trim();

    if (!accessToken || !phoneNumberId) {
      throw new Error('Faltan variables de Meta en Railway.');
    }

    const response = await fetch(
      `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(await response.text());
    }
  }
}
