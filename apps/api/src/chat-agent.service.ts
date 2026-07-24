import { CartService } from './cart.service';
import { CustomerOrderService } from './customer-order.service';
import { CompanyCommerceService } from './company-commerce.service';
import { type CompanyCommerceProduct } from './company-shopify.service';
import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import {
  ConversationMemoryService,
  type CompanyProfile,
  type ConversationSession,
} from './conversation-memory.service';
import { ShopifyService } from './shopify.service';
import { SupabaseService } from './supabase.service';

type JsonObject = Record<string, unknown>;

type ShopifyProduct = NonNullable<
  Awaited<ReturnType<ShopifyService['getProductByHandle']>>
>;

type SelectedProduct = {
  id: string;
  handle: string;
  title: string;
  url: string;
};

type ProductOption = {
  name: string;
  value: string;
};

type SelectedVariant = {
  id: string;
  legacyResourceId: string;
  title: string;
  price: string;
  options: ProductOption[];
};

type SelectedVariantSelection = SelectedVariant & {
  quantity: number;
};

type VariantSelectionRequest = {
  optionValues: string[];
  quantity: number;
};

@Injectable()
export class ChatAgentService {
  private client: OpenAI | null = null;

  constructor(
    private readonly cartService: CartService,
    private readonly customerOrderService: CustomerOrderService,
    private readonly companyCommerceService: CompanyCommerceService,
    private readonly shopifyService: ShopifyService,
    private readonly supabaseService: SupabaseService,
    private readonly conversationMemoryService: ConversationMemoryService,
  ) {}

  async reply(
    profile: CompanyProfile,
    session: ConversationSession,
    customerMessage: string,
  ): Promise<string> {
    const openingContextStatus = this.getContextStatus(
      profile,
      session,
    );
    const startsNewConversation =
      !openingContextStatus.is_within_context_window;
    let activeSession =
      await this.prepareSessionForIncomingActivity(
        profile,
        session,
      );

    const routingStartedAt = Date.now();
    const routing = await this.resolveMessageRouting(
      profile,
      activeSession,
      customerMessage,
    );
    const clarificationReply = await this.applyMessageUnderstanding(
      activeSession,
      routing.understanding,
    );

    console.log(
      `[ChatPro][routing] source=${routing.source} ` +
      `understanding=${routing.understanding} intent=${routing.intent} ` +
      `duration_ms=${Date.now() - routingStartedAt}`,
    );

    if (clarificationReply) {
      return clarificationReply;
    }

    const currentIntent = routing.intent;

    activeSession =
      currentIntent === 'new_catalog_search'
        ? await this.conversationMemoryService.updateSession(
            activeSession.id,
            {
              stage: 'sales',
              context: this.clearSelectedProductContext(
                activeSession.context,
              ),
            },
          )
        : activeSession;

    const collections =
      await this.getCollectionsForSession(activeSession);
    const directCollectionReply =
      await this.tryBuildDirectCollectionReply(
        activeSession,
        customerMessage,
        collections,
      );

    if (directCollectionReply) {
      return directCollectionReply;
    }

    const recoveryContext = this.getActiveRecoveryContext(
      activeSession.context,
    );
    const contextStatus = this.getContextStatus(profile, activeSession);
    const history =
      !startsNewConversation &&
      contextStatus.is_within_context_window
        ? await this.getRecentMessages(activeSession.id)
        : [];

    const input: any[] = [
      {
        role: 'user',
        content: JSON.stringify({
          company: {
            name: profile.name,
            settings: profile.settings,
          },
          session: {
            stage: activeSession.stage,
            context: activeSession.context,
            last_message_at: activeSession.lastMessageAt,
            context_status: contextStatus,
            recovery_context: recoveryContext,
            starts_new_conversation: startsNewConversation,
          },
          conversation_history: history,
          current_customer_message: customerMessage,
          real_collections: collections.map((collection) => ({
            id: collection.id,
            title: collection.title,
            url: collection.onlineStoreUrl,
          })),
        }),
      },
    ];

    try {
      let response = await this.getClient().responses.create({
      model: this.getModel(),
      instructions: this.buildInstructions(
        profile,
        Boolean(recoveryContext),
      ),
      input,
      tools: this.getTools(),
      tool_choice: 'auto',
    });

      for (let turn = 0; turn < 10; turn += 1) {
      const toolOutputs: Array<{
        type: 'function_call_output';
        call_id: string;
        output: string;
      }> = [];

      for (const item of response.output) {
        if (item.type !== 'function_call') {
          continue;
        }

        const result = await this.executeTool(
          item.name,
          item.arguments,
          activeSession,
        );

        if (
          item.name === 'request_human_attention' &&
          result &&
          typeof result === 'object' &&
          typeof (result as { customer_message?: unknown }).customer_message === 'string'
        ) {
          return (result as { customer_message: string }).customer_message;
        }

        toolOutputs.push({
          type: 'function_call_output',
          call_id: item.call_id,
          output: JSON.stringify(result),
        });

        activeSession =
          await this.conversationMemoryService.getSessionById(
            activeSession.id,
          );
      }

        if (!toolOutputs.length) {
          const clean = this.cleanReply(response.output_text);

          if (clean) {
            await this.clearTechnicalFailureState(activeSession.id);
            return this.enforceSalesReply(
              activeSession,
              clean,
            );
          }

          return this.finalizeAgentReply(
            profile,
            activeSession,
            [...input, ...response.output],
            Boolean(recoveryContext),
            'La respuesta final quedó vacía o contenía información técnica interna.',
          );
        }

      input.push(...response.output, ...toolOutputs);

      response = await this.getClient().responses.create({
        model: this.getModel(),
        instructions: this.buildInstructions(
          profile,
          Boolean(recoveryContext),
        ),
        input,
        tools: this.getTools(),
        tool_choice: 'auto',
      });
    }

      return this.finalizeAgentReply(
        profile,
        activeSession,
        [...input, ...response.output],
        Boolean(recoveryContext),
        'El ciclo de herramientas alcanzó el límite seguro de diez rondas.',
      );
    } catch (error) {
      console.error('Falló el motor principal de OpenAI:', error);

      return this.handleTechnicalFailure(
        activeSession.id,
        error instanceof Error
          ? error.message
          : 'No se pudo completar el ciclo principal de OpenAI.',
      );
    }
  }

  async matchIncomingVisualReference(
    profile: CompanyProfile,
    session: ConversationSession,
    input: {
      imageDataUrl: string;
      summary: string;
      productName: string;
      reference: string;
      visiblePrice: string;
      visibleText: string;
      category: string;
      colors: string[];
      searchTerms: string[];
    },
  ): Promise<{
    matchType: 'exact' | 'similar' | 'none';
    confidence: number;
    matchedProduct: {
      title: string;
      url: string;
      imageUrl: string | null;
      priceFromCop: string;
    } | null;
    candidates: Array<{
      title: string;
      url: string;
      imageUrl: string | null;
      priceFromCop: string;
    }>;
    queries: string[];
    reason: string;
  }> {
    type VisualCandidate = {
      id: string;
      title: string;
      url: string;
      imageUrl: string | null;
      priceFromCop: string;
      textScore: number;
      bundleLike: boolean;
    };

    const compact = (value: unknown, limit = 240): string =>
      typeof value === 'string'
        ? value.replace(/\s+/g, ' ').trim().slice(0, limit)
        : '';
    const normalized = (value: string): string =>
      this.normalizeText(value).replace(/\s+/g, ' ').trim();
    const usefulTokens = (value: string): string[] => {
      const ignored = new Set([
        'a',
        'al',
        'con',
        'de',
        'del',
        'el',
        'en',
        'esta',
        'este',
        'la',
        'las',
        'lo',
        'los',
        'para',
        'por',
        'producto',
        'un',
        'una',
        'y',
      ]);

      return normalized(value)
        .split(' ')
        .filter((token) => token.length >= 3 && !ignored.has(token));
    };
    const digits = (value: string): string =>
      value.replace(/[^\d]/g, '').replace(/^0+/, '');
    const querySeeds = [
      compact(input.reference, 120),
      compact(input.productName, 180),
      compact(input.visibleText, 220),
      ...input.searchTerms.map((item) => compact(item, 120)),
      [
        compact(input.category, 100),
        ...input.colors.slice(0, 2).map((item) => compact(item, 40)),
      ]
        .filter(Boolean)
        .join(' '),
    ].filter(Boolean);
    const queryMap = new Map<string, string>();

    for (const seed of querySeeds) {
      const key = normalized(seed);

      if (!key || queryMap.has(key)) {
        continue;
      }

      queryMap.set(key, seed);
    }

    const queries = [...queryMap.values()].slice(0, 6);
    const candidateMap = new Map<string, VisualCandidate>();
    const specificTargets = [
      compact(input.reference, 120),
      compact(input.productName, 180),
      compact(input.visibleText, 220),
    ].filter(Boolean);
    const visiblePriceDigits = digits(input.visiblePrice);

    const scoreTitle = (
      title: string,
      priceFromCop: string,
    ): number => {
      const titleNormalized = normalized(title);
      const titleTokens = usefulTokens(title);
      let score = 0;

      for (const target of specificTargets) {
        const targetNormalized = normalized(target);

        if (!targetNormalized) {
          continue;
        }

        if (titleNormalized === targetNormalized) {
          score = Math.max(score, 1);
          continue;
        }

        if (
          targetNormalized.includes(titleNormalized) ||
          titleNormalized.includes(targetNormalized)
        ) {
          score = Math.max(score, 0.9);
        }

        const targetTokens = usefulTokens(target);

        if (targetTokens.length && titleTokens.length) {
          const common = titleTokens.filter((token) =>
            targetTokens.includes(token),
          ).length;
          const coverage =
            common / Math.max(1, Math.min(
              titleTokens.length,
              targetTokens.length,
            ));

          score = Math.max(score, coverage * 0.82);
        }
      }

      if (
        visiblePriceDigits &&
        digits(priceFromCop) === visiblePriceDigits
      ) {
        score = Math.min(1, score + 0.08);
      }

      return score;
    };

    for (const query of queries) {
      try {
        const result = await this.searchProducts(session, query);
        const products =
          result &&
          typeof result === 'object' &&
          Array.isArray(
            (result as { products?: unknown }).products,
          )
            ? (result as { products: unknown[] }).products
            : [];

        for (const item of products) {
          if (!item || typeof item !== 'object') {
            continue;
          }

          const product = item as Record<string, unknown>;
          const title = compact(product.title, 240);
          const url = compact(product.url, 1000);

          if (!title || !url) {
            continue;
          }

          const id = compact(product.id, 300) || url;
          const imageUrl =
            typeof product.image_url === 'string' &&
            product.image_url.trim()
              ? product.image_url.trim()
              : null;
          const priceFromCop =
            typeof product.price_from_cop === 'string' ||
            typeof product.price_from_cop === 'number'
              ? String(product.price_from_cop)
              : '';
          const candidate: VisualCandidate = {
            id,
            title,
            url,
            imageUrl,
            priceFromCop,
            textScore: scoreTitle(title, priceFromCop),
            bundleLike: this.isBundleLikeProductTitle(title),
          };
          const previous = candidateMap.get(id);

          if (!previous || candidate.textScore > previous.textScore) {
            candidateMap.set(id, candidate);
          }
        }
      } catch (error) {
        console.error(
          `[ChatPro][visual-match] falló búsqueda "${query}":`,
          error,
        );
      }
    }

    const ranked = [...candidateMap.values()]
      .sort((left, right) => {
        if (right.textScore !== left.textScore) {
          return right.textScore - left.textScore;
        }

        if (left.bundleLike !== right.bundleLike) {
          return left.bundleLike ? 1 : -1;
        }

        return left.title.localeCompare(
          right.title,
          'es',
          { sensitivity: 'base' },
        );
      })
      .slice(0, 12);
    const top = ranked[0] ?? null;
    const second = ranked[1] ?? null;
    const hasSpecificText =
      Boolean(input.productName.trim()) ||
      Boolean(input.reference.trim()) ||
      Boolean(input.visibleText.trim());

    const selectExactCandidate = async (
      candidate: VisualCandidate,
      confidence: number,
      reason: string,
    ) => {
      const selected = await this.selectProductByName(
        session,
        candidate.title,
      );
      const ok =
        selected &&
        typeof selected === 'object' &&
        (selected as { ok?: unknown }).ok === true;

      if (!ok) {
        return null;
      }

      return {
        matchType: 'exact' as const,
        confidence,
        matchedProduct: {
          title: candidate.title,
          url: candidate.url,
          imageUrl: candidate.imageUrl,
          priceFromCop: candidate.priceFromCop,
        },
        candidates: [],
        queries,
        reason,
      };
    };

    if (
      top &&
      hasSpecificText &&
      top.textScore >= 0.94 &&
      (!second || top.textScore - second.textScore >= 0.08)
    ) {
      const exact = await selectExactCandidate(
        top,
        Math.max(0.94, top.textScore),
        'El nombre, referencia o texto visible coincide con un producto real.',
      );

      if (exact) {
        console.log(
          `[ChatPro][visual-match] source=text match=exact product="${top.title}"`,
        );
        return exact;
      }
    }

    const visualDescription =
      normalized(input.summary);
    const imageShowsSeveralProducts =
      /\b(varios|varias|dos|tres|cuatro|combo|pack|kit|conjunto de)\b/.test(
        visualDescription,
      );
    const preferredVisualPool =
      imageShowsSeveralProducts
        ? ranked
        : ranked.filter((candidate) => !candidate.bundleLike);
    const visualCandidates = (
      preferredVisualPool.length
        ? preferredVisualPool
        : ranked
    )
      .filter(
        (candidate) =>
          typeof candidate.imageUrl === 'string' &&
          /^https?:\/\//i.test(candidate.imageUrl),
      )
      .slice(0, 8);
    let visualChoice: VisualCandidate | null = null;
    let visualMatchType: 'exact' | 'similar' | 'none' = 'none';
    let visualConfidence = 0;
    let visualReason = '';

    if (
      visualCandidates.length &&
      /^data:image\//i.test(input.imageDataUrl)
    ) {
      try {
        const content: any[] = [
          {
            type: 'input_text',
            text:
              'IMAGEN DEL CLIENTE. Compárala con los candidatos reales del catálogo.',
          },
          {
            type: 'input_image',
            image_url: input.imageDataUrl,
            detail: 'high',
          },
        ];

        visualCandidates.forEach((candidate, index) => {
          content.push(
            {
              type: 'input_text',
              text:
                `CANDIDATO ${index + 1}: ${candidate.title}. ` +
                `Precio desde: ${candidate.priceFromCop || 'sin dato'}.`,
            },
            {
              type: 'input_image',
              image_url: candidate.imageUrl,
              detail: 'auto',
            },
          );
        });

        const response = await this.getClient().responses.create({
          model: this.getModel(),
          instructions: [
            'Compara una imagen enviada por un cliente con imágenes de productos reales de una tienda.',
            'Devuelve únicamente JSON válido y sin markdown:',
            '{"match_type":"exact|similar|none","candidate_index":1,"confidence":0.0,"reason":"..."}',
            'exact significa que es el mismo diseño o producto, aunque cambien el recorte, modelo, fondo, color disponible o ángulo.',
            'similar significa que comparte categoría o estilo, pero no puedes asegurar que sea la misma referencia.',
            'none significa que ningún candidato es suficientemente parecido.',
            'Sé conservador: no uses exact solo por compartir color, categoría, mangas o silueta general.',
            'candidate_index empieza en 1. Usa null cuando match_type sea none.',
            `Empresa activa: ${profile.name}.`,
          ].join('\n'),
          input: [
            {
              role: 'user',
              content,
            },
          ],
        } as any);
        const raw = response.output_text
          .trim()
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/i, '');
        const parsed = JSON.parse(raw) as {
          match_type?: unknown;
          candidate_index?: unknown;
          confidence?: unknown;
          reason?: unknown;
        };
        const index = Number(parsed.candidate_index);
        const confidence = Number(parsed.confidence);
        const matchType =
          parsed.match_type === 'exact' ||
          parsed.match_type === 'similar'
            ? parsed.match_type
            : 'none';

        visualMatchType = matchType;
        visualConfidence =
          Number.isFinite(confidence)
            ? Math.min(1, Math.max(0, confidence))
            : 0;
        visualReason = compact(parsed.reason, 360);

        if (
          Number.isInteger(index) &&
          index >= 1 &&
          index <= visualCandidates.length
        ) {
          visualChoice = visualCandidates[index - 1] ?? null;
        }
      } catch (error) {
        console.error(
          '[ChatPro][visual-match] no se pudo comparar imágenes:',
          error,
        );
      }
    }

