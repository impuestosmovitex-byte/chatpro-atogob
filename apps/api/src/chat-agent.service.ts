import { CartService } from './cart.service';
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

@Injectable()
export class ChatAgentService {
  private client: OpenAI | null = null;

  constructor(
    private readonly cartService: CartService,
    private readonly shopifyService: ShopifyService,
    private readonly supabaseService: SupabaseService,
    private readonly conversationMemoryService: ConversationMemoryService,
  ) {}

  async reply(
    profile: CompanyProfile,
    session: ConversationSession,
    customerMessage: string,
  ): Promise<string> {
    const currentIntent = await this.classifyCurrentIntent(
      profile,
      session,
      customerMessage,
    );

    let activeSession =
      currentIntent === 'new_catalog_search'
        ? await this.conversationMemoryService.updateSession(session.id, {
            stage: 'sales',
            context: this.clearSelectedProductContext(session.context),
          })
        : session;

    const collections = await this.shopifyService.getCollections();
    const contextStatus = this.getContextStatus(profile, activeSession);

    const history = contextStatus.is_within_context_window
      ? await this.getRecentMessages(activeSession.id)
      : [];

    let response = await this.getClient().responses.create({
      model: this.getModel(),
      instructions: this.buildInstructions(profile),
      input: JSON.stringify({
        company: {
          name: profile.name,
          settings: profile.settings,
        },
        session: {
          stage: activeSession.stage,
          context: activeSession.context,
          last_message_at: activeSession.lastMessageAt,
          context_status: contextStatus,
        },
        conversation_history: history,
        current_customer_message: customerMessage,
        real_collections: collections.map((collection) => ({
          id: collection.id,
          title: collection.title,
          url: collection.onlineStoreUrl,
        })),
      }),
      tools: this.getTools(),
      tool_choice: 'auto',
    });

    for (let turn = 0; turn < 5; turn += 1) {
      const toolOutputs: Array<{
        type: 'function_call_output';
        call_id: string;
        output: string;
      }> = [];

      let cartUpdatedResult: unknown = null;
      let checkoutCreatedResult: unknown = null;

      for (const item of response.output) {
        if (item.type !== 'function_call') {
          continue;
        }

        const result = await this.executeTool(
          item.name,
          item.arguments,
          activeSession,
        );

        toolOutputs.push({
          type: 'function_call_output',
          call_id: item.call_id,
          output: JSON.stringify(result),
        });

        if (item.name === 'add_selected_variant_to_cart') {
          cartUpdatedResult = result;
        }

        if (item.name === 'create_checkout_link') {
          checkoutCreatedResult = result;
        }

        activeSession =
          await this.conversationMemoryService.getSessionById(
            activeSession.id,
          );
      }

      const checkoutReply =
        this.buildRealCheckoutReply(checkoutCreatedResult);

      if (checkoutReply) {
        return checkoutReply;
      }

      const cartReply =
        this.buildRealCartReply(cartUpdatedResult);

      if (cartReply) {
        return cartReply;
      }

      if (!toolOutputs.length) {
        return this.cleanReply(response.output_text);
      }

      response = await this.getClient().responses.create({
        model: this.getModel(),
        previous_response_id: response.id,
        input: toolOutputs as any,
      });
    }

    return 'Estoy revisando la información para ayudarte. Cuéntame nuevamente qué producto buscas o envíame el enlace.';
  }

  private buildRealCartReply(result: unknown): string | null {
    const payload = this.toToolRecord(result);

    if (!payload || payload.ok !== true) {
      return null;
    }

    const cart = this.toToolRecord(payload.cart);

    if (!cart) {
      return null;
    }

    const summary = this.formatRealCartSummary(cart);

    if (!summary) {
      return null;
    }

    return [
      'Listo ✨ Ya quedó agregado al carrito:',
      '',
      summary,
      '',
      'Puedes seguir agregando productos. Cuando termines, escribe “pagar” y te envío un único link real con todo el carrito.',
    ].join('\n');
  }

