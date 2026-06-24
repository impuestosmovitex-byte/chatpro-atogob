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
    private readonly shopifyService: ShopifyService,
    private readonly supabaseService: SupabaseService,
    private readonly conversationMemoryService: ConversationMemoryService,
  ) {}

  async reply(
    profile: CompanyProfile,
    session: ConversationSession,
    customerMessage: string,
  ): Promise<string> {
    const collections = await this.shopifyService.getCollections();
    const history = await this.getRecentMessages(session.id);

    let response = await this.getClient().responses.create({
      model: this.getModel(),
      instructions: this.buildInstructions(profile),
      input: JSON.stringify({
        company: {
          name: profile.name,
          settings: profile.settings,
        },
        session: {
          stage: session.stage,
          context: session.context,
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

      for (const item of response.output) {
        if (item.type !== 'function_call') {
          continue;
        }

        const result = await this.executeTool(
          item.name,
          item.arguments,
          session,
        );

        toolOutputs.push({
          type: 'function_call_output',
          call_id: item.call_id,
          output: JSON.stringify(result),
        });
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

  private buildInstructions(profile: CompanyProfile): string {
    return [
      'Eres el asesor comercial inteligente de una empresa.',
      'Hablas en español colombiano, de forma natural, breve y útil.',
      'Debes entender contexto, mensajes cortos, errores de escritura, abreviaturas y frases como “este”, “esa”, “negro”, “sí me gusta”, “lo quiero comprar” o “¿tienes blusas?”.',
      'Nunca digas que eres una IA, que usas herramientas, Shopify, Supabase, código o procesos internos.',
      'No inventes productos, precios, promociones, medios de pago, envíos, disponibilidad, políticas ni enlaces.',
      'Para mencionar productos, precios, variantes, opciones o colecciones, usa las herramientas disponibles.',
      'Cuando pidan una categoría amplia, abre la colección real correspondiente.',
      'Cuando pidan algo específico, busca productos reales.',
      'Cuando compartan un enlace de producto, selecciónalo usando la herramienta de URL.',
      'Cuando ya exista un producto seleccionado y pregunten otra categoría, entiende que pueden buscar un complemento; no repitas el producto anterior.',
      'Cuando digan un color, talla o característica, valida primero contra las variantes reales.',
      'Cuando digan que quieren comprar, identifica qué falta. Si ya eligieron una variante, pide ciudad para continuar; no afirmes que el checkout ya fue creado.',
      'Estas son las instrucciones específicas de la empresa:',
      profile.aiInstructions || 'No hay instrucciones adicionales.',
    ].join('\n\n');
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
        name: 'set_purchase_intent',
        description:
          'Guarda que la persona quiere comprar el producto o variante seleccionada.',
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

      if (name === 'set_purchase_intent') {
        return this.setPurchaseIntent(session);
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
    const clean = reply.trim();

    if (clean) {
      return clean;
    }

    return 'Cuéntame qué producto buscas y te ayudo a encontrarlo.';
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