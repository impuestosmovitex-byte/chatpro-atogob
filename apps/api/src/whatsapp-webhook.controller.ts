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
import { CompanyIntegrationService } from './company-integration.service';
import {
  ConversationMemoryService,
  type CompanyProfile,
  type ConversationSession,
} from './conversation-memory.service';

type ConversationStage =
  | 'main'
  | 'service'
  | 'sales'
  | 'product'
  | 'variant'
  | 'checkout';

@Controller('webhook/whatsapp')
export class WhatsappWebhookController {
  constructor(
    private readonly chatAgentService: ChatAgentService,
    private readonly conversationMemoryService: ConversationMemoryService,
    private readonly companyIntegrationService: CompanyIntegrationService,
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
      const incomingPhoneNumberId =
        this.getIncomingPhoneNumberId(body);

      const integration =
        await this.companyIntegrationService.findActiveIntegrationByExternalId(
          'meta',
          'whatsapp',
          incomingPhoneNumberId,
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

      const session =
        await this.conversationMemoryService.getOrCreateSessionByCompanyId(
          integration.companyId,
          phone,
        );

      const receivedMessage =
        await this.conversationMemoryService.saveMessage({
          companyId: profile.id,
          sessionId: session.id,
          customerPhone: phone,
          message: text,
          sender: 'customer',
          providerMessageId: incomingMessageId,
        });

      if (receivedMessage === 'duplicate') {
        console.log(`Mensaje duplicado ignorado de ${phone}`);
        return 'EVENT_RECEIVED';
      }

      const reply = await this.resolveReply(profile, session, text);

      await this.sendTextMessage(phone, reply);

      await this.conversationMemoryService.saveMessage({
        companyId: profile.id,
        sessionId: session.id,
        customerPhone: phone,
        message: reply,
        sender: 'assistant',
        aiResponse: reply,
      });

      console.log(`Respuesta enviada a ${phone}`);
    } catch (error) {
      console.error('No se pudo procesar la conversación:', error);

      try {
        await this.sendTextMessage(
          phone,
          'Estamos revisando la información para ayudarte. Por favor intenta nuevamente en unos minutos.',
        );
      } catch (sendError) {
        console.error('No se pudo enviar el mensaje de respaldo:', sendError);
      }
    }

    return 'EVENT_RECEIVED';
  }

  private async resolveReply(
    profile: CompanyProfile,
    session: ConversationSession,
    text: string,
  ): Promise<string> {
    const cleanText = text.toLowerCase().trim();
    const currentStage = this.getStage(session.stage);

    if (['hola', 'menu', 'menú', 'inicio', 'volver'].includes(cleanText)) {
      await this.conversationMemoryService.updateSession(session.id, {
        stage: 'main',
        context: {},
      });

      return this.mainMenu(profile);
    }

    if (currentStage === 'main') {
      if (cleanText === '1' || cleanText.includes('venta')) {
        await this.conversationMemoryService.updateSession(session.id, {
          stage: 'sales',
          context: {},
        });

        return [
          'Perfecto ✨',
          '¿Qué producto estás buscando?',
          'Puedes escribirme el nombre, categoría, color, talla, estilo o enviarme un enlace.',
        ].join('\n\n');
      }

      if (cleanText === '2' || cleanText.includes('servicio')) {
        await this.conversationMemoryService.updateSession(session.id, {
          stage: 'service',
          context: {},
        });

        return this.serviceMenu();
      }

      return this.mainMenu(profile);
    }

    if (currentStage === 'service') {
      return this.resolveServiceReply(session, cleanText);
    }

    return this.chatAgentService.reply(profile, session, text);
  }

  private async resolveServiceReply(
    session: ConversationSession,
    cleanText: string,
  ): Promise<string> {
    if (cleanText === '1') {
      await this.conversationMemoryService.updateSession(session.id, {
        stage: 'main',
        context: {},
      });

      return 'Para revisar tu pedido, envíame tu número de pedido o el número de celular con el que realizaste la compra.';
    }

    if (cleanText === '2') {
      await this.conversationMemoryService.updateSession(session.id, {
        stage: 'main',
        context: {},
      });

      return 'Cuéntame qué ocurrió con el producto y te orientaré sobre el proceso de garantía o cambio.';
    }

    if (cleanText === '3') {
      await this.conversationMemoryService.updateSession(session.id, {
        stage: 'main',
        context: {},
      });

      return 'Perfecto. Un asesor revisará tu caso y continuará la atención contigo.';
    }

    return this.serviceMenu();
  }

  private mainMenu(profile: CompanyProfile): string {
    const introduction = profile.assistantName
      ? `Soy ${profile.assistantName}, asistente virtual de ${profile.name}.`
      : `Soy el asistente virtual de ${profile.name}.`;

    return [
      'Hola 👋',
      introduction,
      '¿En qué puedo ayudarte?',
      '1️⃣ Ventas',
      '2️⃣ Servicio al cliente',
    ].join('\n\n');
  }

  private serviceMenu(): string {
    return [
      'Claro, elige una opción:',
      '1️⃣ Saber de mi pedido',
      '2️⃣ Garantías y cambios',
      '3️⃣ Hablar con un asesor',
    ].join('\n\n');
  }

  private getStage(stage: string): ConversationStage {
    if (
      stage === 'service' ||
      stage === 'sales' ||
      stage === 'product' ||
      stage === 'variant' ||
      stage === 'checkout'
    ) {
      return stage;
    }

    return 'main';
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
      typeof rawPhoneNumberId === 'string'
        ? rawPhoneNumberId.trim()
        : '';

    if (!phoneNumberId) {
      throw new Error(
        'Meta no envió el identificador del canal de WhatsApp.',
      );
    }

    return phoneNumberId;
  }

  private async sendTextMessage(to: string, body: string) {
    const accessToken = process.env.META_WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.META_PHONE_NUMBER_ID;

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