  private buildRealCheckoutReply(result: unknown): string | null {
    const payload = this.toToolRecord(result);

    if (!payload || payload.ok !== true) {
      return null;
    }

    const checkoutUrl =
      typeof payload.checkout_url === 'string'
        ? payload.checkout_url.trim()
        : '';

    if (!checkoutUrl) {
      return null;
    }

    const cart = this.toToolRecord(payload.cart);
    const summary = cart
      ? this.formatRealCartSummary(cart)
      : '';

    return [
      'Perfecto ✨ Tu carrito ya está listo para pagar.',
      summary ? `\n${summary}` : '',
      '',
      'Completa tus datos y elige tu medio de pago aquí:',
      checkoutUrl,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private formatRealCartSummary(
    cart: Record<string, unknown>,
  ): string | null {
    const lines = Array.isArray(cart.lines) ? cart.lines : [];

    if (!lines.length) {
      return null;
    }

    const formattedLines = lines
      .map((value) => {
        const line = this.toToolRecord(value);

        if (!line) {
          return null;
        }

        const product =
          typeof line.product_title === 'string'
            ? line.product_title
            : 'Producto';

        const variant =
          typeof line.variant_title === 'string' &&
          line.variant_title.trim() &&
          line.variant_title !== 'Default Title'
            ? ` — ${line.variant_title}`
            : '';

        const quantity =
          typeof line.quantity === 'number' ? line.quantity : 1;

        const lineTotal = this.formatCop(
          line.line_total_cop ?? line.unit_price_cop,
        );

        return `• ${product}${variant} — Cantidad: ${quantity} — ${lineTotal}`;
      })
      .filter((line): line is string => Boolean(line));

    if (!formattedLines.length) {
      return null;
    }

    const total = this.formatCop(cart.products_total_cop);

    return [
      ...formattedLines,
      `Total del carrito: ${total}`,
    ].join('\n');
  }

  private formatCop(value: unknown): string {
    const amount = Number(value);

    if (!Number.isFinite(amount)) {
      return 'Valor pendiente';
    }

    return `${new Intl.NumberFormat('es-CO', {
      maximumFractionDigits: 0,
    }).format(amount)} COP`;
  }

  private toToolRecord(
    value: unknown,
  ): Record<string, unknown> | null {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      return value as Record<string, unknown>;
    }

    return null;
  }
  private buildInstructions(profile: CompanyProfile): string {
  const assistantName = profile.assistantName ?? 'la asesora virtual';

  return [
    `Eres ${assistantName}, asesora comercial de ${profile.name}.`,
    'Hablas en español colombiano, de forma clara, breve, amable y natural.',
    'Entiendes errores de escritura, mensajes cortos y referencias como “este”, “esa”, “la primera”, “negro”, “sí me gusta” o “lo quiero comprar”.',
    '',
    'REGLAS ABSOLUTAS:',
    '- Nunca muestres JSON, código, herramientas, funciones, IDs técnicos, llamadas internas ni mensajes como “voy a buscar internamente”.',
    '- Nunca digas que eres una IA, ni menciones OpenAI, Shopify, Supabase, APIs o código.',
    '- Nunca inventes productos, precios, variantes, descuentos, stock, envío, promociones, políticas, enlaces o medios de pago.',
    '- Nunca prometas un link de pago, una reserva o un pedido creado si no existe una acción real que lo haya creado.',
    '- No pidas por WhatsApp dirección, teléfono, correo, documento ni datos de pago. Shopify Checkout solicita esos datos.',
    '- No asumas que talla única sirve para S o M, salvo que exista una regla configurada para esa empresa o producto.',
    '',
    'CONTEXTO DE LA CONVERSACIÓN:',
    '- Revisa el campo context_status.',
    '- Si is_within_context_window es true, conserva el contexto reciente: producto, variante, carrito y conversación.',
    '- Si is_within_context_window es false, no asumas que la persona sigue comprando el producto anterior.',
    '- Después de un contexto vencido, solo retoma el producto anterior cuando la persona lo mencione claramente, por ejemplo: “sí quiero ese vestido” o “quiero el que vimos”.',
    '- Nunca menciones, reutilices ni resumas nombre, dirección, teléfono, ciudad o pago de conversaciones anteriores.',
    '',
    'BÚSQUEDA Y VENTA:',
    '- Cuando la persona escriba una búsqueda nueva con categoría, color, talla o estilo, trátala como una búsqueda nueva aunque exista otro producto seleccionado.',
    '- Ejemplo: “quiero una blusa negra talla S” significa buscar blusas negras talla S; no hables solo de la blusa o vestido anterior.',
    '- Solo interpreta que habla del producto actual cuando use referencias claras como “este”, “esa”, “la primera”, “el que vimos” o “ese vestido”.',
    '- Si pide una categoría amplia o existen demasiadas referencias, comparte el catálogo de la categoría y pídele que elija un producto.',
    '- Para búsquedas concretas, muestra máximo tres opciones claras con nombre, precio y enlace.',
    '- Recomienda complementos solo cuando tengan sentido y sin insistir.',
    '',
    'CHECKOUT:',
    '- Cuando la persona quiera comprar, primero valida producto, variante y cantidad.',
    '- Después se agrega al carrito y se pregunta si desea agregar algo más o ir a pagar.',
    '- El checkout de Shopify solicita datos personales, dirección y medio de pago.',
    '- Puedes explicar que Addi, Sistecrédito, SUMAS u otros medios se seleccionan dentro del checkout cuando estén habilitados, pero no prometas links exclusivos de un medio de pago.',
    '',
    'INSTRUCCIONES ESPECÍFICAS DE LA EMPRESA:',
    profile.aiInstructions || 'No hay instrucciones adicionales.',
  ].join('\n');
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
  const lastMessageTime = new Date(session.lastMessageAt).getTime();

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

  return 168;
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
          'Valida y selecciona una variante del producto actual usando valores reales como talla, color, medida o capacidad.',
        strict: true,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            option_values: {
              type: 'array',
              items: {
                type: 'string',
              },
              description:
                'Valores que la persona eligió, por ejemplo Negro y 8.',
            },
          },
          required: ['option_values'],
        },
      },
      {
  type: 'function',
  name: 'add_selected_variant_to_cart',
  description:
    'Agrega al carrito la variante seleccionada con la cantidad confirmada por la cliente. Después de usarla, responde preguntando si desea agregar algo más o ir a pagar.',
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
  name: 'get_cart',
  description:
    'Consulta el resumen, cantidades y total actual del carrito.',
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
        return this.openCollection(session, this.readString(args, 'collection_id'));
      }

      if (name === 'search_products') {
        return this.searchProducts(this.readString(args, 'query'));
      }

      if (name === 'select_product_by_url') {
        return this.selectProductByUrl(session, this.readString(args, 'url'));
      }

      if (name === 'select_product_by_name') {
        return this.selectProductByName(session, this.readString(args, 'name'));
      }

      if (name === 'get_selected_product') {
        return this.getSelectedProduct(session);
      }

      if (name === 'select_variant') {
        return this.selectVariant(session, this.readStringArray(args, 'option_values'));
      }

      if (name === 'add_selected_variant_to_cart') {
  return this.cartService.addSelectedVariant(
    session,
    this.readInteger(args, 'quantity'),
  );
}

