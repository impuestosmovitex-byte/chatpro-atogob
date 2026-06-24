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
import { ShopifyService } from './shopify.service';

type ConversationStage = 'main' | 'service' | 'sales' | 'product';

type PreparedReply = {
  reply: string;
  companyId: string;
  sessionId: string;
};

type ShopifyProduct = NonNullable<
  Awaited<ReturnType<ShopifyService['getProductByHandle']>>
>;

type SelectedProduct = {
  id: string;
  handle: string;
  title: string;
  url: string;
};

@Controller('webhook/whatsapp')
export class WhatsappWebhookController {
  constructor(
    private readonly aiService: AiService,
    private readonly shopifyService: ShopifyService,
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

    if (currentStage === 'product') {
      return this.resolveSelectedProductReply(session, cleanText);
    }

    if (currentStage === 'sales') {
      return this.resolveSalesReply(session, text);
    }

    if (cleanText === '1' || cleanText.includes('venta')) {
      await this.conversationMemoryService.updateSession(session.id, {
        stage: 'sales',
        context: {},
      });

      return [
        'Perfecto.',
        '¿Qué producto estás buscando?',
        'Puedes escribirme el nombre, categoría, color, talla, estilo o enviarme el enlace del producto.',
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

  private async resolveSalesReply(
    session: ConversationSession,
    text: string,
  ): Promise<string> {
    const productFromUrl = await this.shopifyService.getProductFromUrl(text);

    if (productFromUrl) {
      return this.selectProduct(session, productFromUrl, text);
    }

    const exactProduct = await this.findExactProductByTitle(text);

    if (exactProduct) {
      return this.selectProduct(session, exactProduct, text);
    }

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

  private async resolveSelectedProductReply(
    session: ConversationSession,
    cleanText: string,
  ): Promise<string> {
    const selectedProduct = this.readSelectedProduct(session.context);

    if (!selectedProduct) {
      await this.conversationMemoryService.updateSession(session.id, {
        stage: 'sales',
        context: {},
      });

      return 'Cuéntame qué producto buscas o envíame el enlace del producto.';
    }

    if (this.isConfirmation(cleanText)) {
      return [
        `Perfecto, seguimos con ${selectedProduct.title}.`,
        'Dime qué opciones quieres, por ejemplo talla, color, medida o cualquier característica que aparezca en el producto.',
      ].join('\n\n');
    }

    return [
      `Ya tengo seleccionado ${selectedProduct.title}.`,
      'Ahora dime qué opciones quieres, por ejemplo talla, color, medida o cualquier característica del producto.',
    ].join('\n\n');
  }

  private async selectProduct(
    session: ConversationSession,
    product: ShopifyProduct,
    customerMessage: string,
  ): Promise<string> {
    const selectedProduct: SelectedProduct = {
      id: product.id,
      handle: product.handle,
      title: product.title,
      url: product.onlineStoreUrl ?? '',
    };

    await this.conversationMemoryService.updateSession(session.id, {
      stage: 'product',
      context: {
        ...session.context,
        selectedProduct,
        selectedAt: new Date().toISOString(),
        lastCustomerMessage: customerMessage,
      },
    });

    return this.productDetailsReply(product);
  }

  private productDetailsReply(product: ShopifyProduct): string {
    const price = this.getStartingPrice(product);
    const options = this.getProductOptions(product);

    const parts = [`Perfecto, seleccionaste: ${product.title}.`];

    if (price !== null) {
      parts.push(`Precio desde ${this.formatPrice(price)}.`);
    }

    if (options.length) {
      parts.push(`Opciones del producto:\n${options.join('\n')}`);
    }

    if (product.onlineStoreUrl) {
      parts.push(`Puedes verlo aquí:\n${product.onlineStoreUrl}`);
    }

    parts.push(
      'Dime qué combinación de opciones quieres para continuar.',
    );

    return parts.join('\n\n');
  }

  private async findExactProductByTitle(
    text: string,
  ): Promise<ShopifyProduct | null> {
    const cleanText = text.trim();

    if (cleanText.length < 4 || cleanText.includes('/products/')) {
      return null;
    }

    const products = await this.shopifyService.searchCatalog(cleanText, 5);

    return (
      products.find(
        (product) =>
          this.normalizeText(product.title) === this.normalizeText(cleanText),
      ) ?? null
    );
  }

  private getProductOptions(product: ShopifyProduct): string[] {
    const options = new Map<string, Set<string>>();

    for (const { node: variant } of product.variants.edges) {
      for (const option of variant.selectedOptions) {
        const name = option.name.trim();
        const value = option.value.trim();

        if (!name || !value) {
          continue;
        }

        if (!options.has(name)) {
          options.set(name, new Set<string>());
        }

        options.get(name)?.add(value);
      }
    }

    return Array.from(options.entries()).map(
      ([name, values]) => `• ${name}: ${Array.from(values).join(', ')}`,
    );
  }

  private getStartingPrice(product: ShopifyProduct): string | null {
    const prices = product.variants.edges
      .map(({ node }) => Number(node.price))
      .filter((price) => Number.isFinite(price));

    if (!prices.length) {
      return null;
    }

    return String(Math.min(...prices));
  }

  private readSelectedProduct(
    context: Record<string, unknown>,
  ): SelectedProduct | null {
    const value = context.selectedProduct;

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const product = value as Record<string, unknown>;

    if (
      typeof product.id !== 'string' ||
      typeof product.handle !== 'string' ||
      typeof product.title !== 'string' ||
      typeof product.url !== 'string'
    ) {
      return null;
    }

    return {
      id: product.id,
      handle: product.handle,
      title: product.title,
      url: product.url,
    };
  }

  private isConfirmation(text: string): boolean {
    const confirmations = [
      'si',
      'sí',
      'me gusta',
      'me gusto',
      'quiero ese',
      'quiero esta',
      'quiero este',
      'esa',
      'este',
      'lo quiero',
      'la quiero',
      'me interesa',
    ];

    return confirmations.some((item) => text.includes(item));
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
      stage === 'sales' ||
      stage === 'service' ||
      stage === 'product'
    ) {
      return stage;
    }

    return 'main';
  }

  private normalizeText(value: string): string {
    return value
      .toLocaleLowerCase('es-CO')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private formatPrice(price: string): string {
    const numericPrice = Number(price);

    if (!Number.isFinite(numericPrice)) {
      return price;
    }

    return `$${numericPrice.toLocaleString('es-CO', {
      maximumFractionDigits: 0,
    })}`;
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