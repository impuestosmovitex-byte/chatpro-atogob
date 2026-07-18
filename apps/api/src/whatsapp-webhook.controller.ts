import OpenAI, { toFile } from 'openai';
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
import { AutomationRuntimeService } from './automation-runtime.service';
import { CartRecoveryContextService } from './cart-recovery-context.service';
import { CustomerOrderService } from './customer-order.service';
import { CompanyIntegrationService } from './company-integration.service';
import { WhatsappMessagingService } from './whatsapp-messaging.service';
import { WhatsappTemplateExecutionService } from './whatsapp-template-execution.service';
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
    private readonly automationRuntimeService: AutomationRuntimeService,
    private readonly conversationMemoryService: ConversationMemoryService,
    private readonly companyIntegrationService: CompanyIntegrationService,
    private readonly whatsappMessagingService: WhatsappMessagingService,
    private readonly whatsappTemplateExecutionService: WhatsappTemplateExecutionService,
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
    const statuses = this.getDeliveryStatuses(body);

    for (const status of statuses) {
      try {
        const updated =
          await this.automationRuntimeService.applyProviderStatus(status);

        if (updated) {
          console.log(
            `Meta confirmó ${status.status} para ${status.messageId}.`,
          );
        }
      } catch (error) {
        console.error(
          `No se pudo aplicar el estado ${status.status} de Meta:`,
          error,
        );
      }
    }

    const message = this.getIncomingMessage(body);

    if (!message) {
      return 'EVENT_RECEIVED';
    }

    const phone =
      typeof message.from === 'string' ? message.from.trim() : '';
    const incomingMessageId = this.getIncomingMessageId(message);

    if (!phone) {
      return 'EVENT_RECEIVED';
    }

    try {
      const incomingPhoneNumberId = this.getIncomingPhoneNumberId(body);
      const conversationKey = `${incomingPhoneNumberId}:${phone}`;

      if (message.type === 'audio') {
        const mediaId =
          typeof message.audio?.id === 'string'
            ? message.audio.id.trim()
            : '';
        const mimeType =
          typeof message.audio?.mime_type === 'string'
            ? message.audio.mime_type.trim()
            : 'audio/ogg';

        if (!mediaId) {
          return 'EVENT_RECEIVED';
        }

        this.enqueueConversation(conversationKey, () =>
          this.processIncomingAudio({
            incomingPhoneNumberId,
            phone,
            incomingMessageId,
            mediaId,
            mimeType,
            voice: message.audio?.voice === true,
          }),
        );

        return 'EVENT_RECEIVED';
      }

      if (message.type === 'image') {
        const mediaId =
          typeof message.image?.id === 'string'
            ? message.image.id.trim()
            : '';
        const mimeType =
          typeof message.image?.mime_type === 'string'
            ? message.image.mime_type.trim()
            : 'image/jpeg';
        const caption =
          typeof message.image?.caption === 'string'
            ? message.image.caption.replace(/\s+/g, ' ').trim().slice(0, 1500)
            : '';

        if (!mediaId) {
          return 'EVENT_RECEIVED';
        }

        this.enqueueConversation(conversationKey, () =>
          this.processIncomingImage({
            incomingPhoneNumberId,
            phone,
            incomingMessageId,
            mediaId,
            mimeType,
            caption,
          }),
        );

        return 'EVENT_RECEIVED';
      }

      const buttonText = this.getIncomingButtonText(message);
      const text =
        message.type === 'text'
          ? message.text?.body?.trim() ?? ''
          : buttonText;

      if (!text) {
        return 'EVENT_RECEIVED';
      }

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
          templateButton: Boolean(buttonText),
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

  private async processIncomingImage(input: {
    incomingPhoneNumberId: string;
    phone: string;
    incomingMessageId: string | null;
    mediaId: string;
    mimeType: string;
    caption: string;
  }): Promise<void> {
    let profile: CompanyProfile | null = null;
    let session: ConversationSession | null = null;
    let replySent = false;

    try {
      const integration =
        await this.companyIntegrationService.findActiveIntegrationByExternalId(
          'meta',
          'whatsapp',
          input.incomingPhoneNumberId,
        );

      if (!integration) {
        throw new Error(
          'No existe una empresa activa para la imagen entrante.',
        );
      }

      profile =
        await this.conversationMemoryService.getCompanyProfileById(
          integration.companyId,
        );
      session =
        await this.conversationMemoryService.getOrCreateSessionByCompanyId(
          integration.companyId,
          input.phone,
        );

      const customerMessage = input.caption
        ? `📷 Imagen recibida: ${input.caption}`
        : '📷 Imagen recibida.';

      const saved = await this.conversationMemoryService.saveMessage({
        companyId: profile.id,
        sessionId: session.id,
        customerPhone: input.phone,
        message: customerMessage,
        sender: 'customer',
        authorType: 'customer',
        providerMessageId: input.incomingMessageId,
        messageType: 'text',
        mediaId: input.mediaId,
        mediaMimeType: input.mimeType,
        mediaFilename: 'imagen',
      });

      if (saved === 'duplicate') {
        return;
      }

      await this.conversationMemoryService.touchSession(session.id);

      if (
        session.attentionStatus === 'waiting' ||
        session.attentionStatus === 'human'
      ) {
        console.log(
          `Imagen guardada para atención humana de ${input.phone}`,
        );
        return;
      }

      if (session.attentionStatus === 'closed') {
        session =
          await this.conversationMemoryService.resumeAiConversation(
            session.id,
          );
      }

      const media = await this.whatsappMessagingService.downloadRawMedia(
        profile.id,
        input.mediaId,
        input.mimeType || 'image/jpeg',
      );

      const analysis = await this.analyzeIncomingImage({
        buffer: media.buffer,
        mimeType: media.mimeType,
        caption: input.caption,
        companyName: profile.name,
        companyInstructions: profile.aiInstructions,
      });

      session = await this.attachRecoveryContext(
        session,
        profile.id,
        input.phone,
      );

      const currentSession =
        await this.conversationMemoryService.getSessionById(session.id);
      const receivedAt = new Date().toISOString();

      session = await this.conversationMemoryService.updateSession(
        currentSession.id,
        {
          stage:
            currentSession.stage === 'main' ||
            currentSession.stage === 'area_menu'
              ? 'active'
              : currentSession.stage,
          context: {
            ...currentSession.context,
            last_visual_reference: {
              summary: analysis.summary,
              category: analysis.category,
              colors: analysis.colors,
              visible_text: analysis.visibleText,
              search_terms: analysis.searchTerms,
              source_hint: analysis.sourceHint,
              confidence: analysis.confidence,
              caption: input.caption || null,
              received_at: receivedAt,
            },
          },
        },
      );

      const visualCustomerMessage = [
        '[REFERENCIA_VISUAL]',
        input.caption
          ? `Texto escrito por el cliente junto a la imagen: ${input.caption}`
          : 'El cliente envió solamente una imagen y quiere atención sobre lo que aparece.',
        `Descripción visual: ${analysis.summary}`,
        `Categoría aproximada: ${analysis.category}`,
        analysis.colors.length
          ? `Colores observados: ${analysis.colors.join(', ')}`
          : '',
        analysis.visibleText
          ? `Texto visible en la imagen: ${analysis.visibleText}`
          : '',
        analysis.searchTerms.length
          ? `Términos útiles para consultar el catálogo: ${analysis.searchTerms.join(', ')}`
          : '',
        `Origen estimado: ${analysis.sourceHint}. Confianza: ${analysis.confidence}.`,
        'Atiende la intención del cliente usando OpenAI y la configuración de esta empresa.',
        'Consulta únicamente el catálogo real de la empresa mediante las herramientas disponibles.',
        'No afirmes que es una referencia exacta de la empresa solo por parecido visual.',
        'Si no existe coincidencia exacta, dilo con claridad y ofrece productos reales similares de la categoría detectada.',
      ].filter(Boolean).join('\n');

      const reply = await this.resolveReply(
        profile,
        session,
        visualCustomerMessage,
      );

      await this.whatsappMessagingService.sendText(
        profile.id,
        input.phone,
        reply,
      );
      replySent = true;

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
      console.log(`Imagen comprendida y respondida a ${input.phone}`);
    } catch (error) {
      console.error('No se pudo procesar la imagen entrante:', error);

      if (!replySent && profile && session) {
        const fallback =
          'Recibí la imagen, pero no logré analizarla correctamente. ' +
          'Puedes enviarla otra vez, escribir qué producto buscas o compartir el enlace para ayudarte.';

        try {
          await this.whatsappMessagingService.sendText(
            profile.id,
            input.phone,
            fallback,
          );

          await this.conversationMemoryService.saveMessage({
            companyId: profile.id,
            sessionId: session.id,
            customerPhone: input.phone,
            message: fallback,
            sender: 'assistant',
            authorType: 'ai',
            aiResponse: fallback,
          });

          await this.conversationMemoryService.touchSession(session.id);
        } catch (fallbackError) {
          console.error(
            'No se pudo enviar la respuesta de respaldo para la imagen:',
            fallbackError,
          );
        }
      }
    }
  }

  private async analyzeIncomingImage(input: {
    buffer: Buffer;
    mimeType: string;
    caption: string;
    companyName: string;
    companyInstructions: string;
  }): Promise<{
    summary: string;
    category: string;
    colors: string[];
    visibleText: string;
    searchTerms: string[];
    sourceHint: 'catalog_screenshot' | 'external_reference' | 'unknown';
    confidence: 'low' | 'medium' | 'high';
  }> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();

    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY no está configurada para analizar imágenes.',
      );
    }

    if (!input.buffer.length) {
      throw new Error('La imagen descargada está vacía.');
    }

    if (input.buffer.length > 15 * 1024 * 1024) {
      throw new Error('La imagen supera el límite seguro de 15 MB.');
    }

    const mimeType = input.mimeType
      .split(';')[0]
      .trim()
      .toLowerCase();
    const supportedMimeTypes = new Set([
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'image/gif',
    ]);

    if (!supportedMimeTypes.has(mimeType)) {
      throw new Error(
        `El formato ${mimeType || 'desconocido'} no es compatible con el análisis visual.`,
      );
    }

    const client = new OpenAI({ apiKey });
    const model =
      process.env.OPENAI_VISION_MODEL?.trim() ||
      process.env.OPENAI_MODEL?.trim() ||
      'gpt-5-mini';
    const dataUrl =
      `data:${mimeType};base64,${input.buffer.toString('base64')}`;

    const response = await client.responses.create({
      model,
      instructions: [
        'Analiza la imagen como referencia comercial enviada por un cliente.',
        'Devuelve únicamente JSON válido y sin markdown con esta estructura:',
        '{"summary":"...","category":"...","colors":["..."],"visible_text":"...","search_terms":["..."],"source_hint":"catalog_screenshot|external_reference|unknown","confidence":"low|medium|high"}',
        'summary: describe objetivamente el producto principal, sin inventar marca, referencia, precio, material, talla ni disponibilidad.',
        'category: categoría breve y útil en español para buscar dentro del catálogo real de la empresa.',
        'colors: únicamente colores claramente visibles.',
        'visible_text: copia solo texto comercial legible que ayude a identificar el producto; déjalo vacío si no es claro.',
        'search_terms: entre 1 y 6 términos cortos y útiles para buscar el producto o similares.',
        'catalog_screenshot: parece captura de una tienda, catálogo o publicación comercial.',
        'external_reference: parece una foto o referencia externa sin prueba de pertenecer a la empresa.',
        'unknown: no es posible determinar el origen.',
        'Nunca afirmes que el producto pertenece a la empresa ni que existe en su catálogo.',
        `Empresa activa: ${input.companyName}.`,
        `Instrucciones de la empresa: ${(input.companyInstructions || 'Sin instrucciones adicionales.').slice(0, 4000)}`,
      ].join('\n'),
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: input.caption
                ? `El cliente acompañó la imagen con este texto: ${input.caption}`
                : 'El cliente no escribió texto junto a la imagen.',
            },
            {
              type: 'input_image',
              image_url: dataUrl,
              detail: 'auto',
            },
          ],
        },
      ],
    } as any);

    const raw = response.output_text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '');

    let parsed: Record<string, unknown>;

    try {
      const value = JSON.parse(raw) as unknown;

      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('La respuesta visual no fue un objeto JSON.');
      }

      parsed = value as Record<string, unknown>;
    } catch {
      throw new Error(
        'OpenAI no devolvió un análisis visual estructurado.',
      );
    }

    const readText = (value: unknown, limit: number): string =>
      typeof value === 'string'
        ? value.replace(/\s+/g, ' ').trim().slice(0, limit)
        : '';
    const readList = (
      value: unknown,
      maxItems: number,
      maxLength: number,
    ): string[] =>
      Array.isArray(value)
        ? value
            .filter((item): item is string => typeof item === 'string')
            .map((item) =>
              item.replace(/\s+/g, ' ').trim().slice(0, maxLength),
            )
            .filter(Boolean)
            .slice(0, maxItems)
        : [];

    const category = readText(parsed.category, 120) || 'producto';
    const summary =
      readText(parsed.summary, 1000) ||
      `Se observa un producto de la categoría ${category}.`;
    const rawSourceHint = readText(parsed.source_hint, 40);
    const rawConfidence = readText(parsed.confidence, 20);
    const searchTerms = readList(parsed.search_terms, 6, 100);

    return {
      summary,
      category,
      colors: readList(parsed.colors, 6, 50),
      visibleText: readText(parsed.visible_text, 1200),
      searchTerms: searchTerms.length ? searchTerms : [category],
      sourceHint:
        rawSourceHint === 'catalog_screenshot' ||
        rawSourceHint === 'external_reference'
          ? rawSourceHint
          : 'unknown',
      confidence:
        rawConfidence === 'high' || rawConfidence === 'medium'
          ? rawConfidence
          : 'low',
    };
  }

  private async processIncomingAudio(input: {
    incomingPhoneNumberId: string;
    phone: string;
    incomingMessageId: string | null;
    mediaId: string;
    mimeType: string;
    voice: boolean;
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
          'No existe una empresa activa para el audio entrante.',
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

      let transcription = '';
      let transcriptionError = '';

      try {
        const media = await this.whatsappMessagingService.downloadMedia(
          profile.id,
          input.mediaId,
        );

        transcription = await this.transcribeIncomingAudio({
          buffer: media.buffer,
          filename: media.filename,
          companyName: profile.name,
        });
      } catch (error) {
        transcriptionError =
          error instanceof Error
            ? error.message
            : 'No se pudo transcribir el audio.';
        console.error(
          `No se pudo transcribir el audio de ${input.phone}:`,
          error,
        );
      }

      const saved = await this.conversationMemoryService.saveMessage({
        companyId: profile.id,
        sessionId: session.id,
        customerPhone: input.phone,
        message: transcription
          ? `Transcripción del audio: ${transcription}`
          : 'Audio recibido. No se pudo generar la transcripción automática.',
        sender: 'customer',
        authorType: 'customer',
        providerMessageId: input.incomingMessageId,
        messageType: 'audio',
        mediaId: input.mediaId,
        mediaMimeType: input.mimeType,
        mediaFilename: 'audio.ogg',
        mediaVoice: input.voice,
      });

      if (saved === 'duplicate') {
        return;
      }

      await this.conversationMemoryService.touchSession(session.id);

      if (
        session.attentionStatus === 'waiting' ||
        session.attentionStatus === 'human'
      ) {
        console.log(
          `Audio guardado para atención humana de ${input.phone}`,
        );
        return;
      }

      if (session.attentionStatus === 'closed') {
        session =
          await this.conversationMemoryService.resumeAiConversation(
            session.id,
          );
      }

      if (!transcription) {
        await this.handleAudioTranscriptionFailure({
          profile,
          session,
          phone: input.phone,
          reason: transcriptionError,
        });
        return;
      }

      session = await this.clearAudioTranscriptionState(session);
      session = await this.attachRecoveryContext(
        session,
        profile.id,
        input.phone,
      );

      const reply = await this.resolveReply(
        profile,
        session,
        transcription,
      );

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
      console.log(`Audio comprendido y respondido a ${input.phone}`);
    } catch (error) {
      console.error('No se pudo procesar el audio entrante:', error);
    }
  }

  private async transcribeIncomingAudio(input: {
    buffer: Buffer;
    filename: string;
    companyName: string;
  }): Promise<string> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();

    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY no está configurada para transcribir audios.',
      );
    }

    if (!input.buffer.length) {
      throw new Error('El audio descargado está vacío.');
    }

    const client = new OpenAI({ apiKey });
    const model =
      process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() ||
      'gpt-4o-mini-transcribe';
    const filename =
      input.filename.trim().toLowerCase().endsWith('.mp3')
        ? input.filename.trim()
        : 'audio.mp3';

    const result = await client.audio.transcriptions.create({
      file: await toFile(input.buffer, filename),
      model: model as any,
      language: 'es',
      prompt:
        `Transcribe fielmente este mensaje de un cliente de ${input.companyName}. ` +
        'Conserva nombres de productos, colores, tallas, ciudades, números de pedido, ' +
        'correos, teléfonos y referencias tal como se escuchen. No respondas ni resumas.',
    });

    const transcription =
      typeof result.text === 'string'
        ? result.text.replace(/\s+/g, ' ').trim().slice(0, 6000)
        : '';

    if (
      !transcription ||
      !/[\p{L}\p{N}]/u.test(transcription)
    ) {
      throw new Error(
        'OpenAI no pudo obtener una transcripción comprensible.',
      );
    }

    return transcription;
  }

  private async clearAudioTranscriptionState(
    session: any,
  ): Promise<any> {
    const current =
      await this.conversationMemoryService.getSessionById(session.id);

    if (
      !current.context.audio_transcription_state ||
      typeof current.context.audio_transcription_state !== 'object' ||
      Array.isArray(current.context.audio_transcription_state)
    ) {
      return current;
    }

    const nextContext = { ...current.context };
    delete nextContext.audio_transcription_state;

    return this.conversationMemoryService.updateSession(current.id, {
      context: nextContext,
    });
  }

  private async handleAudioTranscriptionFailure(input: {
    profile: any;
    session: any;
    phone: string;
    reason: string;
  }): Promise<void> {
    const current =
      await this.conversationMemoryService.getSessionById(
        input.session.id,
      );
    const rawState =
      current.context.audio_transcription_state &&
      typeof current.context.audio_transcription_state === 'object' &&
      !Array.isArray(current.context.audio_transcription_state)
        ? current.context.audio_transcription_state as Record<string, unknown>
        : null;
    const previousCount =
      rawState && typeof rawState.count === 'number'
        ? Math.max(0, Math.floor(rawState.count))
        : 0;
    const nextCount = previousCount + 1;

    if (nextCount >= 2) {
      const updated =
        await this.conversationMemoryService.requestHumanAttention(
          current.id,
          {
            reason:
              'No se logró comprender el audio después de dos intentos.',
            summary:
              'Escucha los últimos audios del cliente y continúa desde el contexto, carrito y datos ya registrados.',
          },
        );
      const reply =
        this.chatAgentService.humanAttentionReply(updated);

      await this.whatsappMessagingService.sendText(
        input.profile.id,
        input.phone,
        reply,
      );

      await this.conversationMemoryService.saveMessage({
        companyId: input.profile.id,
        sessionId: current.id,
        customerPhone: input.phone,
        message: reply,
        sender: 'assistant',
        authorType: 'ai',
        aiResponse: reply,
      });

      await this.conversationMemoryService.touchSession(current.id);
      return;
    }

    await this.conversationMemoryService.updateSession(current.id, {
      context: {
        ...current.context,
        audio_transcription_state: {
          count: nextCount,
          reason: input.reason.trim().slice(0, 500),
          failed_at: new Date().toISOString(),
        },
      },
    });

    const reply =
      'No logré escuchar bien el audio. Por favor envíalo nuevamente ' +
      'o escríbeme el mensaje para poder ayudarte.';

    await this.whatsappMessagingService.sendText(
      input.profile.id,
      input.phone,
      reply,
    );

    await this.conversationMemoryService.saveMessage({
      companyId: input.profile.id,
      sessionId: current.id,
      customerPhone: input.phone,
      message: reply,
      sender: 'assistant',
      authorType: 'ai',
      aiResponse: reply,
    });

    await this.conversationMemoryService.touchSession(current.id);
  }

  private async processIncomingText(input: {
    incomingPhoneNumberId: string;
    phone: string;
    text: string;
    incomingMessageId: string | null;
    suppressReply: boolean;
    templateButton: boolean;
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

      if (input.templateButton) {
        const buttonAction =
          await this.whatsappTemplateExecutionService.resolveButtonAction(
            profile.id,
            input.text,
          );

        if (buttonAction) {
          const reply = await this.executeTemplateButtonAction({
            profile,
            session,
            phone: input.phone,
            action: buttonAction.action,
          });

          if (reply) {
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
          }

          return;
        }
      }

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

  private async executeTemplateButtonAction(input: {
    profile: CompanyProfile;
    session: ConversationSession;
    phone: string;
    action: string;
  }): Promise<string | null> {
    const now = new Date().toISOString();

    switch (input.action) {
      case 'tracking_information':
        return this.resolveTrackingButtonReply(
          input.profile,
          input.phone,
        );

      case 'accept_order_updates':
        await this.conversationMemoryService.updateSession(
          input.session.id,
          {
            context: {
              ...input.session.context,
              order_updates_consent: {
                accepted: true,
                source: 'whatsapp_template_button',
                updated_at: now,
              },
            },
          },
        );

        return 'Listo ✅ Seguirás recibiendo por este chat las actualizaciones disponibles de tu pedido.';

      case 'confirm_cod_order':
        await this.conversationMemoryService.updateSession(
          input.session.id,
          {
            context: {
              ...input.session.context,
              cod_confirmation: {
                confirmed: true,
                updated_at: now,
              },
            },
          },
        );

        return 'Pedido confirmado ✅ Ahora confírmame el nombre de tu barrio para organizar la entrega.';

      case 'payment_assistance':
        await this.conversationMemoryService.updateSession(
          input.session.id,
          {
            context: {
              ...input.session.context,
              customer_service_flow: {
                type: 'payment_problem',
                updated_at: now,
              },
            },
          },
        );

        return 'Claro 😊 Cuéntame qué inconveniente tienes con el pago. No envíes claves, códigos de seguridad ni datos bancarios sensibles.';

      case 'request_human_agent':
        return this.requestCustomerServiceHuman(
          input.session,
          'Cliente solicitó asesor desde una plantilla de WhatsApp.',
          'El cliente pulsó un botón para hablar con un asesor.',
        );

      case 'open_commercial_conversation':
        await this.conversationMemoryService.updateSession(
          input.session.id,
          {
            stage: 'sales',
            context: {
              ...input.session.context,
              commercial_conversation: {
                open: true,
                updated_at: now,
              },
            },
          },
        );

        return 'Perfecto 😊 Cuéntame qué producto te interesa y te ayudo.';

      case 'stop_commercial_followup':
        await this.conversationMemoryService.updateSession(
          input.session.id,
          {
            context: {
              ...input.session.context,
              commercial_followup: {
                enabled: false,
                updated_at: now,
              },
            },
          },
        );

        return 'Listo. No continuaremos este seguimiento comercial por WhatsApp.';

      default:
        return null;
    }
  }

  private async resolveTrackingButtonReply(
    profile: CompanyProfile,
    phone: string,
  ): Promise<string> {
    try {
      const result = await this.customerOrderService.lookup(
        profile.id,
        { phone },
      ) as Record<string, any>;
      const orders =
        result.ok && result.found && Array.isArray(result.orders)
          ? result.orders
          : [];
      const order = orders[0] as Record<string, any> | undefined;

      if (!order) {
        return 'No encontré un pedido asociado a este número. Envíame el número del pedido para revisarlo.';
      }

      const tracking = this.getFirstOrderTracking(order);

      if (tracking) {
        return this.formatConfiguredTrackingReply(
          tracking,
          profile,
        );
      }

      const orderName = this.cleanCustomerText(order.name || '');

      return orderName
        ? `Tu pedido ${orderName} todavía no tiene una guía de seguimiento disponible.`
        : 'Tu pedido todavía no tiene una guía de seguimiento disponible.';
    } catch (error) {
      console.error(
        `No se pudo consultar el seguimiento para ${phone}:`,
        error,
      );

      return 'No pude consultar la guía en este momento. Envíame el número del pedido para revisarlo.';
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
      const nextContext = this.startFreshAreaMenuContext(session.context);

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

      return this.buildAreaWelcome(
        profile,
        selectedArea.name,
        selectedSession,
      );
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

  private startFreshAreaMenuContext(
    context: Record<string, unknown>,
  ): Record<string, unknown> {
    const now = new Date().toISOString();
    const previousPurchaseContext: Record<string, unknown> = {
      saved_at: now,
    };
    let hasPreviousPurchase = false;

    for (const key of [
      'cart',
      'selectedProduct',
      'selectedVariant',
      'selectedVariants',
      'lastCartUrl',
      'lastCheckoutUrl',
    ]) {
      if (context[key] !== undefined && context[key] !== null) {
        previousPurchaseContext[key] = context[key];
        hasPreviousPurchase = true;
      }
    }

    const nextContext: Record<string, unknown> = {
      ...context,
      conversation_cycle_started_at: now,
      conversation_cycle_reason: 'customer_requested_menu',
      menu_requested_at: now,
    };

    if (hasPreviousPurchase) {
      nextContext.previous_purchase_context = previousPurchaseContext;
    }

    for (const key of [
      'service_area',
      'customer_service_flow',
      'last_visual_reference',
      'cart',
      'cart_recovery',
      'selectedProduct',
      'selectedVariant',
      'selectedVariants',
      'selectedAt',
      'selectedVariantAt',
      'purchaseIntent',
      'purchaseIntentAt',
      'lastCartUrl',
      'lastCheckoutUrl',
      'lastCartUpdatedAt',
      'checkoutCreatedAt',
      'clarification_state',
      'technical_failure_state',
    ]) {
      delete nextContext[key];
    }

    return nextContext;
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

      return this.formatOrderLookupReply(result.orders[0], session);
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

  private async formatOrderLookupReply(order: Record<string, any>, session?: ConversationSession) {
    const items = Array.isArray(order.items) ? order.items : [];
    const firstTracking = this.getFirstOrderTracking(order);
    const hasTracking = Boolean(firstTracking);
    const orderName = order.name ? ` ${order.name}` : '';
    const customerName = this.getOrderCustomerName(order);
    const lines: string[] = [];
    const profile = await this.getSessionCompanyProfile(session);

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
      lines.push(this.formatConfiguredTrackingReply(firstTracking, profile));
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


  private async getSessionCompanyProfile(session?: ConversationSession) {
    const companyId =
      (session as any)?.companyId ||
      (session as any)?.company_id ||
      '';

    if (!companyId) {
      return undefined;
    }

    try {
      return await this.conversationMemoryService.getCompanyProfileById(companyId);
    } catch {
      return undefined;
    }
  }

  private formatConfiguredTrackingReply(
    tracking: Record<string, any>,
    profile?: CompanyProfile,
  ) {
    const config = this.findConfiguredCarrier(tracking.company, profile);
    const rawCompany = this.cleanCustomerText(tracking.company || '');
    const trackingNumber = this.cleanCustomerText(tracking.number || '');
    const genericCompany = [
      'other',
      'otro',
      'unknown',
      'desconocido',
      'transportadora registrada por la tienda',
      'transportadora del pedido',
    ].includes(this.normalizeCarrierKey(rawCompany));
    const visibleCompany =
      config?.displayName || (genericCompany ? '' : rawCompany);
    const configuredUrl = config?.trackingUrl || '';
    const trackingUrl =
      configuredUrl || this.extractBaseTrackingUrl(String(tracking.url || ''));
    const instructions =
      config?.instructions ||
      this.getShippingTrackingFallbackInstructions(profile);

    const trackingLines = ['Información de envío:'];

    if (visibleCompany) {
      trackingLines.push(`Transportadora: ${visibleCompany}`);
    } else {
      trackingLines.push('Transportadora registrada por la tienda.');
    }

    if (trackingNumber) {
      trackingLines.push(`Guía: ${trackingNumber}`);
    }

    if (trackingUrl) {
      trackingLines.push('', 'Para hacer seguimiento, ingresa aquí:', trackingUrl);
    }

    if (instructions) {
      trackingLines.push('', instructions);
    }

    if (trackingNumber) {
      trackingLines.push('', 'Copia esta guía y consulta:', trackingNumber);
    }

    return trackingLines.join('\n');
  }

  private findConfiguredCarrier(company: unknown, profile?: CompanyProfile) {
    const rawCompany = this.cleanCustomerText(String(company || ''));
    const companyKey = this.normalizeCarrierKey(rawCompany);

    if (!companyKey || !profile) {
      return null;
    }

    const settings = profile.settings?.shipping_tracking;

    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return null;
    }

    const source = settings as Record<string, any>;

    if (source.enabled !== true) {
      return null;
    }

    const carriers = Array.isArray(source.carriers) ? source.carriers : [];

    for (const item of carriers) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        continue;
      }

      const carrier = item as Record<string, any>;

      if (carrier.isActive === false) {
        continue;
      }

      const displayName = this.cleanCustomerText(carrier.displayName || '');
      const trackingUrl = this.cleanCustomerText(carrier.trackingUrl || '');
      const instructions = this.cleanCustomerText(carrier.instructions || '');
      const aliases = this.splitCarrierAliases(carrier.aliases);

      const possibleNames = [displayName, ...aliases]
        .map((value) => this.normalizeCarrierKey(value))
        .filter(Boolean);

      if (possibleNames.includes(companyKey)) {
        return {
          displayName,
          trackingUrl: this.extractBaseTrackingUrl(trackingUrl) || trackingUrl,
          instructions,
        };
      }
    }

    return null;
  }

  private splitCarrierAliases(value: unknown) {
    if (Array.isArray(value)) {
      return value
        .filter((item): item is string => typeof item === 'string')
        .flatMap((item) => this.splitCarrierAliases(item));
    }

    if (typeof value !== 'string') {
      return [];
    }

    return value
      .split(/[\n,;]+/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private getShippingTrackingFallbackInstructions(profile?: CompanyProfile) {
    const defaultInstructions =
      'Ingresa al enlace principal de la transportadora, busca seguimiento o rastreo, copia la guía y consulta el estado.';

    const settings = profile?.settings?.shipping_tracking;

    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return defaultInstructions;
    }

    const source = settings as Record<string, any>;
    const configured =
      typeof source.fallbackInstructions === 'string'
        ? source.fallbackInstructions.trim()
        : '';

    return configured || defaultInstructions;
  }

  private extractBaseTrackingUrl(value: string) {
    const raw = value.trim();

    if (!raw) {
      return '';
    }

    try {
      const url = new URL(raw);
      return url.origin;
    } catch {
      return raw.replace(/\/+$/, '');
    }
  }

  private normalizeCarrierKey(value: unknown) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
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
    areaName = '',
  ): string {
    return value
      .replace(/\{asistente\}/gi, assistantName)
      .replace(/\{empresa\}/gi, profile.name)
      .replace(/\{area\}/gi, areaName)
      .trim();
  }

  private buildAreaWelcome(
    profile: CompanyProfile,
    areaName: string,
    _session: ConversationSession,
  ): string {
    const flow =
      profile.settings.commercial_flow &&
      typeof profile.settings.commercial_flow === 'object' &&
      !Array.isArray(profile.settings.commercial_flow)
        ? profile.settings.commercial_flow as Record<string, unknown>
        : {};
    const configured =
      typeof flow.area_welcome_message === 'string'
        ? flow.area_welcome_message.trim()
        : '';
    const assistantName =
      profile.assistantName?.trim() || 'nuestro asistente';

    return this.applyWelcomeTokens(
      configured ||
        `Perfecto 😊 Cuéntame qué necesitas en ${areaName}.`,
      profile,
      assistantName,
      areaName,
    );
  }

  private getDeliveryStatuses(body: unknown): Array<{
    messageId: string;
    status: string;
    timestamp: string | null;
    recipient: string | null;
    error: string | null;
  }> {
    const root = body as any;
    const entries = Array.isArray(root?.entry) ? root.entry : [];
    const results: Array<{
      messageId: string;
      status: string;
      timestamp: string | null;
      recipient: string | null;
      error: string | null;
    }> = [];

    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes)
        ? entry.changes
        : [];

      for (const change of changes) {
        const statuses = Array.isArray(change?.value?.statuses)
          ? change.value.statuses
          : [];

        for (const item of statuses) {
          const messageId =
            typeof item?.id === 'string' ? item.id.trim() : '';
          const status =
            typeof item?.status === 'string'
              ? item.status.trim().toLowerCase()
              : '';

          if (!messageId || !status) {
            continue;
          }

          const timestampSeconds = Number(item?.timestamp);
          const timestamp = Number.isFinite(timestampSeconds)
            ? new Date(timestampSeconds * 1000).toISOString()
            : null;
          const recipient =
            typeof item?.recipient_id === 'string'
              ? item.recipient_id.trim()
              : null;
          const errors = Array.isArray(item?.errors)
            ? item.errors
            : [];
          const firstError = errors[0] ?? null;
          const errorData =
            firstError?.error_data &&
            typeof firstError.error_data === 'object'
              ? firstError.error_data
              : {};
          const errorParts = [
            firstError?.code,
            firstError?.title,
            firstError?.message,
            errorData?.details,
          ]
            .map((value) =>
              typeof value === 'string' || typeof value === 'number'
                ? String(value).trim()
                : '',
            )
            .filter(Boolean);

          results.push({
            messageId,
            status,
            timestamp,
            recipient,
            error: errorParts.length
              ? errorParts.join(' · ').slice(0, 700)
              : null,
          });
        }
      }
    }

    return results;
  }

  private getIncomingButtonText(message: any): string {
    if (message?.type === 'button') {
      const text =
        typeof message?.button?.text === 'string'
          ? message.button.text.trim()
          : '';
      const payload =
        typeof message?.button?.payload === 'string'
          ? message.button.payload.trim()
          : '';

      return text || payload;
    }

    if (message?.type === 'interactive') {
      const buttonReply = message?.interactive?.button_reply;
      const listReply = message?.interactive?.list_reply;
      const title =
        typeof buttonReply?.title === 'string'
          ? buttonReply.title.trim()
          : typeof listReply?.title === 'string'
            ? listReply.title.trim()
            : '';
      const id =
        typeof buttonReply?.id === 'string'
          ? buttonReply.id.trim()
          : typeof listReply?.id === 'string'
            ? listReply.id.trim()
            : '';

      return title || id;
    }

    return '';
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
