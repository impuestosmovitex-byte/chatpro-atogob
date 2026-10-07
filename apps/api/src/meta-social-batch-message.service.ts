import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import OpenAI from 'openai';
import { AgentSessionRuntimeService } from './agent-session-runtime.service';
import { CompanyIntegrationService } from './company-integration.service';
import { ConversationMemoryService } from './conversation-memory.service';
import { IntegrationCredentialsService } from './integration-credentials.service';
import { MetaSocialAiService } from './meta-social-ai.service';
import { MetaSocialMessageService } from './meta-social-message.service';
import { SupabaseService } from './supabase.service';

type JsonObject = Record<string, unknown>;
type SocialChannel = 'instagram' | 'messenger';

type PendingImage = {
  mediaUrl: string;
  providerMessageId: string | null;
};

type PendingBatch = {
  batchId: string;
  channel: SocialChannel;
  companyId: string;
  accountId: string;
  sessionId: string;
  recipientId: string;
  credentialsEncrypted: string | null;
  setupSource?: string;
  apiVersion?: string;
  texts: string[];
  images: PendingImage[];
  generation: number;
  updatedAt: number;
};

type BatchAnalysisItem = {
  imageIndexes: number[];
  summary: string;
  category: string;
  productName: string;
  reference: string;
  visiblePrice: string;
  colors: string[];
  visibleText: string;
  searchTerms: string[];
};

type BatchAnalysis = {
  intent: string;
  customerSummary: string;
  items: BatchAnalysisItem[];
};

/**
 * Capa social multicanal para agrupar texto + varias imágenes antes de
 * responder. WhatsApp ya conserva una visual_reference_burst equivalente
 * dentro de WhatsappWebhookController; esta clase alinea Instagram y
 * Messenger con el mismo principio de plataforma: una ráfaga = un contexto.
 *
 * No contiene nombres, catálogos ni reglas de una empresa específica. Toda
 * resolución parte del companyId encontrado en la integración activa.
 */
@Injectable()
export class MetaSocialBatchMessageService extends MetaSocialMessageService {
  private readonly pendingBatches = new Map<string, PendingBatch>();
  private openAiClient: OpenAI | null = null;

  constructor(
    supabaseService: SupabaseService,
    companyIntegrationService: CompanyIntegrationService,
    credentialsService: IntegrationCredentialsService,
    private readonly batchSocialAiService: MetaSocialAiService,
    private readonly batchConversationMemoryService: ConversationMemoryService,
    private readonly batchAgentSessionRuntimeService: AgentSessionRuntimeService,
  ) {
    super(
      supabaseService,
      companyIntegrationService,
      credentialsService,
      batchSocialAiService,
    );

    this.batchSupabaseService = supabaseService;
    this.batchCompanyIntegrationService = companyIntegrationService;
  }

  private readonly batchSupabaseService: SupabaseService;
  private readonly batchCompanyIntegrationService: CompanyIntegrationService;

  override async processInstagramWebhook(bodyInput: unknown): Promise<void> {
    // Audio, video y archivos siguen pasando por el flujo existente y por el
    // servicio multimedia de Instagram. Texto/postback/imágenes se agrupan aquí.
    const residualBody = this.buildResidualBody(bodyInput, 'instagram');
    await super.processInstagramWebhook(residualBody);

    const body = this.record(bodyInput);

    if (!Array.isArray(body.entry)) {
      return;
    }

    for (const rawEntry of body.entry) {
      const entry = this.record(rawEntry);
      const instagramId = this.text(entry.id);

      if (!instagramId) {
        continue;
      }

      const integration =
        await this.batchCompanyIntegrationService.findActiveIntegrationByExternalId(
          'meta',
          'instagram',
          instagramId,
        );

      if (!integration) {
        continue;
      }

      const events = this.collectInstagramEvents(entry);

      for (const event of events) {
        await this.captureSocialEvent({
          channel: 'instagram',
          accountId: instagramId,
          event,
          companyId: integration.companyId,
          credentialsEncrypted: integration.credentialsEncrypted,
          setupSource:
            typeof integration.config.setup_source === 'string'
              ? integration.config.setup_source
              : '',
          apiVersion:
            typeof integration.config.api_version === 'string'
              ? integration.config.api_version
              : '',
        });
      }
    }
  }

