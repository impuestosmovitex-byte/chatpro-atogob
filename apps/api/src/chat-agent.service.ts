import { CartService } from './cart.service';
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
    let activeSession = session;

    // La atención principal ya recibe las reglas de alcance y comprensión
    // dentro de buildInstructions. Evitamos dos llamadas previas de IA por mensaje
    // para mantener respuestas rápidas y no afectar carrito ni recuperación.
    const currentIntent = await this.classifyCurrentIntent(
      profile,
      activeSession,
      customerMessage,
    );

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

    const collections = await this.getCollectionsForSession(session);
    const recoveryContext = this.getActiveRecoveryContext(
      activeSession.context,
    );
    const contextStatus = this.getContextStatus(profile, activeSession);
    const history = contextStatus.is_within_context_window
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

    for (let turn = 0; turn < 6; turn += 1) {
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
        return this.cleanReply(response.output_text);
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

    return 'Estoy revisando la información para ayudarte. Cuéntame qué necesitas y lo revisamos.';
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
      '- Las INSTRUCCIONES ESPECÍFICAS DE LA EMPRESA tienen prioridad y definen cómo conversar y vender.',
      '- Conversa de manera natural; no uses formularios ni secuencias rígidas de preguntas.',
      '- Entiende mensajes cortos, cambios de idea, errores de escritura y referencias como “esta”, “la lila”, “sí”, “dale”, “mejor no” o “quiero otra”.',
      '- Conserva el carrito real aunque la persona mire otro producto.',
      '- Pregunta solo por el dato que falte. No repitas ciudad, color, talla o medio de pago ya informado.',
      '',
      'USO DE HERRAMIENTAS:',
      '- Consulta productos, colecciones, variantes y carrito con las herramientas antes de dar datos definitivos.',
      '- Cuando la persona comparta un enlace de producto, selecciónalo con select_product_by_url y responde usando sus datos reales.',
      '- Cuando pida una categoría amplia, usa open_collection o search_products según corresponda.',
      '- Cuando la persona confirme claramente una variante, valida con select_variant y agrega de inmediato con add_selected_variant_to_cart.',
      '- En venta al detal, si no indica cantidad, usa 1.',
      '- No preguntes “¿lo agrego?” después de que la persona ya confirmó color, talla o variante.',
      '- Antes de crear checkout, sigue las instrucciones de la empresa: pide solo los datos que falten, confirma ciudad, envío, medio de pago y resumen.',
      '- Usa create_checkout_link únicamente cuando la persona confirme que desea finalizar la compra.',
      '- Cuando create_checkout_link devuelva checkout_url, comparte únicamente ese checkout_url para finalizar el pago. Nunca sustituyas ese enlace por un cart_url.',
      '- Cuando las INSTRUCCIONES ESPECÍFICAS DE LA EMPRESA indiquen pasar el caso a un asesor, responde con el mensaje y tono definido por esa empresa y luego usa request_human_attention. No continúes atendiendo como IA después de transferir.',
      '- La conversación puede tener session.context.service_area con el área elegida por la persona. Respeta esa área al atender y no la cambies por tu cuenta.',
      '- Atiende primero el caso con la información disponible. Usa request_human_attention solo cuando la persona pida un asesor, no puedas entender o resolver, falte información operativa, o las instrucciones específicas indiquen escalar.',
      '- REGLA DE COMPRENSIÓN: no transfieras por un solo mensaje ambiguo. Pide una aclaración breve y concreta. Si después de esa aclaración la persona sigue sin permitir entender o resolver el caso, usa request_human_attention. No supongas que un número, documento, teléfono, talla, referencia, enlace o dato corto es incorrecto: interprétalo usando el contexto o pide aclaración.',
      '- Al transferir usa request_human_attention con un resumen interno MUY CORTO, máximo 3 líneas o 450 caracteres. Incluye solo: motivo de transferencia, qué necesita el cliente y el dato pendiente principal. No copies ni resumas todo el historial, carrito completo, precios ni mensajes anteriores; el asesor puede leer la conversación.',
      '',
      'CONFIGURACIÓN COMERCIAL ESTRUCTURADA:',
      commercialRules,
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

    return lines.length
      ? lines.join('\n')
      : '- No hay reglas comerciales estructuradas. Usa únicamente las instrucciones adicionales configuradas por la empresa.';
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

      return updated.attentionStatus === 'human'
        ? 'Para ayudarte mejor, te voy a comunicar con un asesor.'
        : 'Para ayudarte mejor, dejé tu solicitud pendiente para que un asesor la revise.';
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
    },
    required: ['reason', 'summary'],
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
        return this.cartService.addSelectedVariant(
          session,
          this.readInteger(args, 'quantity'),
        );
      }

      if (name === 'replace_cart_line_variant') {
        return this.cartService.replaceCartLineWithSelectedVariant(
          session,
          this.readString(args, 'current_variant_id'),
          this.readInteger(args, 'quantity'),
        );
      }

      if (name === 'set_cart_line_quantity') {
        return this.cartService.setCartLineQuantity(
          session,
          this.readString(args, 'variant_id'),
          this.readInteger(args, 'quantity'),
        );
      }

      if (name === 'remove_cart_line') {
        return this.cartService.removeCartLine(
          session,
          this.readString(args, 'variant_id'),
        );
      }

      if (name === 'get_cart') {
        return this.cartService.getCart(session);
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

        const customerMessage =
          updatedSession.attentionStatus === 'human'
            ? 'Listo, te voy a comunicar con un asesor para que te ayude.'
            : handoffStatus === 'waiting_outside_hours'
              ? 'Nuestro equipo te atenderá dentro del horario de atención. Mientras tanto, puedo ayudarte con productos, tallas, envíos y pagos.'
              : handoffStatus === 'waiting_no_advisor'
                ? 'En este momento todos nuestros asesores están ocupados. Dejé tu solicitud pendiente para que te atiendan apenas estén disponibles.'
                : 'Dejé tu solicitud pendiente para que un asesor la revise y te responda lo antes posible.';

        return {
          ok: true,
          attention_status: updatedSession.attentionStatus,
          assigned_to_name: updatedSession.assignedToName,
          assigned: updatedSession.attentionStatus === 'human',
          customer_message: customerMessage,
        };
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
    if (await this.usesCompanyCommerce(session)) {
      return {
        ok: false,
        error:
          'Las colecciones todavía no están disponibles para esta tienda. Busca el producto por nombre.',
      };
    }

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
      return [];
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

  private cleanReply(reply: string): string {
    const clean = this.removeInternalBlocks(reply)
      .replace(/\bto=functions\.[a-z0-9_.-]+\s*/gi, '')
      .replace(/\bfunctions\.[a-z0-9_.-]+\s*/gi, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (!clean || this.isUnsafeModelReply(clean)) {
      return 'Estoy revisando la información para ayudarte. Cuéntame un poco más de lo que necesitas.';
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