if (name === 'get_cart') {
  return this.cartService.getCart(session);
}

if (name === 'create_checkout_link') {
  return this.cartService.createCheckoutLink(session);
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
    const collections = await this.shopifyService.getCollections();

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

  private async searchProducts(query: string) {
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
    optionValues: string[],
  ) {
    const selectedProduct = this.readSelectedProduct(session.context);

    if (!selectedProduct) {
      return {
        ok: false,
        error: 'No hay producto seleccionado.',
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

    const values = optionValues
      .map((value) => this.normalizeText(value))
      .filter(Boolean);

    if (!values.length) {
      return {
        ok: false,
        error: 'No se recibieron opciones para validar.',
        product: this.productSnapshot(product),
      };
    }

    const matches = product.variants.edges
      .map(({ node }) => node)
      .filter((variant) =>
        values.every((value) =>
          variant.selectedOptions.some(
            (option) => this.normalizeText(option.value) === value,
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

    await this.conversationMemoryService.updateSession(session.id, {
      stage: 'variant',
      context: {
        ...session.context,
        selectedVariant: {
  id: variant.id,
  legacyResourceId: variant.legacyResourceId,
  title: variant.title,
          price: variant.price,
          options: variant.selectedOptions,
        },
        selectedVariantAt: new Date().toISOString(),
      },
    });

    return {
      ok: true,
      selected_variant: {
  id: variant.id,
  legacy_resource_id: variant.legacyResourceId,
  title: variant.title,
        price_cop: variant.price,
        options: variant.selectedOptions,
      },
    };
  }

  private async setPurchaseIntent(session: ConversationSession) {
    const selectedProduct = this.readSelectedProduct(session.context);
    const selectedVariant = this.readSelectedVariant(session.context);

    await this.conversationMemoryService.updateSession(session.id, {
      stage: selectedVariant ? 'checkout' : 'product',
      context: {
        ...session.context,
        purchaseIntent: true,
        purchaseIntentAt: new Date().toISOString(),
      },
    });

    return {
      ok: true,
      has_selected_product: Boolean(selectedProduct),
      has_selected_variant: Boolean(selectedVariant),
      selected_product: selectedProduct,
      selected_variant: selectedVariant,
    };
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

  private readSelectedVariant(context: JsonObject): JsonObject | null {
    const value = context.selectedVariant;

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    return value as JsonObject;
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
  private readStringArray(args: JsonObject, key: string): string[] {
    const value = args[key];

    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter(
      (item): item is string =>
        typeof item === 'string' && item.trim().length > 0,
    );
  }

  private cleanReply(reply: string): string {
    const clean = this.removeInternalBlocks(reply)
      .replace(/\bto=functions\.[a-z0-9_.-]+\s*/gi, '')
      .replace(/\bfunctions\.[a-z0-9_.-]+\s*/gi, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (!clean || this.isUnsafeModelReply(clean)) {
      return 'Estoy confirmando la información real del carrito. Dime qué color, talla o cantidad deseas y te ayudo.';
    }

    return clean.slice(0, 1500);
  }

  private isUnsafeModelReply(reply: string): boolean {
    return /(?:now adding|proceeding|filenamestring|function_call|tool call|to=functions\.|\/cart\/)/i.test(
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