  override async processMessengerWebhook(bodyInput: unknown): Promise<void> {
    const residualBody = this.buildResidualBody(bodyInput, 'messenger');
    await super.processMessengerWebhook(residualBody);

    const body = this.record(bodyInput);

    if (body.object !== 'page' || !Array.isArray(body.entry)) {
      return;
    }

    for (const rawEntry of body.entry) {
      const entry = this.record(rawEntry);
      const pageId = this.text(entry.id);

      if (!pageId || !Array.isArray(entry.messaging)) {
        continue;
      }

      const integration =
        await this.batchCompanyIntegrationService.findActiveIntegrationByExternalId(
          'meta',
          'messenger',
          pageId,
        );

      if (!integration) {
        continue;
      }

      for (const rawEvent of entry.messaging) {
        await this.captureSocialEvent({
          channel: 'messenger',
          accountId: pageId,
          event: this.record(rawEvent),
          companyId: integration.companyId,
          credentialsEncrypted: integration.credentialsEncrypted,
        });
      }
    }
  }

  private async captureSocialEvent(input: {
    channel: SocialChannel;
    accountId: string;
    event: JsonObject;
    companyId: string;
    credentialsEncrypted: string | null;
    setupSource?: string;
    apiVersion?: string;
  }): Promise<void> {
    const sender = this.record(input.event.sender);
    const recipient = this.record(input.event.recipient);
    const senderId = this.text(sender.id);
    const recipientId = this.text(recipient.id);

    if (!senderId || senderId === input.accountId) {
      return;
    }

    if (recipientId && recipientId !== input.accountId) {
      return;
    }

    const message = this.record(input.event.message);

    if (message.is_echo === true) {
      return;
    }

    const baseMessageId = this.text(message.mid);
    const attachments = Array.isArray(message.attachments)
      ? message.attachments.map((item) => this.record(item))
      : [];
    const imageAttachments = attachments.filter(
      (attachment) => this.text(attachment.type).toLowerCase() === 'image',
    );

    const directText = this.text(message.text);
    const postback = this.record(input.event.postback);
    const postbackText =
      Object.keys(postback).length > 0
        ? this.text(postback.title) ||
          this.text(postback.payload) ||
          'Interacción con botón.'
        : '';
    const customerText = directText || postbackText;

    let batchSessionId = '';
    const hasAttachments = attachments.length > 0;

    if (customerText) {
      const textProviderId = baseMessageId
        ? hasAttachments
          ? `${baseMessageId}:text`
          : baseMessageId
        : this.syntheticMessageId(
            input.channel,
            input.accountId,
            senderId,
            'text',
            customerText,
          );

      const savedSessionId = await this.saveSocialMessage({
        channel: input.channel,
        companyId: input.companyId,
        accountId: input.accountId,
        senderId,
        providerMessageId: textProviderId,
        message: customerText,
        messageType: Object.keys(postback).length ? 'postback' : 'text',
        mediaUrl: null,
        credentialsEncrypted: input.credentialsEncrypted,
        setupSource: input.setupSource,
        apiVersion: input.apiVersion,
      });

      if (savedSessionId) {
        batchSessionId = savedSessionId;
        this.appendToBatch({
          channel: input.channel,
          companyId: input.companyId,
          accountId: input.accountId,
          sessionId: savedSessionId,
          recipientId: senderId,
          credentialsEncrypted: input.credentialsEncrypted,
          setupSource: input.setupSource,
          apiVersion: input.apiVersion,
          text: customerText,
        });
      }
    }

    for (let index = 0; index < imageAttachments.length; index += 1) {
      const attachment = imageAttachments[index];
      const payload = this.record(attachment.payload);
      const mediaUrl = this.text(payload.url);

      if (!mediaUrl) {
        continue;
      }

      const imageProviderId = baseMessageId
        ? imageAttachments.length === 1 && !customerText
          ? baseMessageId
          : `${baseMessageId}:image:${index}`
        : this.syntheticMessageId(
            input.channel,
            input.accountId,
            senderId,
            `image:${index}`,
            mediaUrl,
          );

      const savedSessionId = await this.saveSocialMessage({
        channel: input.channel,
        companyId: input.companyId,
        accountId: input.accountId,
        senderId,
        providerMessageId: imageProviderId,
        message: '📷 Imagen recibida.',
        messageType: 'image',
        mediaUrl,
        credentialsEncrypted: input.credentialsEncrypted,
        setupSource: input.setupSource,
        apiVersion: input.apiVersion,
      });

      if (!savedSessionId) {
        continue;
      }

      batchSessionId = batchSessionId || savedSessionId;

      this.appendToBatch({
        channel: input.channel,
        companyId: input.companyId,
        accountId: input.accountId,
        sessionId: savedSessionId,
        recipientId: senderId,
        credentialsEncrypted: input.credentialsEncrypted,
        setupSource: input.setupSource,
        apiVersion: input.apiVersion,
        image: {
          mediaUrl,
          providerMessageId: imageProviderId,
        },
      });
    }

    if (batchSessionId && (customerText || imageAttachments.length)) {
      console.log(
        `[ChatPro][${input.channel}] bloque omnicanal actualizado session=${batchSessionId} images=${imageAttachments.length} text=${customerText ? 'yes' : 'no'}`,
      );
    }
  }

