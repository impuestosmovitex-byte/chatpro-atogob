import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { SupabaseService } from './supabase.service';
import { IntegrationCredentialsService } from './integration-credentials.service';
import { ConversationMemoryService } from './conversation-memory.service';
import { ChatAgentService } from './chat-agent.service';
import { AgentSessionRuntimeService } from './agent-session-runtime.service';

@Injectable()
export class MetaSocialAiService {
  private client: OpenAI | null = null;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly credentialsService: IntegrationCredentialsService,
    private readonly conversationMemoryService: ConversationMemoryService,
    private readonly chatAgentService: ChatAgentService,
    private readonly agentSessionRuntimeService: AgentSessionRuntimeService,
  ) {}

  async replyToMessenger(input: {
    companyId: string;
    pageId: string;
    sessionId: string;
    recipientId: string;
    customerMessage: string;
    credentialsEncrypted: string | null;
  }): Promise<void> {
    const client = this.supabaseService.getClient();

    const { data: sessionRow, error: sessionError } =
      await client
        .from('social_conversation_sessions')
        .select('id, attention_status')
        .eq('id', input.sessionId)
        .eq('company_id', input.companyId)
        .maybeSingle();

    if (sessionError) {
      throw new Error(
        `No se pudo validar la sesión de Messenger: ${sessionError.message}`,
      );
    }

    if (!sessionRow) {
      return;
    }

    const socialSession = sessionRow as {
      id: string;
      attention_status: string | null;
    };

    if (socialSession.attention_status !== 'ai') {
      console.log(
        `[ChatPro][Messenger] IA omitida session=${input.sessionId} status=${socialSession.attention_status}`,
      );
      return;
    }

    const profile =
      await this.conversationMemoryService.getCompanyProfileById(
        input.companyId,
      );

    const commercialSession =
      await this.agentSessionRuntimeService.getSessionById(
        input.sessionId,
      );

    if (commercialSession.companyId !== input.companyId) {
      throw new Error(
        'La sesión comercial de Messenger no pertenece a la empresa activa.',
      );
    }

    const reply = (
      await this.chatAgentService.reply(
        profile,
        commercialSession,
        input.customerMessage,
      )
    ).trim();

    if (
      reply ===
      '__CHATPRO_INTERNAL_SUPPRESS_EXTERNAL_AUTOMATION_7F4D__'
    ) {
      console.log(
        `[ChatPro][Messenger] respuesta automática externa suprimida session=${input.sessionId}`,
      );
      return;
    }

    if (!reply) {
      throw new Error(
        'El motor comercial no devolvió una respuesta utilizable para Messenger.',
      );
    }

    const providerMessageId =
      await this.sendMessengerText({
        pageId: input.pageId,
        recipientId: input.recipientId,
        text: reply,
        credentialsEncrypted: input.credentialsEncrypted,
      });

    const now = new Date().toISOString();

    const { error: saveError } = await client
      .from('social_conversations')
      .insert({
        company_id: input.companyId,
        session_id: input.sessionId,
        channel: 'messenger',
        external_customer_id: input.recipientId,
        provider_message_id: providerMessageId,
        sender: 'assistant',
        author_type: 'assistant',
        message_type: 'text',
        message: reply,
        media_url: null,
        created_at: now,
      });

    if (saveError) {
      throw new Error(
        `Messenger respondió, pero no se pudo guardar la respuesta: ${saveError.message}`,
      );
    }

    const { error: updateError } = await client
      .from('social_conversation_sessions')
      .update({
        last_message_at: now,
        updated_at: now,
      })
      .eq('id', input.sessionId)
      .eq('company_id', input.companyId);

    if (updateError) {
      throw new Error(
        `No se pudo actualizar la sesión de Messenger después de responder: ${updateError.message}`,
      );
    }

    console.log(
      `[ChatPro][Messenger] cerebro comercial respondió session=${input.sessionId}`,
    );
  }


  async replyToInstagram(input: {
    companyId: string;
    instagramId: string;
    sessionId: string;
    recipientId: string;
    customerMessage: string;
    credentialsEncrypted: string | null;
    setupSource?: string;
    apiVersion?: string;
  }): Promise<void> {
    const client = this.supabaseService.getClient();

    const { data: sessionRow, error: sessionError } =
      await client
        .from('social_conversation_sessions')
        .select('id, attention_status')
        .eq('id', input.sessionId)
        .eq('company_id', input.companyId)
        .maybeSingle();

    if (sessionError) {
      throw new Error(
        `No se pudo validar la sesión de Instagram: ${sessionError.message}`,
      );
    }

    if (!sessionRow) {
      return;
    }

    const socialSession = sessionRow as {
      id: string;
      attention_status: string | null;
    };

    if (socialSession.attention_status !== 'ai') {
      console.log(
        `[ChatPro][Instagram] IA omitida session=${input.sessionId} status=${socialSession.attention_status}`,
      );
      return;
    }

    const profile =
      await this.conversationMemoryService.getCompanyProfileById(
        input.companyId,
      );

    const commercialSession =
      await this.agentSessionRuntimeService.getSessionById(
        input.sessionId,
      );

    if (commercialSession.companyId !== input.companyId) {
      throw new Error(
        'La sesión comercial de Instagram no pertenece a la empresa activa.',
      );
    }

    const reply = (
      await this.chatAgentService.reply(
        profile,
        commercialSession,
        input.customerMessage,
      )
    ).trim();

    if (
      reply ===
      '__CHATPRO_INTERNAL_SUPPRESS_EXTERNAL_AUTOMATION_7F4D__'
    ) {
      console.log(
        `[ChatPro][Instagram] respuesta automática externa suprimida session=${input.sessionId}`,
      );
      return;
    }

    if (!reply) {
      throw new Error(
        'El motor comercial no devolvió una respuesta utilizable para Instagram.',
      );
    }

    const providerMessageId =
      await this.sendInstagramText({
        instagramId: input.instagramId,
        recipientId: input.recipientId,
        text: reply,
        credentialsEncrypted: input.credentialsEncrypted,
        setupSource: input.setupSource,
        apiVersion: input.apiVersion,
      });

    const now = new Date().toISOString();

    const { error: saveError } = await client
      .from('social_conversations')
      .insert({
        company_id: input.companyId,
        session_id: input.sessionId,
        channel: 'instagram',
        external_customer_id: input.recipientId,
        provider_message_id: providerMessageId,
        sender: 'assistant',
        author_type: 'assistant',
        message_type: 'text',
        message: reply,
        media_url: null,
        created_at: now,
      });

    if (saveError) {
      throw new Error(
        `Instagram respondió, pero no se pudo guardar la respuesta: ${saveError.message}`,
      );
    }

    const { error: updateError } = await client
      .from('social_conversation_sessions')
      .update({
        last_message_at: now,
        updated_at: now,
      })
      .eq('id', input.sessionId)
      .eq('company_id', input.companyId);

    if (updateError) {
      throw new Error(
        `No se pudo actualizar la sesión de Instagram después de responder: ${updateError.message}`,
      );
    }

    console.log(
      `[ChatPro][Instagram] Sofia respondió con motor comercial compartido session=${input.sessionId}`,
    );
  }


  async replyToInstagramImage(input: {
    companyId: string;
    instagramId: string;
    sessionId: string;
    recipientId: string;
    mediaUrl: string;
    caption?: string;
    credentialsEncrypted: string | null;
    setupSource?: string;
    apiVersion?: string;
  }): Promise<void> {
    const client = this.supabaseService.getClient();

    const { data: sessionRow, error: sessionError } =
      await client
        .from('social_conversation_sessions')
        .select('id, attention_status')
        .eq('id', input.sessionId)
        .eq('company_id', input.companyId)
        .maybeSingle();

    if (sessionError) {
      throw new Error(
        `No se pudo validar la sesión visual de Instagram: ${sessionError.message}`,
      );
    }

    if (!sessionRow) {
      return;
    }

    const attentionStatus =
      typeof sessionRow.attention_status === 'string'
        ? sessionRow.attention_status
        : '';

    if (attentionStatus !== 'ai') {
      console.log(
        `[ChatPro][Instagram][vision] IA omitida session=${input.sessionId} status=${attentionStatus}`,
      );
      return;
    }

    if (!input.mediaUrl.trim()) {
      throw new Error(
        'La imagen de Instagram no contiene una URL utilizable.',
      );
    }

    const profile =
      await this.conversationMemoryService.getCompanyProfileById(
        input.companyId,
      );

    let commercialSession =
      await this.agentSessionRuntimeService.getSessionById(
        input.sessionId,
      );

    if (commercialSession.companyId !== input.companyId) {
      throw new Error(
        'La sesión comercial visual de Instagram no pertenece a la empresa activa.',
      );
    }

    const mediaResponse = await fetch(input.mediaUrl);

    if (!mediaResponse.ok) {
      throw new Error(
        `No se pudo descargar la imagen de Instagram (${mediaResponse.status}).`,
      );
    }

    const rawMimeType =
      mediaResponse.headers.get('content-type') || 'image/jpeg';

    const mimeType =
      rawMimeType.split(';')[0].trim().toLowerCase() ||
      'image/jpeg';

    const supportedMimeTypes = new Set([
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'image/gif',
    ]);

    if (!supportedMimeTypes.has(mimeType)) {
      throw new Error(
        `El formato ${mimeType} de Instagram no es compatible con visión.`,
      );
    }

    const imageBuffer =
      Buffer.from(await mediaResponse.arrayBuffer());

    if (!imageBuffer.length) {
      throw new Error(
        'La imagen descargada desde Instagram está vacía.',
      );
    }

    if (imageBuffer.length > 15 * 1024 * 1024) {
      throw new Error(
        'La imagen de Instagram supera el límite seguro de 15 MB.',
      );
    }

    const imageDataUrl =
      `data:${mimeType};base64,${imageBuffer.toString('base64')}`;

    const { data: historyRows, error: historyError } =
      await client
        .from('social_conversations')
        .select('author_type, message, message_type, created_at')
        .eq('company_id', input.companyId)
        .eq('session_id', input.sessionId)
        .order('created_at', { ascending: false })
        .limit(16);

    if (historyError) {
      console.error(
        '[ChatPro][Instagram][vision] no se pudo cargar historial visual:',
        historyError,
      );
    }

    const history = (
      (
        historyRows ?? []
      ) as Array<{
        author_type?: string | null;
        message?: string | null;
        message_type?: string | null;
      }>
    )
      .slice()
      .reverse()
      .map((item) => {
        const role =
          item.author_type === 'customer'
            ? 'CLIENTE'
            : item.author_type === 'advisor'
              ? 'ASESOR'
              : 'IA';

        const type =
          item.message_type && item.message_type !== 'text'
            ? ` [${item.message_type}]`
            : '';

        return `${role}${type}: ${item.message || ''}`;
      })
      .join('\n')
      .slice(-12000);

    const visionResponse =
      await this.getClient().responses.create({
        model: this.getModel(),
        instructions: [
          'Eres el analizador multimodal central de una plataforma comercial multiempresa.',
          'Analiza conjuntamente la imagen actual, el historial reciente y el contexto comercial.',
          'Debes distinguir comprobantes de pago, productos, capturas de catálogo, documentos, garantías y otras imágenes.',
          'Nunca afirmes que un producto pertenece a la empresa solamente por su apariencia.',
          'Nunca afirmes que un pago está aprobado o confirmado solamente porque exista una captura.',
          'payment_proof significa recibo, transferencia, consignación, comprobante o evidencia clara de una transacción ya realizada.',
          'product significa producto, prenda, ficha de producto, captura de catálogo, carrito o publicación donde lo relevante sea uno o varios productos.',
          'mixed significa que hay simultáneamente señales claras relacionadas con pago y producto.',
          'has_product_intent=true cuando el historial o el mensaje muestran que la persona quiere identificar, consultar, comprar, agregar, revisar talla, color, disponibilidad o precio del producto.',
          'Si la IA acaba de pedir una foto o referencia para continuar la venta, una imagen de producto sí puede tener intención comercial aunque llegue sin texto.',
          'has_payment_intent=true cuando la imagen parece comprobante y el historial muestra que la persona estaba pagando o la IA había solicitado evidencia del pago.',
          'Extrae datos del producto únicamente cuando sean visibles. No inventes nombre, referencia, precio, color ni texto.',
          'Devuelve únicamente JSON válido, sin markdown, con esta estructura exacta:',
          '{"image_type":"payment_proof|product|mixed|warranty_or_return|shipping_or_document|other|ambiguous","primary_intent":"validate_payment|add_or_review_product|customer_service|clarify","has_payment_intent":true,"has_product_intent":false,"confidence":"low|medium|high","reason":"...","advisor_summary":"...","summary":"...","category":"...","product_name":"...","reference":"...","visible_price":"...","colors":["..."],"visible_text":"...","search_terms":["..."]}',
          'search_terms debe tener entre 1 y 8 términos breves útiles para buscar el producto en un catálogo real.',
          'advisor_summary debe resumir en máximo 240 caracteres qué envió el cliente y qué parece necesitar.',
          `Empresa activa: ${profile.name}.`,
          `Instrucciones configuradas: ${(profile.aiInstructions || 'Sin instrucciones adicionales.').slice(0, 5000)}`,
          `Contexto comercial: ${JSON.stringify(commercialSession.context).slice(0, 7000)}`,
          `Historial reciente:\n${history || 'Sin historial previo.'}`,
        ].join('\n'),
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: input.caption?.trim()
                  ? `Texto enviado junto a la imagen: ${input.caption.trim()}`
                  : 'La imagen llegó sin texto adjunto. Interprétala usando el historial y el contexto.',
              },
              {
                type: 'input_image',
                image_url: imageDataUrl,
                detail: 'auto',
              },
            ],
          },
        ],
      } as any);

    const raw =
      (visionResponse.output_text || '')
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '');

    let parsed: Record<string, unknown>;

    try {
      const value = JSON.parse(raw) as unknown;

      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value)
      ) {
        throw new Error('JSON visual inválido');
      }

      parsed = value as Record<string, unknown>;
    } catch {
      throw new Error(
        'OpenAI no devolvió una clasificación visual estructurada para Instagram.',
      );
    }

    const readText = (
      key: string,
      max: number,
    ): string =>
      typeof parsed[key] === 'string'
        ? String(parsed[key])
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, max)
        : '';

    const readList = (
      key: string,
      maxItems: number,
      maxLength: number,
    ): string[] =>
      Array.isArray(parsed[key])
        ? (parsed[key] as unknown[])
            .filter(
              (item): item is string =>
                typeof item === 'string',
            )
            .map((item) =>
              item
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, maxLength),
            )
            .filter(Boolean)
            .slice(0, maxItems)
        : [];

    const allowedTypes = new Set([
      'payment_proof',
      'product',
      'mixed',
      'warranty_or_return',
      'shipping_or_document',
      'other',
      'ambiguous',
    ]);

    const allowedIntents = new Set([
      'validate_payment',
      'add_or_review_product',
      'customer_service',
      'clarify',
    ]);

    const rawType = readText('image_type', 50);
    const rawIntent = readText('primary_intent', 50);
    const rawConfidence = readText('confidence', 20);

    const imageType =
      allowedTypes.has(rawType)
        ? rawType
        : 'ambiguous';

    const primaryIntent =
      allowedIntents.has(rawIntent)
        ? rawIntent
        : 'clarify';

    const hasPaymentIntent =
      parsed.has_payment_intent === true;

    const hasProductIntent =
      parsed.has_product_intent === true;

    const confidence =
      rawConfidence === 'high' ||
      rawConfidence === 'medium'
        ? rawConfidence
        : 'low';

    const reason =
      readText('reason', 500) ||
      'Clasificación multimodal de Instagram.';

    const advisorSummary =
      readText('advisor_summary', 240) ||
      'Revisar la última imagen de Instagram.';

    const summary =
      readText('summary', 1000) ||
      'El cliente envió una imagen.';

    const category =
      readText('category', 120) ||
      'producto';

    const productName =
      readText('product_name', 240);

    const reference =
      readText('reference', 120);

    const visiblePrice =
      readText('visible_price', 80);

    const colors =
      readList('colors', 6, 50);

    const visibleText =
      readText('visible_text', 1200);

    const searchTerms =
      readList('search_terms', 8, 100);

    console.log(
      `[ChatPro][Instagram][vision] session=${input.sessionId} ` +
        `type=${imageType} intent=${primaryIntent} ` +
        `payment=${hasPaymentIntent} product=${hasProductIntent} ` +
        `confidence=${confidence}`,
    );

    const now = new Date().toISOString();

    let agentMessage: string;

    if (
      hasPaymentIntent &&
      (
        primaryIntent === 'validate_payment' ||
        imageType === 'payment_proof' ||
        imageType === 'mixed'
      )
    ) {
      commercialSession =
        await this.agentSessionRuntimeService.updateSession(
          commercialSession.id,
          {
            context: {
              ...commercialSession.context,
              multimodal_last_intent: {
                image_type: imageType,
                primary_intent: primaryIntent,
                has_payment_intent: hasPaymentIntent,
                has_product_intent: hasProductIntent,
                confidence,
                reason,
                received_at: now,
              },
              last_payment_evidence: {
                received: true,
                image_type: imageType,
                confidence,
                received_at: now,
              },
            },
          },
        );

      agentMessage = [
        '[COMPROBANTE_DE_PAGO_RECIBIDO]',
        input.caption?.trim()
          ? `Texto actual del cliente: ${input.caption.trim()}`
          : 'El cliente envió el comprobante sin texto adicional.',
        `Tipo interpretado: ${imageType}.`,
        `Confianza: ${confidence}.`,
        `Contexto interpretado: ${advisorSummary}.`,
        'La imagen parece evidencia o comprobante de pago.',
        'No afirmes que el pago está validado, aprobado o confirmado únicamente por haber recibido esta imagen.',
        'No reinicies la venta ni vuelvas a pedir datos que ya estén guardados.',
        'No vuelvas a solicitar el mismo comprobante.',
        'Continúa desde el estado actual de la compra usando la configuración real de Medios de pago y Finalización de compra y checkout.',
        'Si la configuración indica que después del comprobante corresponde crear el checkout y están completos los requisitos, utiliza las herramientas reales disponibles.',
        'No transfieras automáticamente a un asesor solamente por recibir el comprobante.',
      ].join('\n');
    } else if (
      imageType === 'product' ||
      imageType === 'mixed'
    ) {
      const visualMatch =
        await this.chatAgentService.matchIncomingVisualReference(
          profile,
          commercialSession,
          {
            imageDataUrl,
            customerText: input.caption?.trim() || '',
            summary,
            productName,
            reference,
            visiblePrice,
            visibleText,
            category,
            colors,
            searchTerms:
              searchTerms.length
                ? searchTerms
                : [category],
          },
        );

      commercialSession =
        await this.agentSessionRuntimeService.getSessionById(
          commercialSession.id,
        );

      const visualReference = {
        summary,
        category,
        product_name: productName || null,
        reference: reference || null,
        visible_price: visiblePrice || null,
        colors,
        visible_text: visibleText,
        search_terms:
          searchTerms.length
            ? searchTerms
            : [category],
        source_hint: 'instagram_image',
        confidence,
        match_type: visualMatch.matchType,
        match_confidence: visualMatch.confidence,
        matched_product: visualMatch.matchedProduct
          ? {
              title: visualMatch.matchedProduct.title,
              url: visualMatch.matchedProduct.url,
              price_from_cop:
                visualMatch.matchedProduct.priceFromCop || null,
            }
          : null,
        candidates: visualMatch.candidates
          .slice(0, 3)
          .map((candidate) => ({
            title: candidate.title,
            url: candidate.url,
            price_from_cop:
              candidate.priceFromCop || null,
          })),
        caption: input.caption?.trim() || null,
        received_at: now,
      };

      const previousReferences =
        Array.isArray(
          commercialSession.context
            .commercial_visual_references,
        )
          ? (
              commercialSession.context
                .commercial_visual_references as unknown[]
            ).filter(
              (item) =>
                Boolean(item) &&
                typeof item === 'object' &&
                !Array.isArray(item),
            )
          : [];

      commercialSession =
        await this.agentSessionRuntimeService.updateSession(
          commercialSession.id,
          {
            context: {
              ...commercialSession.context,
              multimodal_last_intent: {
                image_type: imageType,
                primary_intent: primaryIntent,
                has_payment_intent: hasPaymentIntent,
                has_product_intent: hasProductIntent,
                confidence,
                reason,
                received_at: now,
              },
              last_visual_reference:
                visualReference,
              commercial_visual_references: [
                ...previousReferences,
                visualReference,
              ].slice(-20),
              commercial_last_customer_message_at:
                now,
            },
          },
        );

      agentMessage = [
        '[REFERENCIA_VISUAL]',
        input.caption?.trim()
          ? `Mensaje real actual del cliente: ${input.caption.trim()}`
          : 'El cliente envió una imagen relacionada con la conversación actual.',
        `Descripción visual: ${summary}`,
        `Categoría aproximada: ${category}`,
        productName
          ? `Nombre comercial leído: ${productName}`
          : '',
        reference
          ? `Referencia o código leído: ${reference}`
          : '',
        visiblePrice
          ? `Precio visible leído: ${visiblePrice}`
          : '',
        colors.length
          ? `Colores observados: ${colors.join(', ')}`
          : '',
        visibleText
          ? `Texto visible en la imagen: ${visibleText}`
          : '',
        `Validación contra catálogo real: ${visualMatch.matchType}. Confianza: ${visualMatch.confidence}.`,
        visualMatch.matchedProduct
          ? `Producto real validado: ${visualMatch.matchedProduct.title}. URL: ${visualMatch.matchedProduct.url}. Precio del catálogo: ${visualMatch.matchedProduct.priceFromCop || 'consultar producto seleccionado'}.`
          : '',
        visualMatch.candidates.length
          ? `Posibles coincidencias reales, todavía sin confirmar: ${visualMatch.candidates
              .slice(0, 3)
              .map(
                (candidate, index) =>
                  `${index + 1}. ${candidate.title} — ${candidate.url}`,
              )
              .join(' | ')}`
          : '',
        hasProductIntent
          ? 'Existe intención comercial relacionada con este producto. Continúa desde el contexto real de la venta.'
          : 'La imagen contiene un producto, pero la intención actual no es suficientemente clara. Haz una sola pregunta breve para aclarar qué necesita.',
        'Si existe coincidencia exacta, usa las herramientas comerciales reales para consultar producto, variantes, precio y disponibilidad.',
        'No uses el precio visible de la captura como precio vigente si el catálogo real devuelve otro valor.',
        'No vuelvas a pedir el enlace o el nombre si la referencia ya quedó identificada de forma exacta.',
      ]
        .filter(Boolean)
        .join('\n');
    } else {
      commercialSession =
        await this.agentSessionRuntimeService.updateSession(
          commercialSession.id,
          {
            context: {
              ...commercialSession.context,
              multimodal_last_intent: {
                image_type: imageType,
                primary_intent: primaryIntent,
                has_payment_intent: hasPaymentIntent,
                has_product_intent: hasProductIntent,
                confidence,
                reason,
                received_at: now,
              },
            },
          },
        );

      agentMessage = [
        '[IMAGEN_NO_PRODUCTO]',
        input.caption?.trim()
          ? `Texto actual del cliente: ${input.caption.trim()}`
          : 'La imagen llegó sin texto adicional.',
        `Tipo interpretado: ${imageType}.`,
        `Intención principal: ${primaryIntent}.`,
        `Contexto interpretado: ${advisorSummary}.`,
        `Motivo: ${reason}.`,
        'Responde usando el historial reciente y las reglas reales de la empresa.',
        'No busques esta imagen en el catálogo ni inventes productos.',
        imageType === 'ambiguous'
          ? 'Si hace falta, formula una sola pregunta breve para saber qué necesita.'
          : '',
      ]
        .filter(Boolean)
        .join('\n');
    }

    const reply = (
      await this.chatAgentService.reply(
        profile,
        commercialSession,
        agentMessage,
      )
    ).trim();

    if (
      reply ===
      '__CHATPRO_INTERNAL_SUPPRESS_EXTERNAL_AUTOMATION_7F4D__'
    ) {
      console.log(
        `[ChatPro][Instagram][vision] respuesta externa suprimida session=${input.sessionId}`,
      );
      return;
    }

    if (!reply) {
      throw new Error(
        'El motor comercial no devolvió respuesta para la imagen de Instagram.',
      );
    }

    const providerMessageId =
      await this.sendInstagramText({
        instagramId: input.instagramId,
        recipientId: input.recipientId,
        text: reply,
        credentialsEncrypted:
          input.credentialsEncrypted,
        setupSource: input.setupSource,
        apiVersion: input.apiVersion,
      });

    const sentAt = new Date().toISOString();

    const { error: saveError } =
      await client
        .from('social_conversations')
        .insert({
          company_id: input.companyId,
          session_id: input.sessionId,
          channel: 'instagram',
          external_customer_id:
            input.recipientId,
          provider_message_id:
            providerMessageId,
          sender: 'assistant',
          author_type: 'assistant',
          message_type: 'text',
          message: reply,
          media_url: null,
          created_at: sentAt,
        });

    if (saveError) {
      throw new Error(
        `Instagram respondió a la imagen, pero no pudo guardar la respuesta: ${saveError.message}`,
      );
    }

    const { error: updateError } =
      await client
        .from('social_conversation_sessions')
        .update({
          last_message_at: sentAt,
          updated_at: sentAt,
        })
        .eq('id', input.sessionId)
        .eq('company_id', input.companyId);

    if (updateError) {
      throw new Error(
        `No se pudo actualizar la sesión de Instagram después de la imagen: ${updateError.message}`,
      );
    }

    console.log(
      `[ChatPro][Instagram][vision] imagen procesada con cerebro comercial session=${input.sessionId}`,
    );
  }


  private async sendInstagramText(input: {
    instagramId: string;
    recipientId: string;
    text: string;
    credentialsEncrypted: string | null;
    setupSource?: string;
    apiVersion?: string;
  }): Promise<string | null> {
    if (!input.credentialsEncrypted) {
      throw new Error(
        'La integración de Instagram no tiene credenciales guardadas.',
      );
    }

    const credentials =
      this.credentialsService.decrypt(
        input.credentialsEncrypted,
      );

    const accessToken =
      typeof credentials.access_token === 'string'
        ? credentials.access_token.trim()
        : '';

    if (!accessToken) {
      throw new Error(
        'No se encontró el token de Meta para Instagram.',
      );
    }

    const setupSource =
      input.setupSource?.trim() || '';

    const version =
      input.apiVersion?.trim() ||
      (setupSource === 'instagram_login'
        ? process.env.META_INSTAGRAM_GRAPH_VERSION?.trim()
        : process.env.META_MESSENGER_GRAPH_VERSION?.trim()) ||
      'v25.0';

    const graphHost =
      setupSource === 'instagram_login'
        ? 'graph.instagram.com'
        : 'graph.facebook.com';

    const url = new URL(
      `https://${graphHost}/${version}/${encodeURIComponent(
        input.instagramId,
      )}/messages`,
    );

    url.searchParams.set(
      'access_token',
      accessToken,
    );

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        recipient: {
          id: input.recipientId,
        },
        message: {
          text: input.text,
        },
      }),
    });

    const raw = await response.text();

    let payload: Record<string, unknown> = {};

    try {
      const parsed: unknown = JSON.parse(raw);

      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed)
      ) {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      payload = {};
    }

    if (!response.ok) {
      const metaError =
        payload.error &&
        typeof payload.error === 'object' &&
        !Array.isArray(payload.error)
          ? payload.error as Record<string, unknown>
          : {};

      const message =
        typeof metaError.message === 'string'
          ? metaError.message
          : `HTTP ${response.status}`;

      throw new Error(
        `Meta Instagram rechazó la respuesta: ${message}`,
      );
    }

    return typeof payload.message_id === 'string'
      ? payload.message_id
      : null;
  }

  private async sendMessengerText(input: {
    pageId: string;
    recipientId: string;
    text: string;
    credentialsEncrypted: string | null;
  }): Promise<string | null> {
    if (!input.credentialsEncrypted) {
      throw new Error(
        'La integración de Messenger no tiene credenciales guardadas.',
      );
    }

    const credentials =
      this.credentialsService.decrypt(
        input.credentialsEncrypted,
      );

    const accessToken =
      typeof credentials.access_token === 'string'
        ? credentials.access_token.trim()
        : '';

    if (!accessToken) {
      throw new Error(
        'No se encontró el Page Access Token de Messenger.',
      );
    }

    const version =
      process.env.META_MESSENGER_GRAPH_VERSION?.trim() ||
      'v25.0';

    const url = new URL(
      `https://graph.facebook.com/${version}/me/messages`,
    );

    url.searchParams.set(
      'access_token',
      accessToken,
    );

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messaging_type: 'RESPONSE',
        recipient: {
          id: input.recipientId,
        },
        message: {
          text: input.text,
        },
      }),
    });

    const raw = await response.text();

    let payload: Record<string, unknown> = {};

    try {
      const parsed: unknown = JSON.parse(raw);

      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed)
      ) {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      payload = {};
    }

    if (!response.ok) {
      const metaError =
        payload.error &&
        typeof payload.error === 'object' &&
        !Array.isArray(payload.error)
          ? payload.error as Record<string, unknown>
          : {};

      const message =
        typeof metaError.message === 'string'
          ? metaError.message
          : `HTTP ${response.status}`;

      throw new Error(
        `Meta Messenger rechazó la respuesta: ${message}`,
      );
    }

    return typeof payload.message_id === 'string'
      ? payload.message_id
      : null;
  }

  private getClient(): OpenAI {
    if (this.client) {
      return this.client;
    }

    const apiKey =
      process.env.OPENAI_API_KEY?.trim();

    if (!apiKey) {
      throw new Error(
        'Falta OPENAI_API_KEY en Railway.',
      );
    }

    this.client = new OpenAI({
      apiKey,
    });

    return this.client;
  }

  private getModel(): string {
    return (
      process.env.OPENAI_MODEL?.trim() ||
      'gpt-5-mini'
    );
  }
}