    if (
      visualMatchType === 'exact' &&
      visualChoice &&
      visualConfidence >= 0.84
    ) {
      const exact = await selectExactCandidate(
        visualChoice,
        visualConfidence,
        visualReason ||
          'La imagen coincide con un producto real del catálogo.',
      );

      if (exact) {
        console.log(
          `[ChatPro][visual-match] source=vision match=exact ` +
          `confidence=${visualConfidence.toFixed(2)} ` +
          `product="${visualChoice.title}"`,
        );
        return exact;
      }
    }

    const candidateOrder = [
      ...(visualChoice ? [visualChoice] : []),
      ...ranked.filter(
        (candidate) => candidate.id !== visualChoice?.id,
      ),
    ];
    const candidates = candidateOrder
      .slice(0, 3)
      .map((candidate) => ({
        title: candidate.title,
        url: candidate.url,
        imageUrl: candidate.imageUrl,
        priceFromCop: candidate.priceFromCop,
      }));

    if (candidates.length) {
      console.log(
        `[ChatPro][visual-match] match=similar candidates=${candidates.length}`,
      );
      return {
        matchType: 'similar',
        confidence:
          visualMatchType === 'similar'
            ? visualConfidence
            : top?.textScore ?? 0,
        matchedProduct: null,
        candidates,
        queries,
        reason:
          visualReason ||
          'No existe certeza suficiente para confirmar una referencia exacta.',
      };
    }