  private async saveSocialMessage(input: {
    channel: SocialChannel;
    companyId: string;
    accountId: string;
    senderId: string;
    providerMessageId: string | null;
    message: string;
    messageType: string;
    mediaUrl: string | null;
    credentialsEncrypted: string | null;
    setupSource?: string;
    apiVersion?: string;
  }): Promise<string | null> {
    if (input.channel === 'instagram') {
      const fn = (
        this as unknown as {
          saveIncomingInstagramMessage: (value: {
            companyId: string;
            instagramId: string;
            senderId: string;
            providerMessageId: string | null;
            message: string;
            messageType: string;
            mediaUrl: string | null;
            credentialsEncrypted: string | null;
            setupSource?: string;
            apiVersion?: string;
          }) => Promise<string | null>;
        }
      ).saveIncomingInstagramMessage;

      return fn.call(this, {
        companyId: input.companyId,
        instagramId: input.accountId,
        senderId: input.senderId,
        providerMessageId: input.providerMessageId,
        message: input.message,
        messageType: input.messageType,
        mediaUrl: input.mediaUrl,
        credentialsEncrypted: input.credentialsEncrypted,
        setupSource: input.setupSource,
        apiVersion: input.apiVersion,
      });
    }

    const fn = (
      this as unknown as {
        saveIncomingMessengerMessage: (value: {
          companyId: string;
          pageId: string;
          senderId: string;
          providerMessageId: string | null;
          message: string;
          messageType: string;
          mediaUrl: string | null;
          credentialsEncrypted: string | null;
        }) => Promise<string | null>;
      }
    ).saveIncomingMessengerMessage;

    return fn.call(this, {
      companyId: input.companyId,
      pageId: input.accountId,
      senderId: input.senderId,
      providerMessageId: input.providerMessageId,
      message: input.message,
      messageType: input.messageType,
      mediaUrl: input.mediaUrl,
      credentialsEncrypted: input.credentialsEncrypted,
    });
  }

