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
import { AiService } from './ai.service';
import {
  ConversationMemoryService,
  type CompanyProfile,
  type ConversationSession,
} from './conversation-memory.service';

type ConversationStage = 'main' | 'service' | 'sales';

type PreparedReply = {
  reply: string;
  companyId: string;
  sessionId: string;
};

@Controller('webhook/whatsapp')
export class WhatsappWebhookController {
  constructor(
    private readonly aiService: AiService,
    private readonly conversationMemoryService: ConversationMemoryService,
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
  async receiveMessage(@Body() body: any) {
    console.log('Mensaje recibido de WhatsApp:', JSON.stringify(body));

    const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message || message.type !== 'text') {
      return 'EVENT_RECEIVED';
    }

    const phone = message.from?.trim();
    const text = message.text?.body?.trim() ?? '';

    if (!phone || !text) {
      return 'EVENT_RECEIVED';
    }

    try {
      const prepared = await this.prepareReply(phone, text);

      await this.sendTextMessage(phone, prepared.reply);

      await this.conversationMemoryService.saveMessage({
        companyId: prepared.companyId,
        sessionId: prepared.sessionId,
        customerPhone: phone,
        message: prepared.reply,
        sender: 'assistant',
        aiResponse: prepared.reply,
      });

      console.log(`Respuesta enviada a ${phone}`);
    } catch (error) {
      console.error('No se pudo procesar o enviar la respuesta:', error);

      try {
        await this.sendTextMessage(
          phone,
          'Estamos teniendo un inconveniente momentáneo. Por favor intenta nuevamente en unos minutos.',
        );
      } catch (sendError) {
        console.error('No se pudo enviar el mensaje de respaldo:', sendError);
      }
    }

    return 'EVENT_RECEIVED';
  }

  private async prepareReply(
    phone: string,
    text: string,
  ): Promise<PreparedReply> {
    const companySlug = this.getCompanySlug();

    const profile =
      await this.conversationMemoryService.getCompanyProfile(companySlug);

    const session =
      await this.conversationMemoryService.getOrCreateSession(
        companySlug,
        phone,
      );

    await this.conversationMemoryService.saveMessage({
      companyId: profile.id,
      sessionId: session.id,
      customerPhone: phone,
      message: text,
      sender: 'customer',
    });

    const reply = await this.resolveReply(profile, session, text);

    return {
      reply,
      companyId: profile.id,
      sessionId: session.id,
    };
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

    if (currentStage === 'service') {
      return this.resolveServiceReply(session, cleanText);
    }

    if (currentStage === 'sales') {
      const reply = await this.aiService.answerSalesQuestion(text);

      await this.conversationMemoryService.updateSession(session.id, {
        stage: 'sales',
        context: {
          ...session.context,
          lastCustomerMessage: text,
          lastSalesReply: reply,
          lastSalesAt: new Date().toISOString(),
        },
      });

      return reply;
    }

    if (cleanText === '1' || cleanText.includes('venta')) {
      await this.conversationMemoryService.updateSession(session.id, {
        stage: 'sales',
        context: {},
      });

      return [
        'Perfecto.',
        '¿Qué producto estás buscando?',
        'Puedes escribirme el nombre, categoría, color, talla o estilo.',
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
    if (stage === 'sales' || stage === 'service') {
      return stage;
    }

    return 'main';
  }

  private getCompanySlug(): string {
    const companySlug = process.env.CHATPRO_COMPANY_SLUG?.trim();

    if (!companySlug) {
      throw new Error('Falta CHATPRO_COMPANY_SLUG en Railway.');
    }

    return companySlug;
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