    console.log('[ChatPro][visual-match] match=none');
    return {
      matchType: 'none',
      confidence: 0,
      matchedProduct: null,
      candidates: [],
      queries,
      reason:
        'No se encontraron productos reales suficientes para validar la imagen.',
    };
  }

  async prepareSessionForIncomingActivity(
    profile: CompanyProfile,
    session: ConversationSession,
  ): Promise<ConversationSession> {
    const status = this.getContextStatus(profile, session);
    const now = new Date().toISOString();
    const baseContext =
      status.is_within_context_window
        ? { ...session.context }
        : this.startFreshConversationContext(session.context);

    return this.conversationMemoryService.updateSession(
      session.id,
      {
        stage:
          status.is_within_context_window
            ? session.stage
            : 'active',
        context: {
          ...baseContext,
          commercial_last_customer_message_at: now,
        },
      },
    );
  }

  async buildExactVisualProductReply(
    session: ConversationSession,
  ): Promise<string | null> {
    const currentSession =
      await this.conversationMemoryService.getSessionById(session.id);
    const result =
      await this.getSelectedProduct(currentSession);

    if (
      !result ||
      typeof result !== 'object' ||
      (result as { ok?: unknown }).ok !== true
    ) {
      return null;
    }

    const snapshot =
      (result as { selected_product?: unknown }).selected_product;

    if (
      !snapshot ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot)
    ) {
      return null;
    }

    const product = snapshot as JsonObject;
    const title =
      typeof product.title === 'string'
        ? product.title.trim()
        : '';

    if (!title) {
      return null;
    }

    const variants = Array.isArray(product.variants)
      ? product.variants.filter(
          (item): item is JsonObject =>
            Boolean(item) &&
            typeof item === 'object' &&
            !Array.isArray(item),
        )
      : [];
    const prices = variants
      .map((variant) => {
        const value = variant.price_cop;
        return typeof value === 'string' ||
          typeof value === 'number'
          ? Number(value)
          : NaN;
      })
      .filter((value) => Number.isFinite(value));
    const startingPrice =
      typeof product.price_from_cop === 'string' ||
      typeof product.price_from_cop === 'number'
        ? Number(product.price_from_cop)
        : NaN;

    if (!prices.length && Number.isFinite(startingPrice)) {
      prices.push(startingPrice);
    }

    const uniquePrices = Array.from(
      new Set(prices.map((value) => Math.round(value))),
    ).sort((left, right) => left - right);
    const priceText =
      uniquePrices.length === 1
        ? ` cuesta ${this.formatCop(uniquePrices[0])}`
        : uniquePrices.length > 1
          ? ` tiene opciones desde ${this.formatCop(uniquePrices[0])}`
          : '';

    const optionGroups = Array.isArray(product.options)
      ? product.options
          .filter(
            (item): item is JsonObject =>
              Boolean(item) &&
              typeof item === 'object' &&
              !Array.isArray(item),
          )
          .map((item) => {
            const name =
              typeof item.name === 'string'
                ? item.name.trim()
                : '';
            const values = Array.isArray(item.values)
              ? Array.from(
                  new Set(
                    item.values
                      .filter(
                        (value): value is string =>
                          typeof value === 'string' &&
                          value.trim().length > 0,
                      )
                      .map((value) => value.trim())
                      .filter(
                        (value) =>
                          this.normalizeText(value) !== 'default title',
                      ),
                  ),
                )
              : [];

            return { name, values };
          })
          .filter(
            (item) =>
              item.name &&
              this.normalizeText(item.name) !== 'title' &&
              item.values.length > 1,
          )
      : [];
    const preferredOption =
      optionGroups.find((item) =>
        /color|colour/i.test(item.name),
      ) ??
      optionGroups.find((item) =>
        /talla|size|medida/i.test(item.name),
      ) ??
      optionGroups[0] ??
      null;

    if (preferredOption) {
      const values = preferredOption.values.slice(0, 8);
      const label = preferredOption.name.toLowerCase();

      return (
        `${title}${priceText} y está disponible en ` +
        `${this.joinNaturalList(values)} 😊 ` +
        `¿Qué ${label} prefieres?`
      );
    }

    return `${title}${priceText} 😊 ¿Cuántas unidades necesitas?`;
  }

  private async tryBuildDirectCollectionReply(
    session: ConversationSession,
    customerMessage: string,
    collections: Array<{
      id: string;
      title: string;
      onlineStoreUrl: string;
    }>,
  ): Promise<string | null> {
    const normalizedMessage =
      this.normalizeText(customerMessage).replace(/\s+/g, ' ').trim();

    if (
      !normalizedMessage ||
      !/\b(ver|mostrar|muestra|catalogo|coleccion|busco|buscar|quiero|necesito)\b/.test(
        normalizedMessage,
      )
    ) {
      return null;
    }

    const ignored = new Set([
      'catalogo',
      'coleccion',
      'colecciones',
      'mostrar',
      'muestra',
      'productos',
      'producto',
      'quiero',
      'busco',
      'buscar',
      'necesito',
      'para',
      'ver',
      'una',
      'uno',
      'unos',
      'unas',
      'con',
      'del',
      'las',
      'los',
      'por',
    ]);
    const stem = (value: string): string => {
      if (value.length > 5 && value.endsWith('es')) {
        return value.slice(0, -2);
      }

      if (value.length > 4 && value.endsWith('s')) {
        return value.slice(0, -1);
      }

      return value;
    };
    const messageTokens = normalizedMessage
      .split(' ')
      .filter((token) => token.length >= 3 && !ignored.has(token))
      .map(stem);
    const ranked = collections
      .filter(
        (collection) =>
          collection &&
          typeof collection.id === 'string' &&
          typeof collection.title === 'string' &&
          typeof collection.onlineStoreUrl === 'string' &&
          collection.onlineStoreUrl.trim(),
      )
      .map((collection) => {
        const collectionTokens = this
          .normalizeText(collection.title)
          .split(' ')
          .filter(
            (token) =>
              token.length >= 3 &&
              !ignored.has(token),
          )
          .map(stem);
        const score = collectionTokens.filter((token) =>
          messageTokens.includes(token),
        ).length;

        return { collection, score };
      })
      .sort((left, right) => right.score - left.score);
    const best = ranked[0] ?? null;
    const second = ranked[1] ?? null;

    if (
      !best ||
      best.score < 1 ||
      best.score === (second?.score ?? -1)
    ) {
      return null;
    }

    await this.conversationMemoryService.updateSession(
      session.id,
      {
        stage: 'sales',
        context: {
          ...session.context,
          lastCollection: {
            id: best.collection.id,
            title: best.collection.title,
            url: best.collection.onlineStoreUrl,
          },
          lastCollectionOpenedAt: new Date().toISOString(),
        },
      },
    );

    return (
      `Perfecto 😊 Aquí tienes nuestro catálogo de ` +
      `${best.collection.title.toLowerCase()}:\n` +
      `${best.collection.onlineStoreUrl}\n` +
      'Envíame el enlace o una foto del producto que te guste.'
    );
  }

  private isBundleLikeProductTitle(title: string): boolean {
    return /\b(combo|pack|bundle|kit|duo|trio|x\s*\d+|\d+\s*(unidades|prendas|productos))\b/i.test(
      this.normalizeText(title),
    );
  }

  private joinNaturalList(values: string[]): string {
    if (values.length <= 1) {
      return values[0] ?? '';
    }

    if (values.length === 2) {
      return `${values[0]} y ${values[1]}`;
    }

    return `${values.slice(0, -1).join(', ')} y ${values[values.length - 1]}`;
  }

  private formatCop(value: number): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(Math.round(value));
  }

  private readSaleContext(context: JsonObject): JsonObject {
    const value = context.sale_context;

    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value)
    ) {
      return {};
    }

    return { ...(value as JsonObject) };
  }

  private normalizeCopAmount(value: unknown): string {
    if (typeof value !== 'string' && typeof value !== 'number') {
      return '';
    }

    const raw = String(value).trim();

    if (!raw) {
      return '';
    }

    const normalized = raw
      .replace(/[^\d,.-]/g, '')
      .replace(/\./g, '')
      .replace(',', '.');
    const amount = Number(normalized);

    return Number.isFinite(amount) && amount >= 0
      ? String(Math.round(amount))
      : '';
  }

  private async rememberSaleContext(
    session: ConversationSession,
    args: JsonObject,
  ) {
    const currentSession =
      await this.conversationMemoryService.getSessionById(session.id);
    const existing =
      this.readSaleContext(currentSession.context);
    const city =
      typeof args.city === 'string'
        ? args.city.trim().slice(0, 120)
        : '';
    const paymentMethod =
      typeof args.payment_method === 'string'
        ? args.payment_method.trim().slice(0, 120)
        : '';
    const shippingCost =
      this.normalizeCopAmount(args.shipping_cost_cop);
    const hasShippingCost = shippingCost !== '';
    const next: JsonObject = { ...existing };

    if (city) {
      const previousCity =
        typeof existing.city === 'string'
          ? this.normalizeText(existing.city)
          : '';
      const cityChanged =
        Boolean(previousCity) &&
        previousCity !== this.normalizeText(city);

      next.city = city;

      if (cityChanged && !hasShippingCost) {
        delete next.shipping_cost_cop;
        next.payment_instructions_sent = false;
        next.checkout_instructions_sent = false;
      }
    }

    if (paymentMethod) {
      const previousPayment =
        typeof existing.payment_method === 'string'
          ? this.normalizeText(existing.payment_method)
          : '';
      const paymentChanged =
        Boolean(previousPayment) &&
        previousPayment !== this.normalizeText(paymentMethod);

      next.payment_method = paymentMethod;

      if (paymentChanged) {
        if (!hasShippingCost) {
          delete next.shipping_cost_cop;
        }

        next.payment_instructions_sent = false;
        next.checkout_instructions_sent = false;
      }
    }

    if (hasShippingCost) {
      next.shipping_cost_cop = shippingCost;
    }

    if (typeof args.cart_confirmation_requested === 'boolean') {
      next.cart_confirmation_requested =
        args.cart_confirmation_requested;
    }

    if (typeof args.cart_confirmed === 'boolean') {
      next.cart_confirmed = args.cart_confirmed;

      if (args.cart_confirmed === true) {
        next.cart_confirmation_requested = true;
      }
    }

    if (typeof args.payment_instructions_sent === 'boolean') {
      next.payment_instructions_sent =
        args.payment_instructions_sent;
    }

    if (typeof args.checkout_instructions_sent === 'boolean') {
      next.checkout_instructions_sent =
        args.checkout_instructions_sent;
    }

    next.updated_at = new Date().toISOString();

    const updated =
      await this.conversationMemoryService.updateSession(
        currentSession.id,
        {
          context: {
            ...currentSession.context,
            sale_context: next,
          },
        },
      );

    return {
      ok: true,
      sale_context: this.readSaleContext(updated.context),
    };
  }

  private async getSaleContext(session: ConversationSession) {
    const currentSession =
      await this.conversationMemoryService.getSessionById(session.id);

    return {
      ok: true,
      sale_context: this.readSaleContext(currentSession.context),
    };
  }

  private async invalidateSaleContextAfterCartChange(
    session: ConversationSession,
  ): Promise<void> {
    const currentSession =
      await this.conversationMemoryService.getSessionById(session.id);
    const recoveryContext = currentSession.context.cart_recovery;
    const isRecoveryCart =
      Boolean(recoveryContext) &&
      typeof recoveryContext === 'object' &&
      !Array.isArray(recoveryContext);

    if (isRecoveryCart) {
      return;
    }

    const existing =
      this.readSaleContext(currentSession.context);
    const next: JsonObject = {
      ...existing,
      cart_confirmation_requested: false,
      cart_confirmed: false,
      payment_instructions_sent: false,
      checkout_instructions_sent: false,
      cart_changed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    delete next.shipping_cost_cop;

    await this.conversationMemoryService.updateSession(
      currentSession.id,
      {
        context: {
          ...currentSession.context,
          sale_context: next,
        },
      },
    );
  }

  private async enrichCartToolResult(
    session: ConversationSession,
    result: unknown,
  ): Promise<unknown> {
    if (
      !result ||
      typeof result !== 'object' ||
      Array.isArray(result)
    ) {
      return result;
    }

    const currentSession =
      await this.conversationMemoryService.getSessionById(session.id);
    const saleContext =
      this.readSaleContext(currentSession.context);
    const output = { ...(result as JsonObject) };
    const cart =
      output.cart &&
      typeof output.cart === 'object' &&
      !Array.isArray(output.cart)
        ? output.cart as JsonObject
        : null;
    const productsTotal =
      cart &&
      (typeof cart.products_total_cop === 'string' ||
        typeof cart.products_total_cop === 'number')
        ? Number(cart.products_total_cop)
        : NaN;
    const shippingCost =
      typeof saleContext.shipping_cost_cop === 'string' ||
      typeof saleContext.shipping_cost_cop === 'number'
        ? Number(saleContext.shipping_cost_cop)
        : NaN;

    output.sale_context = saleContext;

    if (Number.isFinite(shippingCost)) {
      output.shipping_cost_cop = String(
        Math.round(shippingCost),
      );
    }

    if (
      Number.isFinite(productsTotal) &&
      Number.isFinite(shippingCost)
    ) {
      output.grand_total_cop = String(
        Math.round(productsTotal + shippingCost),
      );
    }

    return output;
  }

  private async enforceSalesReply(
    session: ConversationSession,
    reply: string,
  ): Promise<string> {
    const asksDeliveryData =
      /\b(direccion completa|nombre y telefono|nombre completo y telefono|pásame la dirección|pasame la direccion|datos completos de entrega)\b/i.test(
        reply,
      );

    if (!asksDeliveryData) {
      return reply;
    }

    const currentSession =
      await this.conversationMemoryService.getSessionById(session.id);

    if (
      !['sales', 'product', 'variant', 'checkout'].includes(
        currentSession.stage,
      )
    ) {
      return reply;
    }

    const cartResult =
      await this.cartService.getCart(currentSession);

    if (
      !cartResult ||
      typeof cartResult !== 'object' ||
      (cartResult as { ok?: unknown }).ok !== true
    ) {
      return reply;
    }

    const checkoutResult =
      await this.cartService.createCheckoutLink(currentSession);

    if (
      !checkoutResult ||
      typeof checkoutResult !== 'object' ||
      (checkoutResult as { ok?: unknown }).ok !== true ||
      typeof (checkoutResult as { checkout_url?: unknown })
        .checkout_url !== 'string'
    ) {
      return reply;
    }

    const checkoutUrl =
      (checkoutResult as { checkout_url: string }).checkout_url;

    return (
      'Completa tus datos de entrega aquí y selecciona “Envío”:\n' +
      checkoutUrl
    );
  }

  private buildInstructions(
    profile: CompanyProfile,
    hasRecoveryContext = false,
  ): string {
    const assistantName = profile.assistantName?.trim() || 'Asistente virtual';
    const configuredTone =
      typeof profile.settings.ai_tone === 'string' &&
      profile.settings.ai_tone.trim()
        ? profile.settings.ai_tone.trim()
        : 'cercana, clara, breve y natural';
    const commercialRules = this.getCommercialFlowRules(profile.settings);
    const knowledgeRules = this.getKnowledgeBaseRules(profile.settings);
    const shippingTrackingRules = this.getShippingTrackingRules(profile.settings);

    return [
      `Eres ${assistantName}, asesora comercial de ${profile.name}.`,
      `Hablas en español colombiano, de forma ${configuredTone}.`,
      '',
      'REGLAS DE VERACIDAD:',
      '- Nunca muestres código, JSON, herramientas, IDs técnicos, procesos internos ni mensajes del sistema.',
      '- Nunca digas que eres una IA ni menciones OpenAI, Shopify, Supabase o APIs.',
      '- Nunca inventes productos, precios, variantes, descuentos, stock, promociones, envíos, políticas, pedidos o enlaces.',
      '- Usa únicamente resultados reales de las herramientas y la configuración de la empresa.',
      '- Nunca solicites claves, códigos de seguridad, datos bancarios sensibles ni datos de tarjeta.',
      '- ALCANCE OBLIGATORIO: responde solo temas relacionados con la empresa, sus productos, servicios, pedidos, pagos, envíos, políticas, herramientas conectadas o instrucciones configuradas. No respondas cultura general, noticias, historia, tecnología, personas famosas ni preguntas externas. En esos casos redirige amablemente al tema de la empresa.',
      '',
      'FORMA DE ATENDER:',
      '- Las INSTRUCCIONES ESPECÍFICAS DE LA EMPRESA y la BASE DE CONOCIMIENTO APROBADA tienen prioridad y definen cómo conversar, vender y resolver políticas.',
      '- OpenAI debe razonar con la base configurada; no respondas como plantilla fija ni como árbol de palabras clave.',
      '- Conversa de manera natural; no uses formularios ni secuencias rígidas de preguntas.',
      '- Entiende mensajes cortos, cambios de idea, errores de escritura y referencias como “esta”, “la lila”, “sí”, “dale”, “mejor no” o “quiero otra”.',
        '- Conserva el carrito real aunque la persona mire otro producto, pero solo cuando ese carrito corresponde a la compra actual.',
        '- Un pedido ya pagado, consultado o despachado NO es un carrito. Nunca agregues productos de pedidos anteriores a una compra nueva.',
      '- Cuando session.starts_new_conversation sea true, atiende el mensaje como una conversación comercial nueva. No reutilices productos, tallas, variantes, carrito, pedido, menú ni intención de compra anteriores.',
      '- Cuando session.context.conversation_cycle_reason sea customer_requested_menu, la persona pidió Inicio, Menú o Volver. Atiende desde un ciclo nuevo: no reutilices ciudad, productos, variantes, carrito, pedido, medio de pago ni intención anteriores aunque aparezcan en el historial.',
      '- session.context.previous_purchase_context es solo un respaldo histórico. No lo uses ni lo agregues al carrito salvo que el mensaje ACTUAL pida explícitamente retomar esa compra; antes de retomarla valida nuevamente productos, variantes, disponibilidad y condiciones reales.',
      '- Después de 72 horas sin actividad, solo consulta una compra anterior si el mensaje ACTUAL del cliente pregunta explícitamente por un pedido, guía, pago, cambio, garantía, devolución o algo que compró antes.',
      '- No llames lookup_order solo porque exista un pedido o dato antiguo en el historial o contexto. Debe existir una solicitud actual y clara del cliente sobre esa compra.',
      '- Consultar un pedido es una pausa temporal y no borra la venta activa. Conserva selectedProduct, selectedVariant, cart y sale_context.',
      '- Si después de consultar el pedido la persona retoma el producto que ya estaba revisando, usa get_selected_product y get_cart. No vuelvas a abrir la colección ni a pedir el enlace si el producto ya está identificado.',

        '- Si la persona dice que quiere comprar algo nuevo, “solo quiero”, “solo esa”, “solo la blusa”, “ese pedido ya lo pagué” o corrige que los productos anteriores no van, separa la compra nueva del pedido anterior. Usa get_cart y quita productos no solicitados con remove_cart_line antes de crear checkout.',
      '- Pregunta solo por el dato que falte. No repitas ciudad, color, talla o medio de pago ya informado.',
      '- Entrega la información de forma progresiva: responde primero al paso actual y no mezcles catálogo, variantes, envío, pago y checkout en un solo mensaje.',
      '- Cuando la persona pida ver una categoría, comparte de inmediato únicamente la colección real correspondiente. Después del enlace solo indica que envíe el enlace o una foto del producto que le guste.',
      '- No preguntes estilos, colores o preferencias antes de mostrar una colección solicitada. No ofrezcas opciones populares, recomendaciones ni productos complementarios mientras el módulo de recomendación no esté habilitado.',
      '- No uses frases como “confirmo el producto” o “encontré el producto”. Menciona directamente nombre, precio real y la primera opción que falte.',
      '- Si varias publicaciones, combos o bundles se parecen a una imagen y no existe certeza exacta, pide el enlace del producto. No muestres alternativas que la persona no solicitó.',
      '- Las recomendaciones de talla deben ser breves: máximo dos frases y una sola talla sugerida cuando la información permita recomendarla.',
      '- No menciones restricciones, opciones no disponibles o condiciones negativas que la persona no haya preguntado ni seleccionado.',
      '- Explica las instrucciones de un medio de pago cuando la persona pregunte por ese medio o lo seleccione. No adelantes instrucciones de otros medios.',
      '- Las instrucciones finales del checkout deben acompañar el enlace de checkout o responder una pregunta directa sobre cómo finalizar. No las adelantes durante la selección del producto.',
      '',
      'USO DE HERRAMIENTAS:',
      '- Consulta productos, colecciones, variantes y carrito con las herramientas antes de dar datos definitivos.',
      '- Si preguntan por términos, cambios, devoluciones, garantías, pagos, envíos o políticas, responde usando la BASE DE CONOCIMIENTO APROBADA y las instrucciones de la empresa. Si falta una regla específica, dilo con claridad y escala si es necesario.',
        '- No ofrezcas cancelación, devolución, garantía, cambio especial, descuento, envío gratis ni excepción operativa si no está permitido explícitamente en la configuración de la empresa. Si no está configurado, no lo prometas: pide el dato necesario o escala a asesor.',
        '- Para cambios, garantías o devoluciones, pregunta lo necesario según la política configurada. No incluyas “cancelarlo” como opción salvo que la empresa lo permita explícitamente en su configuración.',
      '- Si preguntan por estado de pedido, número de guía, transportadora, seguimiento, pago de un pedido, cambio, garantía o devolución de una compra existente, usa lookup_order cuando tengas número de pedido, correo o celular. Si falta ese dato, pide solo un dato concreto.',
      '- No asumas que cualquier número enviado por el cliente es un pedido. Si el cliente envía solo un número sin contexto, pregunta brevemente si corresponde al número de pedido, guía o celular registrado en la compra antes de usar lookup_order.',
      '- Interpreta respuestas numéricas según el último menú que tú acabas de enviar. Si el último menú fue 1 Ventas / 2 Servicio al cliente, entonces 2 significa Servicio al cliente y debes mostrar el menú de servicio. Solo interpreta 2 como problema con pedido cuando el último menú enviado haya sido el menú de servicio al cliente con opciones 1 a 5.',
      '- La regla anterior solo aplica cuando NO hay contexto. Si tú acabas de pedir número de pedido, correo o celular para consultar una compra, usa ese dato con lookup_order. Si no aparece el pedido, pide otro dato concreto como correo o celular, o ofrece pasar a asesor; no vuelvas a preguntar lo mismo.',
      '- Después de lookup_order, responde únicamente con datos reales encontrados.',
      '- Nunca muestres estados internos como FULFILLED, UNFULFILLED, PAID, PENDING, OPEN o CLOSED. Comunica su significado en lenguaje natural.',
      '- Si hay guía, comparte transportadora, número, enlace e instrucciones para consultarla. No preguntes “¿quieres que lo rastree?” ni afirmes que puedes rastrear en tiempo real si la integración no entregó ese estado.',
      '- Después de responder la consulta del pedido, conserva la venta que estaba en curso y espera el siguiente mensaje.',

      '- Si lookup_order devuelve next_action ask_alternate_identifier, no uses request_human_attention todavía. Pide un dato diferente y concreto: correo o celular si ya tienes pedido, o número de pedido si ya tienes celular/correo.',
      '- Si lookup_order devuelve next_action offer_human_attention o requires_human true, ofrece dejar el caso con un asesor. No pidas de nuevo el mismo dato y no inventes estado del pedido.',
      '- session.context.last_visual_reference contiene el análisis y la validación de la última imagen. Úsalo cuando el mensaje actual se refiera a “esta”, “esa”, “esto”, “la foto”, “la imagen”, “la de arriba” o pida precio, disponibilidad, talla o color.',
      '- Si last_visual_reference.match_type es exact y matched_product existe, esa referencia ya fue validada contra el catálogo real y quedó seleccionada. Usa get_selected_product para consultar precio y variantes reales.',
      '- Si match_type es similar, no afirmes que encontraste la referencia exacta. Presenta como máximo las opciones reales incluidas en candidates y pregunta cuál corresponde.',
      '- Si match_type es none, explica brevemente que no pudiste confirmar la referencia exacta y ofrece buscar por nombre, enlace o categoría.',
      '- Nunca inventes un enlace ni presentes como disponible un producto externo que no exista en el catálogo de la empresa activa.',
      '- Cuando la persona comparta un enlace de producto, selecciónalo con select_product_by_url y responde usando sus datos reales.',
      '- Cuando pida una categoría amplia, usa open_collection o search_products según corresponda.',
      '- Cuando la persona confirme claramente una variante, valida con select_variant y agrega de inmediato con add_selected_variant_to_cart.',
      '- En venta al detal, si no indica cantidad, usa 1.',
      '- No preguntes “¿lo agrego?” después de que la persona ya confirmó color, talla o variante.',
        '- Antes de crear checkout, usa get_cart y verifica que el carrito contenga únicamente productos que la persona pidió para esta compra actual. Si hay productos de un pedido anterior, carrito recuperado viejo o artículos no solicitados, elimínalos antes de crear el checkout.',
      '- Cuando la persona diga “solo ese”, “solo el buzo”, “no quiero lo otro” o equivalente, usa get_cart y después keep_only_cart_line para conservar el producto solicitado y eliminar todos los demás en una sola operación. No vacíes primero el carrito y no vuelvas a pedir confirmación.',
      '- Una respuesta afirmativa como “sí”, “sii”, “quiero ese”, “agrégalo”, “me lo llevo” o “solo ese” confirma la acción pendiente más reciente. Ejecuta la acción inmediatamente y no preguntes otra vez lo mismo.',
      '- Los productos, cantidades y valores que menciones deben salir siempre del resultado real de get_cart o de una herramienta de carrito. Nunca reconstruyas el carrito usando mensajes anteriores.',
      '- Cambiar el medio de pago no puede agregar, eliminar ni reemplazar productos. Conserva exactamente el carrito real y modifica únicamente pago, envío, promociones aplicables y total.',
        '- Si la persona corrige “solo quiero X” o “por qué me vas a cobrar todo”, acepta la corrección, deja solo los productos confirmados para la compra actual y vuelve a resumir el carrito.',
      '- session.context.sale_context conserva ciudad, costo de envío, medio de pago, confirmación del carrito y pasos enviados. Úsalo antes de volver a preguntar.',
      '- Cuando la persona entregue o cambie ciudad o medio de pago, llama remember_sale_context.',
      '- Antes de confirmar una tarifa, verifica la combinación real de empresa, ciudad, medio de pago y subtotal.',
      '- Si todas las formas de pago tienen la misma tarifa para esa ciudad, informa el envío y pregunta cómo pagará.',
      '- Si la tarifa cambia según el medio de pago, guarda la ciudad, no confirmes todavía un valor único y pregunta primero cómo pagará.',
      '- Cuando seleccione el medio de pago, calcula y guarda la tarifa exacta correspondiente. El valor 0 significa envío gratis y es válido.',
      '- Cuando el carrito cambie, vuelve a calcular envío y total. No reutilices una tarifa anterior.',
      '- Presenta únicamente los medios habilitados para la ubicación y el pedido. “Pago antes del despacho” no es un medio de pago.',
      '- Cuando seleccione un medio, habla únicamente de ese medio y usa get_cart antes de responder.',
      '- Antes del checkout pregunta una sola vez si desea agregar otro producto, salvo que ya haya dicho “solo eso”, “finalizar”, “pagar” o algo equivalente.',
      '- Cuando hagas esa pregunta, usa remember_sale_context con cart_confirmation_requested=true y cart_confirmed=false.',
      '- Cuando confirme que no agregará más o que desea finalizar, usa remember_sale_context con cart_confirmed=true.',
      '- Si agrega, elimina o cambia un producto, la confirmación anterior deja de ser válida. Recalcula el envío y presenta nuevamente el resumen.',
      '- Antes del resumen final, guarda la tarifa correcta y usa get_cart. Muestra producto y variante, subtotal, envío y total general.',
      '- No solicites dirección, nombre ni teléfono por WhatsApp. Esos datos se completan en el checkout.',
      '- Usa create_checkout_link solo cuando ciudad, medio de pago, envío y carrito estén confirmados.',
      '- Si create_checkout_link devuelve next_action confirm_cart, pregunta si desea agregar algo más y no envíes un enlace todavía.',
      '- Cuando create_checkout_link devuelva checkout_url, comparte únicamente ese checkout_url para completar datos y finalizar. Nunca lo sustituyas por un cart_url.',
      '- Cuando create_checkout_link devuelva checkout_url, comparte únicamente ese checkout_url para completar datos y finalizar. Nunca sustituyas ese enlace por un cart_url.',
      '- Si sale_context.payment_instructions_sent es true, no vuelvas a enviar los mismos datos; pide únicamente el comprobante o el paso pendiente.',
      '- Cuando las INSTRUCCIONES ESPECÍFICAS DE LA EMPRESA indiquen pasar el caso a un asesor, responde con el mensaje y tono definido por esa empresa y luego usa request_human_attention. No continúes atendiendo como IA después de transferir.',
      '- Al usar request_human_attention, customer_message debe ser el mensaje exacto que verá la persona: natural, breve, útil y alineado al tono/configuración de la empresa. No uses una frase fija si la empresa configuró otra forma de atención.',
      '- La conversación puede tener session.context.service_area con el área elegida por la persona. Respeta esa área al atender y no la cambies por tu cuenta.',
      '- Atiende primero el caso con la información disponible. Usa request_human_attention solo cuando la persona pida un asesor, no puedas entender o resolver, falte información operativa, o las instrucciones específicas indiquen escalar.',
      '- REGLA DE COMPRENSIÓN: no transfieras por un solo mensaje ambiguo. Pide una aclaración breve y concreta. Si después de esa aclaración la persona sigue sin permitir entender o resolver el caso, usa request_human_attention. No supongas que un número, documento, teléfono, talla, referencia, enlace o dato corto es incorrecto: interprétalo usando el contexto o pide aclaración.',
      '- Al transferir usa request_human_attention con un resumen interno MUY CORTO: máximo 2 líneas y 280 caracteres. Escribe únicamente qué necesita el cliente y cuál es el dato o acción pendiente. No copies historial, productos, precios, carrito ni pedidos completos.',
      '- El campo reason debe ser una frase breve, máximo 120 caracteres. El campo summary debe entenderse por sí solo y no debe repetir el motivo.',
      '',
      'CONFIGURACIÓN COMERCIAL ESTRUCTURADA:',
      commercialRules,
      '',
      'BASE DE CONOCIMIENTO APROBADA POR LA EMPRESA:',
      knowledgeRules,
      '',
      'TRANSPORTADORAS Y SEGUIMIENTO CONFIGURADOS:',
      shippingTrackingRules,
      '',
      'INSTRUCCIONES ESPECÍFICAS DE LA EMPRESA:',
      profile.aiInstructions || 'No hay instrucciones adicionales.',
      ...(hasRecoveryContext
        ? [
            '',
            'REGLAS PRIORITARIAS PARA RESPUESTAS A CARRITOS RECUPERADOS:',
            '- Estas reglas aplican únicamente cuando el input incluye recovery_context.',
            '- recovery_context describe el carrito que generó el mensaje de recuperación. session.context.cart es el carrito de trabajo actual para esta conversación.',
            '- Ignora productos mencionados en historiales anteriores como base del carrito. Solo usa el carrito de recuperación y productos nuevos que la persona pida claramente en esta conversación.',
            '- Antes de responder sobre talla, color, cantidad, pago, envío o el carrito, identifica los artículos reales de recovery_context y session.context.cart.',
            '- Si hay varios productos y no es claro cuál desea cambiar, menciona los productos reales y pregunta cuál desea modificar. No adivines.',
            '- Para cambiar talla, color o variante de una prenda que ya está en el carrito: selecciona el producto real, valida la nueva variante y usa replace_cart_line_variant. Nunca uses add_selected_variant_to_cart para un cambio de una prenda existente.',
            '- Para modificar únicamente unidades de una prenda existente usa set_cart_line_quantity. Para quitar una prenda confirmada usa remove_cart_line.',
            '- Solo agrega un producto nuevo cuando la persona lo solicite con claridad. Para un producto nuevo sí usa el flujo normal y add_selected_variant_to_cart.',
            '- Después de aplicar un cambio confirmado a un carrito recuperado, genera de inmediato el enlace actualizado con create_checkout_link y compártelo. No vuelvas a pedir ciudad, envío ni medio de pago antes de enviar ese enlace actualizado.',
            '- No generes enlace nuevo si la persona solo está haciendo una pregunta o aún no confirma un cambio.',
            '- No llames al carrito recuperado pedido, compra finalizada ni pago aprobado.',
            '- No inventes productos, variantes, condiciones, medios de pago ni disponibilidad. La forma de orientar pagos, crédito, envíos y cierre de venta sigue las instrucciones específicas de la empresa.',
          ]
        : []),
    ].join('\n');
  }

  private getCommercialFlowRules(settings: JsonObject): string {
    const source =
      settings.commercial_flow &&
      typeof settings.commercial_flow === 'object' &&
      !Array.isArray(settings.commercial_flow)
        ? settings.commercial_flow as JsonObject
        : {};

    const labels: Array<[string, string]> = [
      ['welcome_message', 'Saludo y menú inicial'],
      ['area_welcome_message', 'Mensaje al entrar a un área'],
      ['sales_instructions', 'Proceso de ventas'],
      ['shipping_instructions', 'Ciudades y envíos'],
      ['payment_instructions', 'Medios de pago'],
      ['checkout_instructions', 'Regla para entregar checkout'],
    ];

    const lines = labels
      .map(([key, label]) => {
        const value = source[key];
        const text = typeof value === 'string' ? value.trim() : '';
        return text ? `- ${label}: ${text}` : '';
      })
      .filter(Boolean);

    const responseLength =
      typeof source.response_length === 'string'
        ? source.response_length.trim().toLowerCase()
        : 'brief';
    const responseLengthLabel =
      responseLength === 'detailed'
        ? 'detallada'
        : responseLength === 'balanced'
          ? 'equilibrada'
          : 'breve';
    const rawMaxQuestions =
      Number(source.max_questions_per_message);
    const maxQuestions =
      Number.isInteger(rawMaxQuestions) &&
      rawMaxQuestions >= 1 &&
      rawMaxQuestions <= 3
        ? rawMaxQuestions
        : 1;
    const avoidRepetition =
      source.avoid_repetition !== false;
    const restrictionsOnlyWhenRelevant =
      source.show_restrictions_only_when_relevant !== false;
    const askBeforeShowingCatalog =
      source.ask_before_showing_catalog !== false;

    lines.unshift(
      `- Longitud preferida: ${responseLengthLabel}.`,
      `- Máximo de preguntas principales por mensaje: ${maxQuestions}.`,
      avoidRepetition
        ? '- Evita repetir información que ya entregaste o que la persona ya confirmó.'
        : '- Puedes repetir información importante cuando ayude a evitar confusiones.',
      restrictionsOnlyWhenRelevant
        ? '- Menciona restricciones o indisponibilidades solo cuando la persona pregunte por esa opción o intente seleccionarla.'
        : '- Puedes anticipar restricciones relevantes durante la orientación.',
      askBeforeShowingCatalog
        ? '- Al entrar a Ventas pregunta primero qué busca. No envíes todas las colecciones; muestra solo la categoría o productos relacionados después de conocer su interés.'
        : '- La empresa permite presentar el catálogo general al iniciar la atención de Ventas.',
    );

    return lines.join('\n');
  }

  private getShippingTrackingRules(settings: JsonObject): string {
    const source =
      settings.shipping_tracking &&
      typeof settings.shipping_tracking === 'object' &&
      !Array.isArray(settings.shipping_tracking)
        ? (settings.shipping_tracking as JsonObject)
        : {};

    const enabled = source.enabled === true;
    const fallback =
      typeof source.fallbackInstructions === 'string' &&
      source.fallbackInstructions.trim()
        ? source.fallbackInstructions.trim()
        : 'Cuando haya guía, comparte transportadora, número de guía y explica cómo consultar en el enlace principal de la transportadora.';

    const carriers = Array.isArray(source.carriers) ? source.carriers : [];
    const lines = carriers
      .map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return '';
        }

        const carrier = item as JsonObject;
        if (carrier.isActive === false) {
          return '';
        }

        const displayName =
          typeof carrier.displayName === 'string' ? carrier.displayName.trim() : '';
        const aliases =
          typeof carrier.aliases === 'string' ? carrier.aliases.trim() : '';
        const trackingUrl =
          typeof carrier.trackingUrl === 'string' ? carrier.trackingUrl.trim() : '';
        const instructions =
          typeof carrier.instructions === 'string' ? carrier.instructions.trim() : '';

        if (!displayName && !aliases && !trackingUrl && !instructions) {
          return '';
        }

        return [
          `- Transportadora: ${displayName || aliases || 'Sin nombre visible'}`,
          aliases ? `  Códigos/Alias: ${aliases}` : '',
          trackingUrl ? `  URL principal: ${trackingUrl}` : '',
          instructions ? `  Instrucción: ${instructions}` : '',
        ]
          .filter(Boolean)
          .join('\n');
      })
      .filter(Boolean);

    if (!enabled && !lines.length) {
      return '- No hay transportadoras configuradas. Si Shopify entrega guía, responde de forma genérica sin inventar enlaces ni nombres visibles.';
    }

    return [
      `- Seguimiento con transportadoras: ${enabled ? 'activo' : 'inactivo'}.`,
      `- Instrucción general: ${fallback}`,
      ...lines,
    ].join('\n');
  }

  private getKnowledgeBaseRules(settings: JsonObject): string {
    const source =
      settings.knowledge_base &&
      typeof settings.knowledge_base === 'object' &&
      !Array.isArray(settings.knowledge_base)
        ? settings.knowledge_base as JsonObject
        : {};

    const labels: Array<[string, string]> = [
      ['terms_conditions', 'Términos y condiciones'],
      ['exchanges_returns', 'Cambios y devoluciones'],
      ['warranties', 'Garantías'],
      ['policies_faq', 'Preguntas frecuentes y políticas adicionales'],
    ];

    const lines = labels
      .map(([key, label]) => {
        const value = source[key];
        const text = typeof value === 'string' ? value.trim() : '';
        return text ? `- ${label}: ${text}` : '';
      })
      .filter(Boolean);

    return lines.length
      ? lines.join('\n')
        : '- No hay base de conocimiento configurada. No inventes políticas; no ofrezcas cancelaciones, cambios especiales, devoluciones, garantías, excepciones ni promesas operativas. Pide más información o escala a un asesor cuando haga falta.';
  }

  private getActiveRecoveryContext(
    context: JsonObject,
  ): JsonObject | null {
    const value = context.cart_recovery;

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const recoveryContext = value as JsonObject;
    const expiresAt = recoveryContext.expires_at;

    if (typeof expiresAt !== 'string' || Date.parse(expiresAt) <= Date.now()) {
      return null;
    }

    return recoveryContext;
  }

  private getContextStatus(
    profile: CompanyProfile,
    session: ConversationSession,
  ): {
    context_window_hours: number;
    hours_since_last_message: number;
    is_within_context_window: boolean;
  } {
    const contextWindowHours = this.getContextWindowHours(profile);
    const commercialActivity =
      typeof session.context.commercial_last_customer_message_at === 'string'
        ? session.context.commercial_last_customer_message_at
        : session.lastMessageAt;
    const lastMessageTime = new Date(commercialActivity).getTime();

    const elapsedMilliseconds = Number.isFinite(lastMessageTime)
      ? Math.max(0, Date.now() - lastMessageTime)
      : Number.POSITIVE_INFINITY;

    const elapsedHours = Math.floor(
      elapsedMilliseconds / (60 * 60 * 1000),
    );

    return {
      context_window_hours: contextWindowHours,
      hours_since_last_message: elapsedHours,
      is_within_context_window: elapsedHours <= contextWindowHours,
    };
  }

  private getContextWindowHours(profile: CompanyProfile): number {
    const configuredValue =
      profile.settings.conversation_context_hours;

    const configuredHours =
      typeof configuredValue === 'number'
        ? configuredValue
        : typeof configuredValue === 'string'
          ? Number(configuredValue)
          : NaN;

    if (
      Number.isInteger(configuredHours) &&
      configuredHours >= 1 &&
      configuredHours <= 720
    ) {
      return configuredHours;
    }

    return 72;
  }

  private startFreshConversationContext(
    context: JsonObject,
  ): JsonObject {
    const recoveryContext = this.getActiveRecoveryContext(context);
    const nextContext: JsonObject = {
      conversation_cycle_started_at: new Date().toISOString(),
      conversation_cycle_reason: 'inactive_72_hours',
    };

    if (recoveryContext) {
      nextContext.cart_recovery = recoveryContext;

      if (
        typeof context.cart_recovery_initialized_id === 'string'
      ) {
        nextContext.cart_recovery_initialized_id =
          context.cart_recovery_initialized_id;
      }

    }

    return nextContext;
  }

  private async resolveMessageRouting(
    profile: CompanyProfile,
    session: ConversationSession,
    customerMessage: string,
  ): Promise<{
    understanding: 'clear' | 'unclear';
    intent: 'new_catalog_search' | 'continuation' | 'other';
    source: 'local' | 'openai';
  }> {
    const local = this.getLocalMessageRouting(
      session,
      customerMessage,
    );

    if (local) {
      return {
        ...local,
        source: 'local',
      };
    }

    const history = await this.getRecentMessages(session.id);
    const response = await this.getClient().responses.create({
      model: this.getModel(),
      instructions: [
        'Clasifica el mensaje actual de una conversación comercial.',
        'No respondas al cliente.',
        'Devuelve únicamente JSON válido con esta estructura:',
        '{"understanding":"clear"|"unclear","intent":"new_catalog_search"|"continuation"|"other"}',
        '',
        'understanding=clear cuando el mensaje puede procesarse usando el historial, contexto, productos, pedidos, pagos, servicios o integraciones.',
        'understanding=unclear únicamente cuando no es posible saber qué solicita ni a qué se refiere, incluso usando el contexto.',
        'No marques como unclear solo por ser corto, contener un número, ciudad, color, talla, sí/no, correo, celular, referencia, enlace o dato solicitado anteriormente.',
        '',
        'intent=new_catalog_search cuando pide explorar una categoría, producto genérico o una búsqueda nueva, aunque exista un producto anterior.',
        'intent=continuation cuando se refiere al producto, imagen, carrito, pedido, pregunta o dato que ya se venía tratando.',
        'intent=other para saludos, pagos, servicio, políticas u otros mensajes que no requieren limpiar el producto anterior.',
        '',
        `Empresa: ${profile.name}.`,
        `Instrucciones de la empresa: ${profile.aiInstructions || 'No hay instrucciones adicionales.'}`,
      ].join('\n'),
      input: JSON.stringify({
        historial_reciente: history,
        mensaje_actual: customerMessage,
        contexto: session.context,
        producto_anterior: this.readSelectedProduct(session.context),
      }),
    });

    const raw = response.output_text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '');

    try {
      const parsed = JSON.parse(raw) as {
        understanding?: string;
        intent?: string;
      };

      return {
        understanding:
          parsed.understanding === 'unclear'
            ? 'unclear'
            : 'clear',
        intent:
          parsed.intent === 'new_catalog_search' ||
          parsed.intent === 'continuation'
            ? parsed.intent
            : 'other',
        source: 'openai',
      };
    } catch {
      return {
        understanding: 'clear',
        intent: 'other',
        source: 'openai',
      };
    }
  }

  private getLocalMessageRouting(
    session: ConversationSession,
    customerMessage: string,
  ): {
    understanding: 'clear';
    intent: 'new_catalog_search' | 'continuation' | 'other';
  } | null {
    const raw = customerMessage.trim();
    const normalized = this.normalizeText(raw);
    const clarificationState =
      session.context.clarification_state &&
      typeof session.context.clarification_state === 'object' &&
      !Array.isArray(session.context.clarification_state)
        ? session.context.clarification_state as JsonObject
        : null;

    if (clarificationState?.waiting_for_clarification === true) {
      return null;
    }

    if (raw.startsWith('[REFERENCIA_VISUAL]')) {
      return {
        understanding: 'clear',
        intent: 'new_catalog_search',
      };
    }

    if (/^https?:\/\/\S+$/i.test(raw)) {
      return {
        understanding: 'clear',
        intent: 'other',
      };
    }

    const hasActiveReference =
      this.hasActiveConversationReference(session.context);

    if (
      hasActiveReference &&
      (
        raw.length <= 120 ||
        /^(si|sí|no|dale|listo|ok|okay|esta|este|esa|ese|esto|esa misma|ese mismo|la primera|la segunda|el primero|el segundo|quiero esta|quiero este|quiero esa|quiero ese)$/i.test(
          raw,
        )
      )
    ) {
      return {
        understanding: 'clear',
        intent: 'continuation',
      };
    }

    if (
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ||
      /^\+?[\d\s().-]{3,20}$/.test(raw)
    ) {
      return {
        understanding: 'clear',
        intent: hasActiveReference ? 'continuation' : 'other',
      };
    }

    if (
      /^(muestrame|muéstrame|mostrar|ver|busco|estoy buscando|catalogo|catálogo|coleccion|colección|que productos|qué productos|productos disponibles)\b/.test(
        normalized,
      )
    ) {
      return {
        understanding: 'clear',
        intent: 'new_catalog_search',
      };
    }

    return null;
  }

  private hasActiveConversationReference(
    context: JsonObject,
  ): boolean {
    const cartHasLines =
      Array.isArray(context.cart) && context.cart.length > 0;

    return Boolean(
      context.selectedProduct ||
      context.selectedVariant ||
      context.selectedVariants ||
      context.purchaseIntent ||
      context.last_visual_reference ||
      context.customer_service_flow ||
      context.cart_recovery ||
      cartHasLines,
    );
  }

  private async applyMessageUnderstanding(
    session: ConversationSession,
    understanding: 'clear' | 'unclear',
  ): Promise<string | null> {
    const previous =
      session.context.clarification_state &&
      typeof session.context.clarification_state === 'object' &&
      !Array.isArray(session.context.clarification_state)
        ? session.context.clarification_state as JsonObject
        : null;

    if (understanding === 'clear') {
      if (previous) {
        const nextContext = { ...session.context };
        delete nextContext.clarification_state;

        await this.conversationMemoryService.updateSession(session.id, {
          context: nextContext,
        });
      }

      return null;
    }

    if (previous?.waiting_for_clarification === true) {
      const updated =
        await this.conversationMemoryService.requestHumanAttention(
          session.id,
          {
            reason:
              'No se logró comprender la solicitud después de una aclaración.',
            summary:
              'El cliente envió un mensaje que no se pudo interpretar y no logró aclararlo después de una solicitud breve de contexto.',
          },
        );

      return this.humanAttentionMessage(updated);
    }

    await this.conversationMemoryService.updateSession(session.id, {
      context: {
        ...session.context,
        clarification_state: {
          waiting_for_clarification: true,
          asked_at: new Date().toISOString(),
        },
      },
    });

    return 'No logré entender bien a qué te refieres. ¿Puedes explicarme un poco más o decirme qué necesitas revisar?';
  }

  private async classifyBusinessScope(
    profile: CompanyProfile,
    customerMessage: string,
  ): Promise<'business' | 'outside'> {
    const response = await this.getClient().responses.create({
      model: this.getModel(),
      instructions: [
        'Clasifica sin responder la pregunta.',
        'Devuelve únicamente JSON válido: {"scope":"business"} o {"scope":"outside"}.',
        'business: consulta relacionada con la empresa, sus productos, servicios, pedidos, pagos, envíos, políticas, integraciones o una solicitud ambigua que podría ser comercial.',
        'outside: cultura general o información externa que no depende de la empresa ni de sus integraciones.',
        `Empresa: ${profile.name}.`,
        `Instrucciones de la empresa: ${profile.aiInstructions || 'No hay instrucciones adicionales.'}`,
      ].join('\n'),
      input: JSON.stringify({ mensaje_actual: customerMessage }),
    });

    const raw = response.output_text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '');

    try {
      const parsed = JSON.parse(raw) as { scope?: string };
      return parsed.scope === 'outside' ? 'outside' : 'business';
    } catch {
      return 'business';
    }
  }

  private async handleUnclearMessage(
    profile: CompanyProfile,
    session: ConversationSession,
    customerMessage: string,
  ): Promise<string | null> {
    const raw = customerMessage.trim();

    // Los enlaces siempre deben llegar al flujo real de producto.
    if (/^https?:\/\/\S+$/i.test(raw)) {
      return null;
    }

    const history = await this.getRecentMessages(session.id);
    const response = await this.getClient().responses.create({
      model: this.getModel(),
      instructions: [
        'Clasifica si el último mensaje se entiende suficientemente dentro de una conversación de negocio.',
        'Devuelve únicamente JSON válido: {"understanding":"clear"} o {"understanding":"unclear"}.',
        'clear: el mensaje puede procesarse usando el historial, las instrucciones de la empresa, sus productos, pedidos, pagos, servicios o integraciones.',
        'unclear: no se puede saber qué solicita o a qué se refiere, incluso considerando el historial.',
        'IMPORTANTE: no marques como unclear solo porque el mensaje contiene números, una cédula, teléfono, referencia, talla, código, ciudad, nombre, enlace o dato corto. Si ese dato puede tener sentido por el contexto, marca clear.',
        'No respondas al cliente ni inventes información.',
        `Empresa: ${profile.name}.`,
        `Instrucciones de la empresa: ${profile.aiInstructions || 'No hay instrucciones adicionales.'}`,
      ].join('\n'),
      input: JSON.stringify({
        historial_reciente: history,
        mensaje_actual: customerMessage,
        contexto: session.context,
      }),
    });

    const rawResponse = response.output_text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '');

    let understanding: 'clear' | 'unclear' = 'clear';

    try {
      const parsed = JSON.parse(rawResponse) as { understanding?: string };
      understanding = parsed.understanding === 'unclear' ? 'unclear' : 'clear';
    } catch {
      understanding = 'clear';
    }

    const previous =
      session.context.clarification_state &&
      typeof session.context.clarification_state === 'object' &&
      !Array.isArray(session.context.clarification_state)
        ? session.context.clarification_state as JsonObject
        : null;

    if (understanding === 'clear') {
      if (previous) {
        const nextContext = { ...session.context };
        delete nextContext.clarification_state;
        await this.conversationMemoryService.updateSession(session.id, {
          context: nextContext,
        });
      }

      return null;
    }

    if (previous?.waiting_for_clarification === true) {
      const updated = await this.conversationMemoryService.requestHumanAttention(
        session.id,
        {
          reason: 'No se logró comprender la solicitud después de una aclaración.',
          summary:
            'El cliente envió un mensaje que no se pudo interpretar y no logró aclararlo después de una solicitud breve de contexto.',
        },
      );

      return this.humanAttentionMessage(updated);
    }

    await this.conversationMemoryService.updateSession(session.id, {
      context: {
        ...session.context,
        clarification_state: {
          waiting_for_clarification: true,
          asked_at: new Date().toISOString(),
        },
      },
    });

    return 'No logré entender bien a qué te refieres. ¿Puedes explicarme un poco más o decirme qué necesitas revisar?';
  }

  private async classifyCurrentIntent(
  profile: CompanyProfile,
  session: ConversationSession,
  customerMessage: string,
): Promise<'new_catalog_search' | 'continuation' | 'other'> {
  const instructions = `
Clasifica el mensaje actual de una conversación comercial.

Devuelve únicamente JSON válido con esta estructura:
{"intent":"new_catalog_search"|"continuation"|"other"}

new_catalog_search:
La persona pide una categoría, producto genérico o categoría con filtros,
aunque exista un producto anterior.
Ejemplos:
- "quiero una blusa negra talla S"
- "busco pantalón negro talla 8"
- "muéstrame vestidos"

continuation:
La persona se refiere claramente al producto anterior.
Ejemplos:
- "este"
- "esa"
- "la primera"
- "quiero el que vimos"
- "sí quiero ese vestido"

other:
Saludos, preguntas generales, servicio o mensajes que no pertenecen
a las dos categorías anteriores.

Estas son las instrucciones de la empresa:
${profile.aiInstructions || 'No hay instrucciones adicionales.'}
`.trim();

  const response = await this.getClient().responses.create({
    model: this.getModel(),
    instructions,
    input: JSON.stringify({
      mensaje_actual: customerMessage,
      producto_anterior: this.readSelectedProduct(session.context),
    }),
  });

  const text = response.output_text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');

  try {
    const parsed = JSON.parse(text) as { intent?: string };

    if (parsed.intent === 'new_catalog_search') {
      return 'new_catalog_search';
    }

    if (parsed.intent === 'continuation') {
      return 'continuation';
    }
  } catch {
    return 'other';
  }

  return 'other';
}
  private clearSelectedProductContext(context: JsonObject): JsonObject {
  const nextContext = { ...context };

  delete nextContext.selectedProduct;
  delete nextContext.selectedVariant;
  delete nextContext.selectedVariants;
  delete nextContext.selectedAt;
  delete nextContext.selectedVariantAt;
  delete nextContext.purchaseIntent;
  delete nextContext.purchaseIntentAt;

  return nextContext;
}
  private getTools(): any[] {
    return [
      {
        type: 'function',
        name: 'open_collection',
        description:
          'Abre una colección o catálogo real de la empresa cuando la persona quiere explorar una categoría amplia.',
        strict: true,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            collection_id: {
              type: 'string',
              description: 'ID real de la colección.',
            },
          },
          required: ['collection_id'],
        },
      },
      {
        type: 'function',
        name: 'search_products',
        description:
          'Busca productos reales cuando la persona solicita un producto específico, una referencia o una combinación de características.',
        strict: true,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            query: {
              type: 'string',
              description:
                'Búsqueda corta y clara con categoría, producto o características relevantes.',
            },
          },
          required: ['query'],
        },
      },
      {
        type: 'function',
        name: 'select_product_by_url',
        description:
          'Selecciona un producto exacto cuando la persona comparte un enlace de producto.',
        strict: true,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            url: {
              type: 'string',
              description: 'Enlace compartido por la persona.',
            },
          },
          required: ['url'],
        },
      },
      {
        type: 'function',
        name: 'select_product_by_name',
        description:
          'Selecciona un producto por su nombre cuando la persona escribe el nombre completo o una referencia clara.',
        strict: true,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: {
              type: 'string',
              description: 'Nombre o referencia del producto.',
            },
          },
          required: ['name'],
        },
      },
      {
        type: 'function',
        name: 'get_selected_product',
        description:
          'Consulta el producto que ya está seleccionado en la conversación y sus opciones reales.',
        strict: true,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {},
          required: [],
        },
      },
      {
        type: 'function',
        name: 'select_variant',
        description:
          'Valida una o varias variantes reales del producto actual. Úsala cuando la persona indique color, talla, medida y cantidad. Ejemplo: “uno talla S y uno talla M” son dos selecciones distintas.',
        strict: true,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            selections: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  option_values: {
                    type: 'array',
                    minItems: 1,
                    items: {
                      type: 'string',
                    },
                  },
                  quantity: {
                    type: 'integer',
                    minimum: 1,
                  },
                },
                required: ['option_values', 'quantity'],
              },
            },
          },
          required: ['selections'],
        },
      },
      {
  type: 'function',
  name: 'add_selected_variant_to_cart',
  description:
    'Agrega al carrito la variante seleccionada cuando la cliente ya confirmó color, talla o variante. Usa cantidad 1 si no indicó otra. No pidas confirmación adicional.',
  strict: true,
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      quantity: {
        type: 'integer',
        minimum: 1,
      },
    },
    required: ['quantity'],
  },
},
{
  type: 'function',
  name: 'replace_cart_line_variant',
  description:
    'Reemplaza una línea existente del carrito por la variante ya seleccionada. Úsala solo para un cambio confirmado de talla, color o variante de un producto que ya está en el carrito. No la uses para agregar un producto nuevo.',
  strict: true,
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      current_variant_id: {
        type: 'string',
        description:
          'ID de la variante actual de la línea que el cliente pidió cambiar.',
      },
      quantity: {
        type: 'integer',
        minimum: 1,
        description:
          'Cantidad de unidades de esa línea que se cambia a la nueva variante.',
      },
    },
    required: ['current_variant_id', 'quantity'],
  },
},
{
  type: 'function',
  name: 'set_cart_line_quantity',
  description:
    'Cambia la cantidad de una variante que ya está en el carrito, cuando el cliente confirma la nueva cantidad.',
  strict: true,
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      variant_id: {
        type: 'string',
        description: 'ID de la variante cuya cantidad se va a actualizar.',
      },
      quantity: {
        type: 'integer',
        minimum: 1,
      },
    },
    required: ['variant_id', 'quantity'],
  },
},
{
  type: 'function',
  name: 'remove_cart_line',
  description:
    'Quita una variante existente del carrito solo cuando el cliente confirme que no la quiere.',
  strict: true,
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      variant_id: {
        type: 'string',
        description: 'ID de la variante que se va a quitar.',
      },
    },
    required: ['variant_id'],
  },
},
{
  type: 'function',
  name: 'keep_only_cart_line',
  description:
    'Deja únicamente una variante en el carrito y elimina todos los demás productos en una sola operación. Úsala cuando el cliente diga “solo ese”, “solo el buzo”, “deja únicamente este” o equivalente. No vuelvas a pedir confirmación.',
  strict: true,
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      variant_id: {
        type: 'string',
        description:
          'ID de la variante que el cliente quiere conservar.',
      },
    },
    required: ['variant_id'],
  },
},
{
  type: 'function',
  name: 'get_cart',
  description:
    'Consulta el resumen, IDs, cantidades y total real del carrito.',
  strict: true,
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {},
    required: [],
  },
},
{
  type: 'function',
  name: 'remember_sale_context',
  description:
    'Guarda ciudad, costo de envío, medio de pago, confirmación del carrito y pasos enviados. Úsala cada vez que uno de esos datos cambie.',
  strict: true,
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      city: {
        type: 'string',
        description:
          'Ciudad confirmada. Usa cadena vacía si no cambió.',
      },
      payment_method: {
        type: 'string',
        description:
          'Medio de pago elegido. Usa cadena vacía si no cambió.',
      },
      shipping_cost_cop: {
        type: 'string',
        description:
          'Costo de envío numérico en COP, sin símbolos. Usa cadena vacía si todavía no se conoce.',
      },
      cart_confirmation_requested: {
        type: 'boolean',
        description:
          'true cuando ya preguntaste si desea agregar otro producto antes del checkout.',
      },
      cart_confirmed: {
        type: 'boolean',
        description:
          'true únicamente cuando confirmó que no agregará más o pidió finalizar.',
      },
      payment_instructions_sent: {
        type: 'boolean',
        description:
          'true cuando la respuesta actual ya incluirá los datos o instrucciones del medio elegido.',
      },
      checkout_instructions_sent: {
        type: 'boolean',
        description:
          'true cuando la respuesta actual ya incluirá el checkout.',
      },
    },
    required: [
      'city',
      'payment_method',
      'shipping_cost_cop',
      'cart_confirmation_requested',
      'cart_confirmed',
      'payment_instructions_sent',
      'checkout_instructions_sent',
    ],
  },
},
{
  type: 'function',
  name: 'get_sale_context',
  description:
    'Consulta ciudad, envío, medio de pago y pasos ya enviados antes de volver a preguntarlos.',
  strict: true,
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {},
    required: [],
  },
},
{
  type: 'function',
  name: 'lookup_order',
  description:
    'Consulta un pedido real de la empresa por número de pedido, correo o celular. Úsala para estado del pedido, guía, transportadora, seguimiento, cambios, garantías o problemas posteriores a la compra.',
  strict: true,
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      order_reference: {
        type: 'string',
        description: 'Número o referencia del pedido. Usa cadena vacía si no se conoce.',
      },
      email: {
        type: 'string',
        description: 'Correo usado en la compra. Usa cadena vacía si no se conoce.',
      },
      phone: {
        type: 'string',
        description: 'Celular usado en la compra. Usa cadena vacía si no se conoce.',
      },
    },
    required: ['order_reference', 'email', 'phone'],
  },
},
{
  type: 'function',
  name: 'request_human_attention',
  description:
    'Transfiere la conversación a la cola de un asesor humano conservando el área que eligió el cliente. Úsala cuando pida asesor, no puedas resolver o tras una aclaración fallida. Incluye motivo y resumen interno. Antes de usarla, responde al cliente con el mensaje definido por la empresa.',
  strict: true,
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      reason: {
        type: 'string',
        description: 'Motivo breve de la transferencia.',
      },
      summary: {
        type: 'string',
        description: 'Resumen interno: necesidad, datos revisados, acciones realizadas y pendiente.',
      },
      customer_message: {
        type: 'string',
        description: 'Mensaje exacto que recibirá el cliente al transferir. Debe respetar el tono y las instrucciones de la empresa.',
      },
    },
    required: ['reason', 'summary', 'customer_message'],
  },
},
{
  type: 'function',
  name: 'create_checkout_link',
  description:
    'Crea el link real de carrito y pago de Shopify con los productos que ya estén agregados.',
  strict: true,
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {},
    required: [],
  },
},
    ];
  }

  private async executeTool(
    name: string,
    rawArguments: string,
    session: ConversationSession,
  ): Promise<unknown> {
    const args = this.parseArguments(rawArguments);

    try {
      if (name === 'open_collection') {
        return this.openCollection(
          session,
          this.readString(args, 'collection_id'),
        );
      }

      if (name === 'search_products') {
        return this.searchProducts(
          session,
          this.readString(args, 'query'),
        );
      }

      if (name === 'select_product_by_url') {
        return this.selectProductByUrl(
          session,
          this.readString(args, 'url'),
        );
      }

      if (name === 'select_product_by_name') {
        return this.selectProductByName(
          session,
          this.readString(args, 'name'),
        );
      }

      if (name === 'get_selected_product') {
        return this.getSelectedProduct(session);
      }

      if (name === 'select_variant') {
        return this.selectVariant(
          session,
          this.readVariantSelections(args),
        );
      }

      if (name === 'add_selected_variant_to_cart') {
        const result = await this.cartService.addSelectedVariant(
          session,
          this.readInteger(args, 'quantity'),
        );

        if (
          result &&
          typeof result === 'object' &&
          !Array.isArray(result) &&
          (result as { ok?: unknown }).ok === true
        ) {
          await this.invalidateSaleContextAfterCartChange(session);
        }

        return this.enrichCartToolResult(session, result);
      }

      if (name === 'replace_cart_line_variant') {
        const result =
          await this.cartService.replaceCartLineWithSelectedVariant(
            session,
            this.readString(args, 'current_variant_id'),
            this.readInteger(args, 'quantity'),
          );

        if (
          result &&
          typeof result === 'object' &&
          !Array.isArray(result) &&
          (result as { ok?: unknown }).ok === true
        ) {
          await this.invalidateSaleContextAfterCartChange(session);
        }

        return this.enrichCartToolResult(session, result);
      }

      if (name === 'set_cart_line_quantity') {
        const result = await this.cartService.setCartLineQuantity(
          session,
          this.readString(args, 'variant_id'),
          this.readInteger(args, 'quantity'),
        );

        if (
          result &&
          typeof result === 'object' &&
          !Array.isArray(result) &&
          (result as { ok?: unknown }).ok === true
        ) {
          await this.invalidateSaleContextAfterCartChange(session);
        }

        return this.enrichCartToolResult(session, result);
      }

      if (name === 'remove_cart_line') {
        const result = await this.cartService.removeCartLine(
          session,
          this.readString(args, 'variant_id'),
        );

        if (
          result &&
          typeof result === 'object' &&
          !Array.isArray(result) &&
          (result as { ok?: unknown }).ok === true
        ) {
          await this.invalidateSaleContextAfterCartChange(session);
        }

        return this.enrichCartToolResult(session, result);
      }

      if (name === 'keep_only_cart_line') {
        const result = await this.cartService.keepOnlyCartLine(
          session,
          this.readString(args, 'variant_id'),
        );

        if (
          result &&
          typeof result === 'object' &&
          !Array.isArray(result) &&
          (result as { ok?: unknown }).ok === true
        ) {
          await this.invalidateSaleContextAfterCartChange(session);
        }

        return this.enrichCartToolResult(session, result);
      }

      if (name === 'get_cart') {
        const result = await this.cartService.getCart(session);

        return this.enrichCartToolResult(session, result);
      }

      if (name === 'remember_sale_context') {
        return this.rememberSaleContext(session, args);
      }

      if (name === 'get_sale_context') {
        return this.getSaleContext(session);
      }

      if (name === 'lookup_order') {
        return this.customerOrderService.lookup(session.companyId, {
          orderReference:
            typeof args.order_reference === 'string'
              ? args.order_reference
              : '',
          email: typeof args.email === 'string' ? args.email : '',
          phone: typeof args.phone === 'string' ? args.phone : '',
          limit: 3,
        });
      }

      if (name === 'request_human_attention') {
        const updatedSession =
          await this.conversationMemoryService.requestHumanAttention(
            session.id,
            {
              reason: this.readString(args, 'reason'),
              summary: this.readString(args, 'summary'),
            },
          );

        const context =
          updatedSession.context &&
          typeof updatedSession.context === 'object'
            ? updatedSession.context as Record<string, unknown>
            : {};
        const handoff =
          context.handoff &&
          typeof context.handoff === 'object' &&
          !Array.isArray(context.handoff)
            ? context.handoff as Record<string, unknown>
            : {};
        const handoffStatus =
          typeof handoff.status === 'string' ? handoff.status : '';
        const customCustomerMessage =
          typeof args.customer_message === 'string'
            ? args.customer_message.trim().slice(0, 700)
            : '';

        const fallbackCustomerMessage =
          updatedSession.attentionStatus === 'human'
            ? 'Listo, te voy a comunicar con un asesor para que te ayude.'
            : handoffStatus === 'waiting_outside_hours'
              ? 'Nuestro equipo te atenderá dentro del horario de atención. Mientras tanto, puedo ayudarte con productos, tallas, envíos y pagos.'
              : handoffStatus === 'waiting_no_advisor'
                ? 'En este momento todos nuestros asesores están ocupados. Dejé tu solicitud pendiente para que te atiendan apenas estén disponibles.'
                : 'Dejé tu solicitud pendiente para que un asesor la revise y te responda lo antes posible.';

        const customerMessage =
          customCustomerMessage || fallbackCustomerMessage;

        return {
          ok: true,
          attention_status: updatedSession.attentionStatus,
          assigned_to_name: updatedSession.assignedToName,
          assigned: updatedSession.attentionStatus === 'human',
          customer_message: customerMessage,
        };
      }

      if (name === 'create_checkout_link') {
        const currentSession =
          await this.conversationMemoryService.getSessionById(session.id);
        const saleContext =
          this.readSaleContext(currentSession.context);
        const recoveryContext = currentSession.context.cart_recovery;
        const isRecoveryCart =
          Boolean(recoveryContext) &&
          typeof recoveryContext === 'object' &&
          !Array.isArray(recoveryContext);

        const hasCity =
          typeof saleContext.city === 'string' &&
          saleContext.city.trim().length > 0;
        const hasPayment =
          typeof saleContext.payment_method === 'string' &&
          saleContext.payment_method.trim().length > 0;
        const shippingValue =
          typeof saleContext.shipping_cost_cop === 'string' ||
          typeof saleContext.shipping_cost_cop === 'number'
            ? Number(saleContext.shipping_cost_cop)
            : NaN;
        const hasShipping = Number.isFinite(shippingValue);

        if (
          !isRecoveryCart &&
          (!hasCity || !hasPayment || !hasShipping)
        ) {
          return {
            ok: false,
            next_action: 'complete_sale_context',
            error:
              'Antes del checkout confirma ciudad, medio de pago y costo de envío.',
            sale_context: saleContext,
          };
        }

        if (
          !isRecoveryCart &&
          saleContext.cart_confirmed !== true
        ) {
          return {
            ok: false,
            next_action: 'confirm_cart',
            error:
              'Pregunta una sola vez si desea agregar otro producto. Cuando confirme que no, guarda cart_confirmed=true.',
            sale_context: saleContext,
          };
        }

        const result =
          await this.cartService.createCheckoutLink(currentSession);

        return this.enrichCartToolResult(currentSession, result);
      }

      return {
        ok: false,
        error: 'La acción solicitada no existe.',
      };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo ejecutar la acción.',
      };
    }
  }

  private async openCollection(
    session: ConversationSession,
    collectionId: string,
  ) {
    const collections = await this.getCollectionsForSession(session);

    const collection =
      collections.find((item) => item.id === collectionId) ?? null;

    if (!collection) {
      return {
        ok: false,
        error: 'La colección no existe en el catálogo real.',
      };
    }

    await this.conversationMemoryService.updateSession(session.id, {
      stage: 'sales',
      context: {
        ...session.context,
        lastCollection: {
          id: collection.id,
          title: collection.title,
          url: collection.onlineStoreUrl,
        },
      },
    });

    return {
      ok: true,
      collection: {
        title: collection.title,
        url: collection.onlineStoreUrl,
      },
    };
  }

  private async searchProducts(
    session: ConversationSession,
    query: string,
  ) {
    if (await this.usesCompanyCommerce(session)) {
      const products = await this.companyCommerceService.searchProducts(
        session.companyId,
        query,
        8,
      );

      return {
        ok: true,
        query,
        products: products.map((product) => ({
          id: product.id,
          title: product.title,
          url: product.onlineStoreUrl,
          image_url: product.imageUrl,
          price_from_cop: this.getCompanyStartingPrice(product),
          variants: product.variants.slice(0, 10).map((variant) => ({
            id: variant.id,
            title: variant.title,
            price_cop: variant.price,
            options: variant.options,
          })),
        })),
      };
    }

    const products = await this.shopifyService.searchCatalog(query, 8);

    return {
      ok: true,
      query,
      products: products.map((product) => ({
        id: product.id,
        title: product.title,
        url: product.onlineStoreUrl,
        image_url: product.featuredImage?.url ?? null,
        price_from_cop: this.getStartingPrice(product),
        variants: product.variants.edges.slice(0, 10).map(({ node }) => ({
          id: node.id,
          title: node.title,
          price_cop: node.price,
          options: node.selectedOptions,
        })),
      })),
    };
  }

  private async selectProductByUrl(
    session: ConversationSession,
    url: string,
  ) {
    if (await this.usesCompanyCommerce(session)) {
      const handle = this.getHandleFromProductUrl(url);

      if (!handle) {
        return {
          ok: false,
          error: 'No encontré un enlace válido de producto.',
        };
      }

      const product =
        await this.companyCommerceService.getProductByHandle(
          session.companyId,
          handle,
        );

      if (!product) {
        return {
          ok: false,
          error: 'No encontré un producto vendible en la tienda de esta empresa.',
        };
      }

      return this.saveSelectedCompanyProduct(session, product);
    }

    const product = await this.shopifyService.getProductFromUrl(url);

    if (!product) {
      return {
        ok: false,
        error: 'No encontré un producto válido en ese enlace.',
      };
    }

    return this.saveSelectedProduct(session, product);
  }

  private async selectProductByName(
    session: ConversationSession,
    name: string,
  ) {
    if (await this.usesCompanyCommerce(session)) {
      const products = await this.companyCommerceService.searchProducts(
        session.companyId,
        name,
        5,
      );

      const exactProduct =
        products.find(
          (product) =>
            this.normalizeText(product.title) === this.normalizeText(name),
        ) ?? null;

      if (!exactProduct) {
        return {
          ok: false,
          error:
            'No encontré una coincidencia exacta. Pide el enlace del producto o más detalles.',
          candidates: products.map((product) => ({
            title: product.title,
            url: product.onlineStoreUrl,
          })),
        };
      }

      return this.saveSelectedCompanyProduct(session, exactProduct);
    }

    const products = await this.shopifyService.searchCatalog(name, 5);

    const exactProduct =
      products.find(
        (product) =>
          this.normalizeText(product.title) === this.normalizeText(name),
      ) ?? null;

    if (!exactProduct) {
      return {
        ok: false,
        error:
          'No encontré una coincidencia exacta. Pide a la persona el enlace del producto o más detalles.',
        candidates: products.map((product) => ({
          title: product.title,
          url: product.onlineStoreUrl,
        })),
      };
    }

    return this.saveSelectedProduct(session, exactProduct);
  }

  private async saveSelectedProduct(
    session: ConversationSession,
    product: ShopifyProduct,
  ) {
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
        selectedVariant: null,
        selectedVariants: [],
        selectedAt: new Date().toISOString(),
      },
    });

    return {
      ok: true,
      selected_product: this.productSnapshot(product),
    };
  }

  private async getSelectedProduct(session: ConversationSession) {
    const selectedProduct = this.readSelectedProduct(session.context);

    if (!selectedProduct) {
      return {
        ok: false,
        error: 'No hay un producto seleccionado todavía.',
      };
    }

    if (await this.usesCompanyCommerce(session)) {
      const product =
        await this.companyCommerceService.getProductByHandle(
          session.companyId,
          selectedProduct.handle,
        );

      if (!product) {
        return {
          ok: false,
          error: 'El producto seleccionado ya no está disponible.',
        };
      }

      return {
        ok: true,
        selected_product: this.companyProductSnapshot(product),
      };
    }

    const product = await this.shopifyService.getProductByHandle(
      selectedProduct.handle,
    );

    if (!product) {
      return {
        ok: false,
        error: 'El producto seleccionado ya no está disponible.',
      };
    }

    return {
      ok: true,
      selected_product: this.productSnapshot(product),
    };
  }

  private async selectVariant(
    session: ConversationSession,
    selections: VariantSelectionRequest[],
  ) {
    if (await this.usesCompanyCommerce(session)) {
      return this.selectCompanyVariant(session, selections);
    }

    const selectedProduct = this.readSelectedProduct(session.context);

    if (!selectedProduct) {
      return {
        ok: false,
        error: 'No hay producto seleccionado.',
      };
    }

    if (!selections.length) {
      return {
        ok: false,
        error: 'No se recibieron variantes para validar.',
      };
    }

    const product = await this.shopifyService.getProductByHandle(
      selectedProduct.handle,
    );

    if (!product) {
      return {
        ok: false,
        error: 'El producto seleccionado ya no está disponible.',
      };
    }

    const resolved = new Map<string, SelectedVariantSelection>();

    for (const selection of selections) {
      const values = selection.optionValues
        .map((value) => this.normalizeText(value))
        .filter(Boolean);

      if (!values.length) {
        return {
          ok: false,
          error: 'Falta color, talla o medida para validar una variante.',
          product: this.productSnapshot(product),
        };
      }

      const matches = product.variants.edges
        .map(({ node }) => node)
        .filter((variant) =>
          values.every((value) =>
            variant.selectedOptions.some(
              (option) =>
                this.normalizeText(option.value) === value,
            ),
          ),
        );

      if (!matches.length) {
        return {
          ok: false,
          error: 'No existe una variante con esas opciones.',
          product: this.productSnapshot(product),
        };
      }

      if (matches.length > 1) {
        return {
          ok: false,
          error: 'Todavía faltan opciones para elegir una variante única.',
          matching_variants: matches.slice(0, 10).map((variant) => ({
            id: variant.id,
            title: variant.title,
            price_cop: variant.price,
            options: variant.selectedOptions,
          })),
        };
      }

      const variant = matches[0];
      const existing = resolved.get(variant.id);

      if (existing) {
        existing.quantity += selection.quantity;
        continue;
      }

      resolved.set(variant.id, {
        id: variant.id,
        legacyResourceId: variant.legacyResourceId,
        title: variant.title,
        price: variant.price,
        options: variant.selectedOptions,
        quantity: selection.quantity,
      });
    }

    const selectedVariants = Array.from(resolved.values());

    if (!selectedVariants.length) {
      return {
        ok: false,
        error: 'No se encontró una variante válida.',
      };
    }

    const first = selectedVariants[0];

    await this.conversationMemoryService.updateSession(session.id, {
      stage: 'variant',
      context: {
        ...session.context,
        selectedVariant: {
          id: first.id,
          legacyResourceId: first.legacyResourceId,
          title: first.title,
          price: first.price,
          options: first.options,
        },
        selectedVariants,
        selectedVariantAt: new Date().toISOString(),
      },
    });

    return {
      ok: true,
      selected_variants: selectedVariants.map((variant) => ({
        id: variant.id,
        legacy_resource_id: variant.legacyResourceId,
        title: variant.title,
        price_cop: variant.price,
        options: variant.options,
        quantity: variant.quantity,
      })),
    };
  }

  private async usesCompanyCommerce(
    session: ConversationSession,
  ): Promise<boolean> {
    return this.companyCommerceService.isEnabled(session.companyId);
  }

  private async getCollectionsForSession(session: ConversationSession) {
    if (await this.usesCompanyCommerce(session)) {
      return this.companyCommerceService.getCollections(
        session.companyId,
        100,
      );
    }

    return this.shopifyService.getCollections();
  }

  private async saveSelectedCompanyProduct(
    session: ConversationSession,
    product: CompanyCommerceProduct,
  ) {
    await this.conversationMemoryService.updateSession(session.id, {
      stage: 'product',
      context: {
        ...session.context,
        selectedProduct: {
          id: product.id,
          handle: product.handle,
          title: product.title,
          url: product.onlineStoreUrl || '',
        },
        selectedVariant: null,
        selectedVariants: [],
        selectedAt: new Date().toISOString(),
      },
    });

    return {
      ok: true,
      selected_product: this.companyProductSnapshot(product),
    };
  }

  private async selectCompanyVariant(
    session: ConversationSession,
    selections: VariantSelectionRequest[],
  ) {
    const selectedProduct = this.readSelectedProduct(session.context);

    if (!selectedProduct) {
      return {
        ok: false,
        error: 'No hay producto seleccionado.',
      };
    }

    if (!selections.length) {
      return {
        ok: false,
        error: 'No se recibieron variantes para validar.',
      };
    }

    const product =
      await this.companyCommerceService.getProductByHandle(
        session.companyId,
        selectedProduct.handle,
      );

    if (!product) {
      return {
        ok: false,
        error: 'El producto seleccionado ya no está disponible.',
      };
    }

    const resolved = new Map<string, SelectedVariantSelection>();

    for (const selection of selections) {
      const values = selection.optionValues
        .map((value) => this.normalizeText(value))
        .filter(Boolean);

      if (!values.length) {
        return {
          ok: false,
          error: 'Falta color, talla o medida para validar una variante.',
          product: this.companyProductSnapshot(product),
        };
      }

      const matches = product.variants.filter((variant) =>
        values.every((value) =>
          variant.options.some(
            (option) => this.normalizeText(option.value) === value,
          ),
        ),
      );

      if (!matches.length) {
        return {
          ok: false,
          error: 'No existe una variante con esas opciones.',
          product: this.companyProductSnapshot(product),
        };
      }

      if (matches.length > 1) {
        return {
          ok: false,
          error: 'Todavía faltan opciones para elegir una variante única.',
          matching_variants: matches.slice(0, 10).map((variant) => ({
            id: variant.id,
            title: variant.title,
            price_cop: variant.price,
            options: variant.options,
          })),
        };
      }

      const variant = matches[0];
      const existing = resolved.get(variant.id);

      if (existing) {
        existing.quantity += selection.quantity;
        continue;
      }

      resolved.set(variant.id, {
        id: variant.id,
        legacyResourceId: variant.legacyResourceId,
        title: variant.title,
        price: variant.price,
        options: variant.options.map((option) => ({ ...option })),
        quantity: selection.quantity,
      });
    }

    const selectedVariants = Array.from(resolved.values());

    if (!selectedVariants.length) {
      return {
        ok: false,
        error: 'No se encontró una variante válida.',
      };
    }

    const first = selectedVariants[0];

    await this.conversationMemoryService.updateSession(session.id, {
      stage: 'variant',
      context: {
        ...session.context,
        selectedVariant: {
          id: first.id,
          legacyResourceId: first.legacyResourceId,
          title: first.title,
          price: first.price,
          options: first.options,
        },
        selectedVariants,
        selectedVariantAt: new Date().toISOString(),
      },
    });

    return {
      ok: true,
      selected_variants: selectedVariants.map((variant) => ({
        id: variant.id,
        legacy_resource_id: variant.legacyResourceId,
        title: variant.title,
        price_cop: variant.price,
        options: variant.options,
        quantity: variant.quantity,
      })),
    };
  }

  private companyProductSnapshot(product: CompanyCommerceProduct) {
    const optionMap = new Map<string, Set<string>>();

    for (const variant of product.variants) {
      for (const option of variant.options) {
        if (!optionMap.has(option.name)) {
          optionMap.set(option.name, new Set<string>());
        }

        optionMap.get(option.name)?.add(option.value);
      }
    }

    return {
      id: product.id,
      title: product.title,
      url: product.onlineStoreUrl,
      image_url: product.imageUrl,
      price_from_cop: this.getCompanyStartingPrice(product),
      options: Array.from(optionMap.entries()).map(([name, values]) => ({
        name,
        values: Array.from(values),
      })),
      variants: product.variants.slice(0, 30).map((variant) => ({
        id: variant.id,
        title: variant.title,
        price_cop: variant.price,
        options: variant.options,
      })),
    };
  }

  private getCompanyStartingPrice(
    product: CompanyCommerceProduct,
  ): string | null {
    const prices = product.variants
      .map((variant) => Number(variant.price))
      .filter((price) => Number.isFinite(price));

    if (!prices.length) {
      return null;
    }

    return Math.min(...prices).toFixed(2);
  }

  private getHandleFromProductUrl(value: string): string {
    const raw = value.trim();

    if (!raw) {
      return '';
    }

    try {
      const url = new URL(raw);
      const match = url.pathname.match(/\/products\/([^/?#]+)/i);

      return match
        ? decodeURIComponent(match[1]).trim().toLowerCase()
        : '';
    } catch {
      const match = raw.match(/\/products\/([^/?#]+)/i);

      return match
        ? decodeURIComponent(match[1]).trim().toLowerCase()
        : '';
    }
  }

  private async getRecentMessages(sessionId: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('conversations')
      .select('sender, message, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(12);

    if (error) {
      return [];
    }

    return (data ?? [])
      .reverse()
      .map((message) => ({
        sender: message.sender,
        message: message.message,
      }));
  }

  private productSnapshot(product: ShopifyProduct) {
    const optionMap = new Map<string, Set<string>>();

    for (const { node: variant } of product.variants.edges) {
      for (const option of variant.selectedOptions) {
        if (!optionMap.has(option.name)) {
          optionMap.set(option.name, new Set<string>());
        }

        optionMap.get(option.name)?.add(option.value);
      }
    }

    return {
      id: product.id,
      title: product.title,
      url: product.onlineStoreUrl,
      image_url: product.featuredImage?.url ?? null,
      price_from_cop: this.getStartingPrice(product),
      options: Array.from(optionMap.entries()).map(([name, values]) => ({
        name,
        values: Array.from(values),
      })),
      variants: product.variants.edges.slice(0, 30).map(({ node }) => ({
        id: node.id,
        title: node.title,
        price_cop: node.price,
        options: node.selectedOptions,
      })),
    };
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
    context: JsonObject,
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

  private readSelectedVariant(
    context: JsonObject,
  ): SelectedVariant | null {
    return this.parseSelectedVariant(context.selectedVariant);
  }

  private readSelectedVariants(
    context: JsonObject,
  ): SelectedVariantSelection[] {
    const value = context.selectedVariants;

    if (!Array.isArray(value)) {
      const single = this.readSelectedVariant(context);

      return single
        ? [
            {
              ...single,
              quantity: 1,
            },
          ]
        : [];
    }

    const variants: SelectedVariantSelection[] = [];

    for (const item of value) {
      const variant = this.parseSelectedVariant(item);

      if (!variant) {
        continue;
      }

      const quantity =
        item &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        Number.isInteger(
          (item as Record<string, unknown>).quantity,
        ) &&
        Number((item as Record<string, unknown>).quantity) > 0
          ? Number((item as Record<string, unknown>).quantity)
          : 1;

      variants.push({
        ...variant,
        quantity,
      });
    }

    return variants;
  }

  private parseSelectedVariant(
    value: unknown,
  ): SelectedVariant | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const variant = value as Record<string, unknown>;

    if (
      typeof variant.id !== 'string' ||
      typeof variant.legacyResourceId !== 'string' ||
      typeof variant.title !== 'string' ||
      typeof variant.price !== 'string' ||
      !Array.isArray(variant.options)
    ) {
      return null;
    }

    const options = variant.options.filter(
      (option): option is ProductOption => {
        if (
          !option ||
          typeof option !== 'object' ||
          Array.isArray(option)
        ) {
          return false;
        }

        const item = option as Record<string, unknown>;

        return (
          typeof item.name === 'string' &&
          typeof item.value === 'string'
        );
      },
    );

    return {
      id: variant.id,
      legacyResourceId: variant.legacyResourceId,
      title: variant.title,
      price: variant.price,
      options,
    };
  }

  private readVariantSelections(
    args: JsonObject,
  ): VariantSelectionRequest[] {
    const value = args.selections;

    if (!Array.isArray(value)) {
      return [];
    }

    const selections: VariantSelectionRequest[] = [];

    for (const item of value) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        continue;
      }

      const selection = item as Record<string, unknown>;

      const optionValues = Array.isArray(selection.option_values)
        ? selection.option_values.filter(
            (option): option is string =>
              typeof option === 'string' && option.trim().length > 0,
          )
        : [];

      const quantity = Number(selection.quantity);

      if (
        !optionValues.length ||
        !Number.isInteger(quantity) ||
        quantity < 1
      ) {
        continue;
      }

      selections.push({
        optionValues,
        quantity,
      });
    }

    return selections;
  }

  private parseArguments(rawArguments: string): JsonObject {
    try {
      const parsed = JSON.parse(rawArguments);

      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed)
      ) {
        return parsed as JsonObject;
      }
    } catch {
      return {};
    }

    return {};
  }

  private readString(args: JsonObject, key: string): string {
    const value = args[key];

    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`Falta el dato ${key}.`);
    }

    return value.trim();
  }
  private readInteger(args: JsonObject, key: string): number {
    const value = args[key];

    if (!Number.isInteger(value) || Number(value) < 1) {
      throw new Error(
        `El dato ${key} debe ser un número entero mayor a cero.`,
      );
    }

    return Number(value);
  }


  private async finalizeAgentReply(
    profile: CompanyProfile,
    session: ConversationSession,
    input: any[],
    hasRecoveryContext: boolean,
    reason: string,
  ): Promise<string> {
    try {
      const finalResponse = await this.getClient().responses.create({
        model: this.getModel(),
        instructions: [
          this.buildInstructions(profile, hasRecoveryContext),
          '',
          'RECUPERACIÓN INTERNA DE RESPUESTA:',
          '- Ya se ejecutaron las herramientas necesarias o se alcanzó el límite seguro.',
          '- Redacta ahora una respuesta final para el cliente usando únicamente los resultados reales incluidos en la conversación.',
          '- No menciones herramientas, llamadas, funciones, JSON, errores internos ni procesos técnicos.',
          '- Conserva el objetivo actual del cliente y pide únicamente el dato que realmente falte.',
          '- Si el cliente quiere finalizar una compra y ya existe un checkout_url real, compártelo.',
          '- No inventes información ni afirmes que una acción se completó si no aparece como exitosa.',
        ].join('\n'),
        input: [
          ...input,
          {
            role: 'user',
            content: JSON.stringify({
              internal_recovery: true,
              reason,
              instruction:
                'Produce la respuesta final natural para el cliente y continúa el objetivo comercial actual.',
            }),
          },
        ],
      });

      const clean = this.cleanReply(finalResponse.output_text);

      if (clean) {
        await this.clearTechnicalFailureState(session.id);
        return this.enforceSalesReply(session, clean);
      }

      return this.handleTechnicalFailure(
        session.id,
        `${reason} La recuperación final también quedó vacía o insegura.`,
      );
    } catch (error) {
      console.error('No se pudo recuperar la respuesta final de OpenAI:', error);

      return this.handleTechnicalFailure(
        session.id,
        error instanceof Error
          ? error.message
          : `${reason} La recuperación final produjo un error.`,
      );
    }
  }

  private async handleTechnicalFailure(
    sessionId: string,
    reason: string,
  ): Promise<string> {
    const session =
      await this.conversationMemoryService.getSessionById(sessionId);
    const rawState =
      session.context.technical_failure_state &&
      typeof session.context.technical_failure_state === 'object' &&
      !Array.isArray(session.context.technical_failure_state)
        ? session.context.technical_failure_state as JsonObject
        : null;
    const previousCount =
      rawState && typeof rawState.count === 'number'
        ? Math.max(0, Math.floor(rawState.count))
        : 0;
    const nextCount = previousCount + 1;

    if (nextCount >= 2) {
      const updated =
        await this.conversationMemoryService.requestHumanAttention(
          session.id,
          {
            reason:
              'El motor automático no logró completar la atención después de dos intentos.',
            summary:
              'Continúa desde el último mensaje del cliente. Conserva el carrito, los datos ya informados y el objetivo pendiente.',
          },
        );

      return this.humanAttentionMessage(updated);
    }

    await this.conversationMemoryService.updateSession(session.id, {
      context: {
        ...session.context,
        technical_failure_state: {
          count: nextCount,
          reason: reason.trim().slice(0, 500),
          failed_at: new Date().toISOString(),
        },
      },
    });

    return 'Tuve una dificultad para completar esa acción, pero conservé la conversación y los datos que ya me diste. Escríbeme nuevamente cómo deseas continuar y retomaré desde este punto.';
  }

  private async clearTechnicalFailureState(
    sessionId: string,
  ): Promise<void> {
    const session =
      await this.conversationMemoryService.getSessionById(sessionId);

    if (
      !session.context.technical_failure_state ||
      typeof session.context.technical_failure_state !== 'object' ||
      Array.isArray(session.context.technical_failure_state)
    ) {
      return;
    }

    const nextContext = { ...session.context };
    delete nextContext.technical_failure_state;

    await this.conversationMemoryService.updateSession(session.id, {
      context: nextContext,
    });
  }

  humanAttentionReply(
    session: ConversationSession,
  ): string {
    return this.humanAttentionMessage(session);
  }

  private humanAttentionMessage(
    session: ConversationSession,
  ): string {
    const context =
      session.context &&
      typeof session.context === 'object' &&
      !Array.isArray(session.context)
        ? session.context as JsonObject
        : {};
    const handoff =
      context.handoff &&
      typeof context.handoff === 'object' &&
      !Array.isArray(context.handoff)
        ? context.handoff as JsonObject
        : {};
    const status =
      typeof handoff.status === 'string'
        ? handoff.status.trim()
        : '';

    if (session.attentionStatus === 'human') {
      return session.assignedToName
        ? `Para ayudarte mejor, te voy a comunicar con ${session.assignedToName}, uno de nuestros asesores.`
        : 'Para ayudarte mejor, te voy a comunicar con uno de nuestros asesores.';
    }

    if (status === 'waiting_outside_hours') {
      return 'En este momento estamos fuera del horario de atención. Dejé tu solicitud pendiente para que uno de nuestros asesores te responda cuando inicie el próximo horario disponible.';
    }

    if (status === 'waiting_no_advisor') {
      return 'En este momento nuestros asesores no están disponibles. Dejé tu solicitud en espera para que el equipo continúe la atención apenas haya un asesor disponible.';
    }

    if (status === 'waiting_no_area') {
      return 'Dejé tu solicitud pendiente para que el equipo responsable la revise y continúe la atención.';
    }

    return 'Para ayudarte mejor, dejé tu solicitud pendiente para que uno de nuestros asesores la revise y te responda.';
  }

  private cleanReply(reply: string): string {
    const clean = this.removeInternalBlocks(reply)
      .replace(/\bto=functions\.[a-z0-9_.-]+\s*/gi, '')
      .replace(/\bfunctions\.[a-z0-9_.-]+\s*/gi, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (!clean || this.isUnsafeModelReply(clean)) {
      return '';
    }

    return clean.slice(0, 1500);
  }

  private isUnsafeModelReply(reply: string): boolean {
    return /(?:now adding|proceeding|filenamestring|function_call|tool call|to=functions\.)/i.test(
      reply,
    );
  }

private removeInternalBlocks(value: string): string {
  let result = '';
  let index = 0;

  while (index < value.length) {
    if (value[index] !== '{') {
      result += value[index];
      index += 1;
      continue;
    }

    const closingIndex = this.findClosingBrace(value, index);

    if (closingIndex === -1) {
      result += value[index];
      index += 1;
      continue;
    }

    index = closingIndex + 1;
  }

  return result;
}

private findClosingBrace(
  value: string,
  startIndex: number,
): number {
  let depth = 0;
  let insideString = false;
  let escaped = false;

  for (let index = startIndex; index < value.length; index += 1) {
    const character = value[index];

    if (insideString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        insideString = false;
      }

      continue;
    }

    if (character === '"') {
      insideString = true;
      continue;
    }

    if (character === '{') {
      depth += 1;
      continue;
    }

    if (character === '}') {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

  private normalizeText(value: string): string {
    return value
      .toLocaleLowerCase('es-CO')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private getClient(): OpenAI {
    if (this.client) {
      return this.client;
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();

    if (!apiKey) {
      throw new Error('Falta OPENAI_API_KEY en Railway.');
    }

    this.client = new OpenAI({ apiKey });

    return this.client;
  }

  private getModel(): string {
    return process.env.OPENAI_MODEL?.trim() || 'gpt-5-mini';
  }
}