  private appendToBatch(input: {
    channel: SocialChannel;
    companyId: string;
    accountId: string;
    sessionId: string;
    recipientId: string;
    credentialsEncrypted: string | null;
    setupSource?: string;
    apiVersion?: string;
    text?: string;
    image?: PendingImage;
  }): void {
    const key =
      `${input.channel}:${input.accountId}:${input.recipientId}`;
    const current = this.pendingBatches.get(key);

    const next: PendingBatch = current
      ? {
          ...current,
          sessionId: input.sessionId,
          texts: input.text
            ? [...current.texts, input.text].slice(-12)
            : current.texts,
          images: input.image
            ? [...current.images, input.image].slice(-10)
            : current.images,
          generation: current.generation + 1,
          updatedAt: Date.now(),
        }
      : {
          batchId:
            `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          channel: input.channel,
          companyId: input.companyId,
          accountId: input.accountId,
          sessionId: input.sessionId,
          recipientId: input.recipientId,
          credentialsEncrypted: input.credentialsEncrypted,
          setupSource: input.setupSource,
          apiVersion: input.apiVersion,
          texts: input.text ? [input.text] : [],
          images: input.image ? [input.image] : [],
          generation: 1,
          updatedAt: Date.now(),
        };

    this.pendingBatches.set(key, next);
    const generation = next.generation;

    setTimeout(() => {
      const latest = this.pendingBatches.get(key);

      if (!latest || latest.generation !== generation) {
        return;
      }

      void this.flushBatch(key).catch((error) => {
        console.error(
          `[ChatPro][${next.channel}][batch] no se pudo procesar bloque ${next.batchId}:`,
          error,
        );
      });
    }, 5000);
  }

  private async flushBatch(key: string): Promise<void> {
    const batch = this.pendingBatches.get(key);

    if (!batch) {
      return;
    }

    this.pendingBatches.delete(key);

    const { data: sessionRow, error: sessionError } =
      await this.batchSupabaseService
        .getClient()
        .from('social_conversation_sessions')
        .select('id, attention_status')
        .eq('id', batch.sessionId)
        .eq('company_id', batch.companyId)
        .maybeSingle();

    if (sessionError) {
      throw new Error(
        `No se pudo validar la sesión del bloque multimedia: ${sessionError.message}`,
      );
    }

    if (!sessionRow || sessionRow.attention_status !== 'ai') {
      return;
    }

    const groupedText = batch.texts
      .map((item) => item.trim())
      .filter(Boolean)
      .join('\n')
      .slice(0, 8000);

    if (!batch.images.length) {
      if (!groupedText) {
        return;
      }

      await this.replyToChannel(batch, groupedText);
      return;
    }

    // Instagram conserva su flujo visual especializado cuando es una sola
    // imagen; para varias imágenes usamos el analizador conjunto.
    if (batch.channel === 'instagram' && batch.images.length === 1) {
      await this.batchSocialAiService.replyToInstagramImage({
        companyId: batch.companyId,
        instagramId: batch.accountId,
        sessionId: batch.sessionId,
        recipientId: batch.recipientId,
        mediaUrl: batch.images[0].mediaUrl,
        caption: groupedText || undefined,
        credentialsEncrypted: batch.credentialsEncrypted,
        setupSource: batch.setupSource,
        apiVersion: batch.apiVersion,
      });
      return;
    }

    const analysis = await this.analyzeImageBatch(batch, groupedText);
    await this.persistSharedVisualContext(batch, analysis, groupedText);

    const customerMessage = [
      '[RAFAGA_VISUAL_MULTIPRODUCTO_OMNICANAL]',
      `Canal: ${batch.channel}.`,
      `El cliente envió ${batch.images.length} imágenes dentro del mismo bloque conversacional.`,
      groupedText
        ? `Texto asociado al bloque: ${groupedText}`
        : 'El cliente no agregó texto; usa el historial reciente para interpretar la intención.',
      `Intención visual estimada: ${analysis.intent || 'consultar productos'}.`,
      `Resumen conjunto: ${analysis.customerSummary || 'Se recibieron varias referencias visuales.'}`,
      `Referencias visuales del bloque: ${JSON.stringify(analysis.items)}`,
      'Considera TODAS las imágenes del bloque. No te enfoques únicamente en la última.',
      'Si varias imágenes parecen ser ángulos del mismo artículo, trátalas como un solo artículo; si parecen productos distintos, conserva cada uno como referencia independiente.',
      'El texto del cliente aplica al conjunto completo salvo que indique expresamente una imagen o producto específico.',
      'Usa solamente catálogo, precios, variantes, inventario, políticas e instrucciones de la empresa activa de esta conversación.',
      'No asumas que una referencia visual pertenece al catálogo hasta validarla con las herramientas reales disponibles.',
      'Responde una sola vez para el bloque completo y continúa el flujo comercial desde el contexto actual.',
    ].join('\n');

    await this.replyToChannel(batch, customerMessage);

    console.log(
      `[ChatPro][${batch.channel}][batch] bloque visual procesado images=${batch.images.length} items=${analysis.items.length} session=${batch.sessionId}`,
    );
  }

  private async analyzeImageBatch(
    batch: PendingBatch,
    groupedText: string,
  ): Promise<BatchAnalysis> {
    const profile =
      await this.batchConversationMemoryService.getCompanyProfileById(
        batch.companyId,
      );

    const commercialSession =
      await this.batchAgentSessionRuntimeService.getSessionById(
        batch.sessionId,
      );

    if (commercialSession.companyId !== batch.companyId) {
      throw new Error(
        'El bloque visual no pertenece a la empresa activa de la sesión.',
      );
    }

    const downloaded = (
      await Promise.all(
        batch.images.map(async (image, index) => {
          try {
            const response = await fetch(image.mediaUrl);

            if (!response.ok) {
              return null;
            }

            const buffer = Buffer.from(await response.arrayBuffer());

            if (!buffer.length || buffer.length > 15 * 1024 * 1024) {
              return null;
            }

            const mimeType =
              (response.headers.get('content-type') || 'image/jpeg')
                .split(';')[0]
                .trim()
                .toLowerCase();

            if (
              ![
                'image/jpeg',
                'image/jpg',
                'image/png',
                'image/webp',
                'image/gif',
              ].includes(mimeType)
            ) {
              return null;
            }

            return {
              index: index + 1,
              dataUrl:
                `data:${mimeType};base64,${buffer.toString('base64')}`,
            };
          } catch {
            return null;
          }
        }),
      )
    ).filter(
      (item): item is { index: number; dataUrl: string } => Boolean(item),
    );

    if (!downloaded.length) {
      return {
        intent: 'visual_context',
        customerSummary:
          'El cliente envió varias imágenes, pero no fue posible analizarlas visualmente en este intento.',
        items: batch.images.map((_, index) => ({
          imageIndexes: [index + 1],
          summary: `Imagen ${index + 1} recibida`,
          category: '',
          productName: '',
          reference: '',
          visiblePrice: '',
          colors: [],
          visibleText: '',
          searchTerms: [],
        })),
      };
    }

    const content: Array<Record<string, unknown>> = [
      {
        type: 'input_text',
        text: [
          `Se recibieron ${downloaded.length} imágenes de un cliente en ${batch.channel}.`,
          groupedText
            ? `Texto del cliente: ${groupedText}`
            : 'No hubo texto adicional en el bloque.',
          'Analiza todas las imágenes conjuntamente.',
          'Agrupa imágenes que claramente sean distintos ángulos o capturas del mismo artículo.',
          'No agrupes productos distintos solo por parecer similares.',
          'No inventes nombre, referencia, precio, color ni disponibilidad.',
          'Devuelve únicamente JSON válido con esta estructura:',
          '{"intent":"multi_product_purchase|product_inquiry|customer_service|other","customer_summary":"...","items":[{"image_indexes":[1],"summary":"...","category":"...","product_name":"...","reference":"...","visible_price":"...","colors":["..."],"visible_text":"...","search_terms":["..."]}]}',
        ].join('\n'),
      },
    ];

    for (const image of downloaded) {
      content.push({
        type: 'input_text',
        text: `Imagen ${image.index}:`,
      });
      content.push({
        type: 'input_image',
        image_url: image.dataUrl,
        detail: 'auto',
      });
    }

    const response = await this.getOpenAiClient().responses.create({
      model:
        process.env.OPENAI_MODEL?.trim() ||
        'gpt-5-mini',
      instructions: [
        'Eres el analizador visual omnicanal de una plataforma comercial multiempresa.',
        'Tu análisis nunca está atado a una empresa fija.',
        `Empresa activa: ${profile.name}.`,
        `Instrucciones configuradas para esta empresa: ${(profile.aiInstructions || 'Sin instrucciones adicionales.').slice(0, 5000)}`,
        `Contexto comercial actual: ${JSON.stringify(commercialSession.context).slice(0, 7000)}`,
        'Tu trabajo es describir y separar referencias visuales; la validación definitiva contra catálogo se hará después con las herramientas comerciales reales.',
      ].join('\n'),
      input: [
        {
          role: 'user',
          content,
        },
      ],
    } as any);

    const raw = (response.output_text || '')
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '');

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const rawItems = Array.isArray(parsed.items) ? parsed.items : [];

      const items: BatchAnalysisItem[] = rawItems
        .filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) &&
            typeof item === 'object' &&
            !Array.isArray(item),
        )
        .slice(0, 12)
        .map((item, index) => ({
          imageIndexes: Array.isArray(item.image_indexes)
            ? (item.image_indexes as unknown[])
                .map((value) => Number(value))
                .filter((value) => Number.isInteger(value) && value > 0)
                .slice(0, 10)
            : [index + 1],
          summary: this.safeText(item.summary, 800),
          category: this.safeText(item.category, 120),
          productName: this.safeText(item.product_name, 240),
          reference: this.safeText(item.reference, 120),
          visiblePrice: this.safeText(item.visible_price, 80),
          colors: this.safeStringList(item.colors, 8, 60),
          visibleText: this.safeText(item.visible_text, 1200),
          searchTerms: this.safeStringList(item.search_terms, 8, 100),
        }));

      return {
        intent: this.safeText(parsed.intent, 80) || 'product_inquiry',
        customerSummary:
          this.safeText(parsed.customer_summary, 1200) ||
          'El cliente envió varias referencias visuales.',
        items: items.length
          ? items
          : downloaded.map((image) => ({
              imageIndexes: [image.index],
              summary: `Imagen ${image.index} recibida`,
              category: '',
              productName: '',
              reference: '',
              visiblePrice: '',
              colors: [],
              visibleText: '',
              searchTerms: [],
            })),
      };
    } catch {
      return {
        intent: 'product_inquiry',
        customerSummary:
          'El cliente envió varias referencias visuales para continuar la conversación.',
        items: downloaded.map((image) => ({
          imageIndexes: [image.index],
          summary: `Imagen ${image.index} recibida`,
          category: '',
          productName: '',
          reference: '',
          visiblePrice: '',
          colors: [],
          visibleText: '',
          searchTerms: [],
        })),
      };
    }
  }

  private async persistSharedVisualContext(
    batch: PendingBatch,
    analysis: BatchAnalysis,
    groupedText: string,
  ): Promise<void> {
    const session =
      await this.batchAgentSessionRuntimeService.getSessionById(
        batch.sessionId,
      );

    if (session.companyId !== batch.companyId) {
      return;
    }

    const receivedAt = new Date().toISOString();
    const references = analysis.items.map((item) => ({
      image_indexes: item.imageIndexes,
      summary: item.summary,
      category: item.category || null,
      product_name: item.productName || null,
      reference: item.reference || null,
      visible_price: item.visiblePrice || null,
      colors: item.colors,
      visible_text: item.visibleText,
      search_terms: item.searchTerms,
      source_channel: batch.channel,
      batch_id: batch.batchId,
      received_at: receivedAt,
    }));

    const existing = Array.isArray(session.context.commercial_visual_references)
      ? session.context.commercial_visual_references.filter(
          (item) =>
            Boolean(item) &&
            typeof item === 'object' &&
            !Array.isArray(item),
        )
      : [];

    await this.batchAgentSessionRuntimeService.updateSession(
      session.id,
      {
        context: {
          ...session.context,
          last_visual_reference: references[0] || null,
          commercial_visual_references: [
            ...existing,
            ...references,
          ].slice(-20),
          visual_reference_burst: {
            burst_id: batch.batchId,
            references,
            updated_at: receivedAt,
          },
          omnichannel_visual_batch: {
            channel: batch.channel,
            image_count: batch.images.length,
            text: groupedText || null,
            intent: analysis.intent,
            customer_summary: analysis.customerSummary,
            references,
            updated_at: receivedAt,
          },
          commercial_last_customer_message_at: receivedAt,
        },
      },
    );
  }

  private async replyToChannel(
    batch: PendingBatch,
    customerMessage: string,
  ): Promise<void> {
    if (batch.channel === 'instagram') {
      await this.batchSocialAiService.replyToInstagram({
        companyId: batch.companyId,
        instagramId: batch.accountId,
        sessionId: batch.sessionId,
        recipientId: batch.recipientId,
        customerMessage,
        credentialsEncrypted: batch.credentialsEncrypted,
        setupSource: batch.setupSource,
        apiVersion: batch.apiVersion,
      });
      return;
    }

    await this.batchSocialAiService.replyToMessenger({
      companyId: batch.companyId,
      pageId: batch.accountId,
      sessionId: batch.sessionId,
      recipientId: batch.recipientId,
      customerMessage,
      credentialsEncrypted: batch.credentialsEncrypted,
    });
  }

  private buildResidualBody(
    bodyInput: unknown,
    channel: SocialChannel,
  ): unknown {
    const body = this.record(bodyInput);

    if (!Array.isArray(body.entry)) {
      return bodyInput;
    }

    const entries = body.entry.map((rawEntry) => {
      const entry = this.record(rawEntry);
      const nextEntry: JsonObject = { ...entry };

      if (Array.isArray(entry.messaging)) {
        nextEntry.messaging = entry.messaging
          .map((event) => this.sanitizeResidualEvent(event))
          .filter(Boolean);
      }

      if (channel === 'instagram' && Array.isArray(entry.changes)) {
        nextEntry.changes = entry.changes
          .map((rawChange) => {
            const change = this.record(rawChange);

            if (this.text(change.field) !== 'messages') {
              return change;
            }

            const sanitized = this.sanitizeResidualEvent(change.value);

            if (!sanitized) {
              return null;
            }

            return {
              ...change,
              value: sanitized,
            };
          })
          .filter(Boolean);
      }

      return nextEntry;
    });

    return {
      ...body,
      entry: entries,
    };
  }

  private sanitizeResidualEvent(value: unknown): JsonObject | null {
    const event = this.record(value);
    const message = this.record(event.message);
    const attachments = Array.isArray(message.attachments)
      ? message.attachments.map((item) => this.record(item))
      : [];
    const residualAttachments = attachments.filter(
      (attachment) => this.text(attachment.type).toLowerCase() !== 'image',
    );

    const hasHandledText = Boolean(this.text(message.text));
    const hasHandledPostback = Object.keys(this.record(event.postback)).length > 0;

    if (
      !hasHandledText &&
      !hasHandledPostback &&
      residualAttachments.length === attachments.length
    ) {
      return event;
    }

    if (!residualAttachments.length) {
      return null;
    }

    const residualMessage: JsonObject = {
      ...message,
      attachments: residualAttachments,
    };

    delete residualMessage.text;

    const residualEvent: JsonObject = {
      ...event,
      message: residualMessage,
    };

    delete residualEvent.postback;
    return residualEvent;
  }

  private collectInstagramEvents(entry: JsonObject): JsonObject[] {
    const events: JsonObject[] = [];

    if (Array.isArray(entry.messaging)) {
      for (const rawEvent of entry.messaging) {
        events.push(this.record(rawEvent));
      }
    }

    if (Array.isArray(entry.changes)) {
      for (const rawChange of entry.changes) {
        const change = this.record(rawChange);

        if (this.text(change.field) !== 'messages') {
          continue;
        }

        const value = this.record(change.value);

        if (Object.keys(value).length) {
          events.push(value);
        }
      }
    }

    return events;
  }

  private syntheticMessageId(...parts: string[]): string {
    return `mw1:${createHash('sha1')
      .update(parts.join('|'))
      .digest('hex')}`;
  }

  private safeText(value: unknown, max: number): string {
    return typeof value === 'string'
      ? value.replace(/\s+/g, ' ').trim().slice(0, max)
      : '';
  }

  private safeStringList(
    value: unknown,
    maxItems: number,
    maxLength: number,
  ): string[] {
    return Array.isArray(value)
      ? value
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.replace(/\s+/g, ' ').trim().slice(0, maxLength))
          .filter(Boolean)
          .slice(0, maxItems)
      : [];
  }

  private getOpenAiClient(): OpenAI {
    if (this.openAiClient) {
      return this.openAiClient;
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();

    if (!apiKey) {
      throw new Error('Falta OPENAI_API_KEY en Railway.');
    }

    this.openAiClient = new OpenAI({ apiKey });
    return this.openAiClient;
  }

  private record(value: unknown): JsonObject {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as JsonObject)
      : {};
  }

  private text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }
}
