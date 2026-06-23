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

type ConversationStep = 'main' | 'service';

@Controller('webhook/whatsapp')
export class WhatsappWebhookController {
  private readonly conversationSteps = new Map<string, ConversationStep>();

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

    const phone = message.from;
    const text = message.text?.body?.trim().toLowerCase() ?? '';

    const reply = this.buildReply(phone, text);

    try {
      await this.sendTextMessage(phone, reply);
      console.log(`Respuesta enviada a ${phone}`);
    } catch (error) {
      console.error('No se pudo enviar la respuesta:', error);
    }

    return 'EVENT_RECEIVED';
  }

  private buildReply(phone: string, text: string) {
    const currentStep = this.conversationSteps.get(phone) ?? 'main';

    if (currentStep === 'service') {
      if (text === '1') {
        this.conversationSteps.set(phone, 'main');

        return 'Para revisar tu pedido, envíame tu número de pedido o el número de celular con el que realizaste la compra.';
      }

      if (text === '2') {
        this.conversationSteps.set(phone, 'main');

        return 'Cuéntame qué ocurrió con el producto y te orientaré sobre el proceso de garantía o cambio.';
      }

      if (text === '3') {
        this.conversationSteps.set(phone, 'main');

        return 'Perfecto. Un asesor de ATOGOB revisará tu caso y continuará la atención contigo.';
      }

      return 'Elige una opción:\n\n1️⃣ Saber de mi pedido\n2️⃣ Garantías y cambios\n3️⃣ Hablar con un asesor';
    }

    if (text === '1' || text.includes('venta')) {
      return 'Perfecto ✨ ¿Qué producto estás buscando?\n\nPuedes escribirme el nombre, categoría, color o enviarme una foto.';
    }

    if (text === '2' || text.includes('servicio')) {
      this.conversationSteps.set(phone, 'service');

      return 'Claro, elige una opción:\n\n1️⃣ Saber de mi pedido\n2️⃣ Garantías y cambios\n3️⃣ Hablar con un asesor';
    }

    return 'Hola 👋\n\nSoy Daniela de ATOGOB.\n¿En qué puedo ayudarte?\n\n1️⃣ Ventas\n2️⃣ Servicio al cliente';
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
      const error = await response.text();
      throw new Error(error);
    }
  }
}