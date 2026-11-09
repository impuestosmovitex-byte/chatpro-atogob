import { ChatAgentService } from './chat-agent.service';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

const profile = {
  name: 'Tienda de pruebas',
  slug: 'tienda-de-pruebas',
  settings: {},
  aiInstructions: 'Usa únicamente el catálogo real de esta empresa.',
} as any;

const session = {
  id: 'session-visual',
  companyId: 'tenant-visual',
  context: { conversation_category: 'sales' },
} as any;

const makeInput = (overrides: Record<string, unknown> = {}) => ({
  imageDataUrl: 'data:image/jpeg;base64,aW1hZ2Vu',
  customerText: '',
  summary: 'Blusa tipo corset con encaje y escote',
  productName: 'Blusa tipo corset',
  reference: '',
  visiblePrice: '',
  visibleText: '',
  category: 'blusa',
  colors: ['negro'],
  searchTerms: ['blusa corset', 'blusa de encaje'],
  ...overrides,
});

function agentHarness(products: Array<Record<string, unknown>>) {
  const agent = Object.create(ChatAgentService.prototype) as any;
  const searchProducts = jest.fn(async () => ({ ok: true, products }));
  const selectProductByName = jest.fn(async () => ({ ok: false }));
  const create = jest.fn(async () => ({
    output_text: '{"match_type":"none","candidate_index":null,"confidence":0.0,"reason":"No coincide"}',
  }));
  agent.searchProducts = searchProducts;
  agent.selectProductByName = selectProductByName;
  agent.getClient = () => ({ responses: { create } });
  agent.getModel = () => 'test-vision-model';
  return { agent, searchProducts, selectProductByName, create };
}

function webhookHarness() {
  return Object.create(WhatsappWebhookController.prototype) as any;
}

describe('MW1 visual sales context', () => {
  it('treats an uncaptioned product photo in an active sale as a product inquiry', () => {
    const controller = webhookHarness();
    expect(controller.shouldContinueVisualSalesInquiry({
      imageType: 'product',
      primaryIntent: 'clarify',
      hasProductIntent: false,
      hasPaymentIntent: false,
      conversationCategory: 'sales',
    })).toBe(true);
  });

  it('does not assume buying intent from a lone photo outside an active sale', () => {
    const controller = webhookHarness();
    expect(controller.shouldContinueVisualSalesInquiry({
      imageType: 'product',
      primaryIntent: 'clarify',
      hasProductIntent: false,
      hasPaymentIntent: false,
      conversationCategory: 'unclassified',
    })).toBe(false);
  });

  it.each([
    ['customer_service', 'product', false],
    ['validate_payment', 'product', false],
    ['add_or_review_product', 'payment_proof', true],
  ])('never turns a payment or service image into a new sale: %s', (
    primaryIntent, imageType, hasPaymentIntent,
  ) => {
    const controller = webhookHarness();
    expect(controller.shouldContinueVisualSalesInquiry({
      imageType,
      primaryIntent,
      hasProductIntent: true,
      hasPaymentIntent,
      conversationCategory: 'sales',
    })).toBe(false);
  });

  it('keeps an explicitly requested product analysis active even without a sales category', () => {
    const controller = webhookHarness();
    expect(controller.shouldContinueVisualSalesInquiry({
      imageType: 'product',
      primaryIntent: 'add_or_review_product',
      hasProductIntent: true,
      hasPaymentIntent: false,
      conversationCategory: 'unclassified',
    })).toBe(true);
  });

  it('offers real catalog options when product photos are absent, without inventing an exact match', async () => {
    const { agent, searchProducts, selectProductByName, create } = agentHarness([
      {
        id: 'p1', title: 'Blusa Corset de Encaje', url: 'https://tienda.ejemplo/products/blusa-encaje',
        price_from_cop: '59900',
      },
      {
        id: 'p2', title: 'Blusa Corset Manga Larga', url: 'https://tienda.ejemplo/products/corset-manga',
        price_from_cop: '67900',
      },
      {
        id: 'p3', title: 'Pantalón Deportivo Cargo', url: 'https://tienda.ejemplo/products/pantalon',
        price_from_cop: '89900',
      },
    ]);

    const result = await agent.matchIncomingVisualReference(profile, session, makeInput());
    expect(result.matchType).toBe('similar');
    expect(result.matchedProduct).toBeNull();
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.length).toBeLessThanOrEqual(3);
    expect(result.candidates.every((item: any) => item.title.includes('Corset'))).toBe(true);
    expect(result.reason).toMatch(/no se pudo confirmar/i);
    expect(searchProducts).toHaveBeenCalledWith(session, expect.any(String));
    expect(selectProductByName).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('does not replace an actual visual rejection with text-only suggestions', async () => {
    const { agent, create } = agentHarness([
      {
        id: 'p1', title: 'Blusa Corset de Encaje', url: 'https://tienda.ejemplo/products/blusa-encaje',
        image_url: 'https://tienda.ejemplo/corset.jpg',
      },
    ]);

    const result = await agent.matchIncomingVisualReference(profile, session, makeInput());
    expect(create).toHaveBeenCalled();
    expect(result.matchType).toBe('none');
    expect(result.candidates).toHaveLength(0);
  });

  it('can still confirm a uniquely named real product using catalog selection', async () => {
    const productName = 'Blusa Corset Manga Larga Encaje';
    const { agent, selectProductByName } = agentHarness([
      {
        id: 'p1', title: productName,
        url: 'https://tienda.ejemplo/products/blusa-corset',
        price_from_cop: '59900',
      },
    ]);
    selectProductByName.mockResolvedValue({ ok: true });

    const result = await agent.matchIncomingVisualReference(profile, session, makeInput({
      productName,
      searchTerms: [productName],
    }));
    expect(result.matchType).toBe('exact');
    expect(result.matchedProduct.title).toBe(productName);
    expect(selectProductByName).toHaveBeenCalledWith(session, productName);
  });

  it('does not offer arbitrary catalog products with no meaningful similarity', async () => {
    const { agent } = agentHarness([
      {
        id: 'unrelated',
        title: 'Pantalón Deportivo Cargo',
        url: 'https://tienda.ejemplo/products/pantalon',
      },
    ]);
    const result = await agent.matchIncomingVisualReference(profile, session, makeInput());
    expect(result.matchType).toBe('none');
    expect(result.matchedProduct).toBeNull();
    expect(result.candidates).toHaveLength(0);
  });

  it('does not show text-only options when there is no descriptive evidence', async () => {
    const { agent } = agentHarness([
      {
        id: 'p1',
        title: 'Blusa Tipo Corset',
        url: 'https://tienda.ejemplo/products/blusa',
      },
    ]);
    const result = await agent.matchIncomingVisualReference(profile, session, makeInput({
      productName: '', reference: '', visibleText: '', summary: '',
      searchTerms: [], category: 'blusa',
    }));
    expect(result.matchType).toBe('none');
    expect(result.matchedProduct).toBeNull();
    expect(result.candidates).toHaveLength(0);
  });
});

describe('MW1 continuous outfit sales and stalled-checkout safeguards', () => {
  function harness() {
    const agent = Object.create(ChatAgentService.prototype) as any;
    const requestHumanAttention = jest.fn(async () => ({ attentionStatus: 'waiting' }));
    agent.agentSessionRuntimeService = { requestHumanAttention };
    return { agent, requestHumanAttention };
  }

  const session = (context: Record<string, unknown>) => ({
    id: 'fictional-session',
    companyId: 'fictional-tenant',
    context,
  }) as any;

  it('keeps a real unfinished cart in Sales when the customer requests checkout', () => {
    const { agent } = harness();
    expect(agent.classifyConversationCategory(
      session({
        conversation_category: 'service',
        service_area: { areaType: 'service' },
        cart: [{ productTitle: 'Conjunto ficticio' }, { productTitle: 'Vestido ficticio' }],
      }),
      'Envíame el enlace de pago para finalizar compra',
      'other',
    )).toBe('sales');
  });

  it('does not resume shopping when there is real service evidence', () => {
    const { agent } = harness();
    expect(agent.classifyConversationCategory(
      session({
        conversation_category: 'service',
        cart: [{ productTitle: 'Blusa ficticia' }],
        last_service_evidence: { type: 'image' },
      }),
      'Quiero enlace de pago',
      'other',
    )).toBe('service');
  });

  it('never repeats confirmation after a checkout has already been accepted', async () => {
    const { agent, requestHumanAttention } = harness();
    const reply = await agent.stopCheckoutConfirmationLoop(
      session({ conversation_category: 'sales' }),
      'Sí por favor',
      '¿Confirmas que deseas cambiar a Ventas para generar el enlace de pago?',
      [{
        sender: 'assistant',
        message: '¿Quieres que te genere el enlace de pago para finalizar?',
      }],
    );
    expect(reply).toMatch(/asesor/i);
    expect(reply).not.toMatch(/confirmas|escribe comprar|cambiar a ventas/i);
    expect(requestHumanAttention).toHaveBeenCalledTimes(1);
  });

  it('does not trigger checkout-handoff during first-time product choice', async () => {
    const { agent, requestHumanAttention } = harness();
    const reply = await agent.stopCheckoutConfirmationLoop(
      session({ conversation_category: 'sales' }),
      '¿Cuánto vale el conjunto?',
      '¿Quieres el blazer o el conjunto completo?',
      [],
    );
    expect(reply).toBeNull();
    expect(requestHumanAttention).not.toHaveBeenCalled();
  });

  it('does not generate fake checkout when handoff cannot be confirmed', async () => {
    const { agent, requestHumanAttention } = harness();
    requestHumanAttention.mockRejectedValue(new Error('unavailable'));
    const reply = await agent.stopCheckoutConfirmationLoop(
      session({ conversation_category: 'sales' }),
      'Comprar',
      '¿Confirmas que quieres finalizar compra y recibir el enlace de pago?',
      [{
        sender: 'assistant',
        message: '¿Confirmas que deseas iniciar la compra?',
      }],
    );
    expect(reply).toMatch(/no pude completar|asesor/i);
    expect(reply).not.toMatch(/https:\/\//i);
  });

  it('gives every business the same verified multi-item sales instructions', () => {
    const { agent } = harness();
    agent.getCommercialFlowRules = jest.fn(() => '');
    agent.getKnowledgeBaseRules = jest.fn(() => '');
    agent.getShippingTrackingRules = jest.fn(() => '');
    agent.getClosingOfferRules = jest.fn(() => '');
    const prompt = agent.buildInstructions({
      name: 'Negocio ficticio',
      assistantName: 'Asesora',
      aiInstructions: '',
      settings: {},
    }, session({ conversation_category: 'sales' }), false);
    expect(prompt).toContain('FOTOGRAFÍAS DE OUTFITS');
    expect(prompt).toContain('CARRITO CONTINUO');
    expect(prompt).toContain('CUPONES');
    expect(prompt).toContain('no presentes un carrito parcial');
    expect(prompt).toContain('No vuelvas a preguntar si desea');
    expect(prompt).not.toContain('Blazer talla 8 + Falda talla 10');
  });
});

describe('MW1 multi-product purchase plan prevents incomplete checkout', () => {
  function fixture() {
    const blazer = 'https://tienda-ejemplo.com/products/conjunto-blazer-falda';
    const dress = 'https://tienda-ejemplo.com/products/vestido-negro';
    const pants = 'https://tienda-ejemplo.com/products/pantalon-cuadros';
    const session = {
      id: 'cart-plan-test',
      companyId: 'fictional-tenant',
      context: {
        conversation_category: 'sales',
        cart: [{ productUrl: dress, variantId: 'variant-dress' }],
        commercial_visual_references: [blazer, dress, pants].map((url) => ({
          match_type: 'exact',
          matched_product: { url, title: url },
        })),
      },
    } as any;
    const getCart = jest.fn(async () => ({
      ok: true,
      cart: {
        lines: [{
          product_url: dress,
          product_title: 'Vestido negro',
          variant_id: 'variant-dress',
          quantity: 1,
        }],
        items_count: 1,
        products_total_cop: '67900',
      },
    }));
    const createCheckoutLink = jest.fn(async () => ({
      ok: true, checkout_url: 'https://tienda-ejemplo.com/cart/one-product:1',
    }));
    const agent = Object.create(ChatAgentService.prototype) as any;
    agent.cartService = { getCart, createCheckoutLink };
    agent.agentSessionRuntimeService = {
      getSessionById: jest.fn(async () => session),
      updateSession: jest.fn(async (_id: string, patch: any) => {
        session.context = patch.context;
        return session;
      }),
    };
    return { agent, session, blazer, dress, pants, getCart, createCheckoutLink };
  }

  it('records all confirmed references using existing verified catalog evidence', async () => {
    const h = fixture();
    const result = await h.agent.recordPurchasePlan(
      h.session,
      { product_urls: [h.blazer, h.dress, h.pants] },
    );
    expect(result.ok).toBe(true);
    expect(result.expected_items_count).toBe(3);
    expect(h.session.context.sale_context.expected_purchase_handles)
      .toEqual(['conjunto-blazer-falda', 'vestido-negro', 'pantalon-cuadros']);
  });

  it('blocks a one-product checkout when three confirmed products were requested', async () => {
    const h = fixture();
    await h.agent.recordPurchasePlan(
      h.session,
      { product_urls: [h.blazer, h.dress, h.pants] },
    );
    const result = await h.agent.executeTool(
      'create_checkout_link', '{}', h.session,
    );
    expect(result.ok).toBe(false);
    expect(result.next_action).toBe('complete_confirmed_cart');
    expect(result.actual_cart_product_count).toBe(1);
    expect(result.missing_product_urls).toEqual([h.blazer, h.pants]);
    expect(h.createCheckoutLink).not.toHaveBeenCalled();
  });

  it('does not record invented unverified products from another shop', async () => {
    const h = fixture();
    const result = await h.agent.recordPurchasePlan(
      h.session,
      { product_urls: ['https://otra-tienda.com/products/inventado'] },
    );
    expect(result.ok).toBe(false);
    expect(result.next_action).toBe('verify_product_references');
    expect(h.session.context.sale_context).toBeUndefined();
  });

  it('allows updating the plan when the customer explicitly chooses one item', async () => {
    const h = fixture();
    const result = await h.agent.recordPurchasePlan(
      h.session, { product_urls: [h.dress] },
    );
    expect(result.expected_items_count).toBe(1);
    const guard = await h.agent.executeTool(
      'create_checkout_link', '{}', h.session,
    );
    // All expected articles exist, so checkout advances to shipping
    // verification; the missing-product safeguard no longer blocks it.
    expect(guard?.next_action).not.toBe('complete_confirmed_cart');
  });
});

describe('MW1 last-resort checkout continuation (never a confirmation loop)', () => {
  const ask = [{
    sender: 'assistant',
    message: '¿Quieres que genere el enlace de pago para finalizar?',
  }];

  it('finishes the already-confirmed cart using the real checkout action', async () => {
    const agent = Object.create(ChatAgentService.prototype) as any;
    const requestHumanAttention = jest.fn();
    const current = {
      id: 'verified-cart',
      context: {
        conversation_category: 'sales',
        sale_context: {
          expected_purchase_handles: ['conjunto', 'vestido', 'pantalon'],
        },
      },
    } as any;
    agent.agentSessionRuntimeService = {
      getSessionById: jest.fn(async () => current),
      requestHumanAttention,
    };
    agent.executeTool = jest.fn(async () => ({
      ok: true,
      checkout_url: 'https://tienda-ejemplo.com/cart/three-verified-products',
    }));
    const output = await agent.stopCheckoutConfirmationLoop(
      current,
      'Sí por favor',
      '¿Confirmas que quieres que genere el enlace de pago?',
      ask,
    );
    expect(output).toContain('https://tienda-ejemplo.com/cart/three-verified-products');
    expect(agent.executeTool).toHaveBeenCalledWith(
      'create_checkout_link', '{}', current,
    );
    expect(requestHumanAttention).not.toHaveBeenCalled();
  });

  it('asks only for genuinely missing delivery city when checkout says so', async () => {
    const agent = Object.create(ChatAgentService.prototype) as any;
    const requestHumanAttention = jest.fn();
    const current = {
      id: 'verified-cart',
      context: {
        conversation_category: 'sales',
        sale_context: {
          expected_purchase_handles: ['conjunto', 'vestido'],
        },
      },
    } as any;
    agent.agentSessionRuntimeService = {
      getSessionById: jest.fn(async () => current),
      requestHumanAttention,
    };
    agent.executeTool = jest.fn(async () => ({
      ok: false, next_action: 'ask_city',
    }));
    const output = await agent.stopCheckoutConfirmationLoop(
      current,
      'Sí por favor',
      '¿Confirmas que deseas finalizar la compra?',
      ask,
    );
    expect(output).toBe('¿Para qué ciudad sería el envío?');
    expect(requestHumanAttention).not.toHaveBeenCalled();
  });
});

describe('MW1 ask which piece of an outfit BEFORE searching', () => {
  const agent = Object.create(ChatAgentService.prototype) as any;

  it('asks which garment for an ambiguous two-piece outfit', () => {
    expect(agent.outfitClarificationForImage({
      summary: 'Fotografía de una blusa negra y un pantalón',
      category: 'conjunto',
      parts: ['Blusa negra', 'Pantalón beige'],
      caption: 'Hola, quiero información de estos productos',
    })).toBe(
      '¿Quieres información de la blusa, del pantalón o del conjunto completo?',
    );
  });

  it('does not interrupt after a clear choice of one garment', () => {
    expect(agent.outfitClarificationForImage({
      summary: 'Blusa y pantalón',
      category: 'outfit',
      parts: ['blusa', 'pantalón'],
      caption: 'Solo la blusa, por favor',
    })).toBeNull();
  });

  it('does not ask again if the customer requested the complete outfit', () => {
    expect(agent.outfitClarificationForImage({
      summary: 'Look combinado',
      category: 'conjunto',
      parts: ['falda', 'blazer'],
      caption: 'Quiero el conjunto completo',
    })).toBeNull();
  });

  it('does not turn ordinary single-product search terms into a combo', () => {
    expect(agent.outfitClarificationForImage({
      summary: 'Vestido negro',
      category: 'vestido',
      parts: ['Vestido corto'],
      searchTerms: ['negro', 'talla M', 'vestido'],
      caption: '¿Cuánto cuesta?',
    })).toBeNull();
  });

  it('asks a neutral question for an outfit without clear garment labels', () => {
    expect(agent.outfitClarificationForImage({
      summary: 'Look de dos prendas',
      category: 'outfit',
      parts: ['Parte superior', 'Parte inferior'],
      caption: '',
    })).toBe(
      '¿Quieres información del conjunto completo o de alguna prenda en particular?',
    );
  });
});

describe('MW1 resume Sales after a confirmed checkout in service area', () => {
  it('switches internally after Sí to a previously requested checkout', async () => {
    const agent = Object.create(ChatAgentService.prototype) as any;
    const session = {
      id: 'pending-checkout',
      context: {
        conversation_category: 'service',
        cart: [{ productTitle: 'Conjunto ficticio' }],
      },
    } as any;
    agent.getRecentMessages = jest.fn(async () => [
      { sender: 'customer', message: 'Quiero pagar' },
      { sender: 'assistant', message: '¿Confirmas que deseas finalizar y recibir el enlace?' },
    ]);
    agent.rememberConversationCategory = jest.fn(async (s: any) => ({
      ...s,
      context: { ...s.context, conversation_category: 'sales' },
    }));
    const updated = await agent.resumeCheckoutSalesIfConfirmed(session, 'Sí');
    expect(updated.context.conversation_category).toBe('sales');
    expect(agent.rememberConversationCategory).toHaveBeenCalledWith(
      session, 'sales',
    );
  });

  it('does not revive Sales when the client has a genuine pending service case', async () => {
    const agent = Object.create(ChatAgentService.prototype) as any;
    const session = {
      id: 'existing-service',
      context: {
        conversation_category: 'service',
        cart: [{ productTitle: 'Vestido anterior' }],
        last_service_evidence: { type: 'image' },
      },
    } as any;
    agent.getRecentMessages = jest.fn();
    const updated = await agent.resumeCheckoutSalesIfConfirmed(session, 'Sí');
    expect(updated).toBe(session);
    expect(agent.getRecentMessages).not.toHaveBeenCalled();
  });
});

describe('MW1 shorter exchange answers, validated free shipping, and Addi checkout', () => {
  const agent = Object.create(ChatAgentService.prototype) as any;

  it.each([
    'si no me quedan puedo hacer cambio de tallas?',
    '¿Hacen cambios de talla?',
    '¿Puedo cambiar el color?',
  ])('answers a preventive change question in one brief sentence (%s)', (message) => {
    const result = agent.configuredBriefExchangeReply(
      {
        name: 'Comercio ficticio',
        settings: { sales_short_change_answer: 'Sí 😊, puedes solicitar un cambio.' },
      },
      {
        id: 'session',
        context: { conversation_category: 'sales' },
      },
      message,
    );
    expect(result).toBe('Sí 😊, puedes solicitar un cambio.');
  });

  it('does not apply the rule to a different company without an approved short answer', () => {
    expect(agent.configuredBriefExchangeReply(
      { name: 'Academia Demo', settings: {} },
      { context: { conversation_category: 'sales' } },
      '¿Hacen cambios?',
    )).toBeNull();
  });

  it.each(['¿Cómo hago un cambio?', '¿Cuánto cuesta el cambio?', 'Ya compré y quiero un cambio'])(
    'does not hide a real post-sale procedure request: %s', (message) => {
      const result = agent.configuredBriefExchangeReply(
        { settings: { sales_short_change_answer: 'Sí, puedes solicitar un cambio.' } },
        { context: { conversation_category: 'sales' } },
        message,
      );
      expect(result).toBeNull();
    },
  );

  function shippingFixture(amount: string | number, quoteTotal: string) {
    const session = {
      id: 'shopper-demo',
      context: {
        conversation_category: 'sales',
        sale_context: {
          shipping_quote_validated: true,
          shipping_cost_cop: amount,
          shipping_quote_products_total_cop: quoteTotal,
          shipping_quote_city: 'Manizales',
          shipping_quote_payment_method: 'Addi',
          shipping_quote_delivery_method: 'shipping',
          delivery_method: 'shipping',
        },
      },
    } as any;
    const getSessionById = jest.fn(async () => session);
    const updateSession = jest.fn(async (_id: string, patch: any) => {
      session.context = patch.context;
      return session;
    });
    const getCart = jest.fn(async () => ({
      ok: true, cart: { products_total_cop: '239800' },
    }));
    const agent = Object.create(ChatAgentService.prototype) as any;
    agent.agentSessionRuntimeService = { getSessionById, updateSession };
    agent.cartService = { getCart };
    return { agent, session, getSessionById, updateSession, getCart };
  }

  it('announces zero-cost shipping once when the ACTUAL cart validates it', async () => {
    const h = shippingFixture('0', '239800');
    const first = await h.agent.appendVerifiedFreeShippingNotice(
      h.session, 'Ya tengo los tres productos listos.',
    );
    expect(first).toContain('🎉 ¡Felicitaciones! Tu envío ahora es gratis.');
    const second = await h.agent.appendVerifiedFreeShippingNotice(
      h.session, '¿Con qué medio de pago quieres finalizar?',
    );
    expect(second).toBe('¿Con qué medio de pago quieres finalizar?');
    expect(h.updateSession).toHaveBeenCalledTimes(1);
  });

  it('does not announce when shipping costs money', async () => {
    const h = shippingFixture('14900', '239800');
    expect(await h.agent.appendVerifiedFreeShippingNotice(
      h.session, 'Confirmado.',
    )).toBe('Confirmado.');
    expect(h.updateSession).not.toHaveBeenCalled();
  });

  it('does not announce when quote references an outdated subtotal', async () => {
    const h = shippingFixture('0', '99999');
    expect(await h.agent.appendVerifiedFreeShippingNotice(
      h.session, 'El carrito cambió.',
    )).toBe('El carrito cambió.');
    expect(h.updateSession).not.toHaveBeenCalled();
  });

  it('does not duplicate a true shipping-free statement in model text', async () => {
    const h = shippingFixture('0', '239800');
    const text = '¡Felicitaciones, tu envío es gratis!';
    expect(await h.agent.appendVerifiedFreeShippingNotice(h.session, text))
      .toBe(text);
    expect(h.updateSession).toHaveBeenCalledTimes(1);
  });

  it('does not insist on confirming a chosen payment if the customer said Sí pago con Addi', async () => {
    const agent = Object.create(ChatAgentService.prototype) as any;
    const session = {
      id: 'shopper-demo',
      context: {
        conversation_category: 'sales',
        sale_context: {
          expected_purchase_handles: ['conjunto', 'pantalon', 'vestido'],
        },
      },
    } as any;
    const requestHumanAttention = jest.fn();
    agent.agentSessionRuntimeService = {
      getSessionById: jest.fn(async () => session),
      requestHumanAttention,
    };
    agent.executeTool = jest.fn(async () => ({
      ok: true,
      checkout_url: 'https://tienda-ejemplo.com/cart/three-products-verified',
    }));
    const result = await agent.stopCheckoutConfirmationLoop(
      session,
      'Sí pago con Addi',
      'Perfecto, ¿confirmas que querés pagar con Addi y generar el enlace de pago?',
      [
        { sender: 'assistant', message: '¿Quieres que te envíe el enlace de pago para finalizar?' },
      ],
    );
    expect(result).toContain('https://tienda-ejemplo.com/cart/three-products-verified');
    expect(requestHumanAttention).not.toHaveBeenCalled();
  });
});

describe('MW1 colloquial yes to existing payment choice', () => {
  it('interprets Sí pagar por ahí as approval, not a request for another confirmation', async () => {
    const agent = Object.create(ChatAgentService.prototype) as any;
    const session = {
      id: 'checkout-payment-demo',
      context: {
        conversation_category: 'sales',
        sale_context: {
          payment_method: 'Addi',
          city: 'Manizales',
          expected_purchase_handles: ['enterizo', 'conjunto', 'pantalon'],
        },
      },
    } as any;
    const requestHumanAttention = jest.fn();
    agent.agentSessionRuntimeService = {
      getSessionById: jest.fn(async () => session),
      requestHumanAttention,
    };
    agent.executeTool = jest.fn(async () => ({
      ok: true,
      checkout_url: 'https://tienda-ejemplo.com/cart/verified-three',
    }));
    const reply = await agent.stopCheckoutConfirmationLoop(
      session,
      'Sí pagar por ahí',
      '¿Confirmas que quieres pagar con Addi y generar el enlace de pago ahora?',
      [{ sender: 'assistant', message: '¿Quieres que te mande el enlace para finalizar tu compra?' }],
    );
    expect(reply).toContain('https://tienda-ejemplo.com/cart/verified-three');
    expect(requestHumanAttention).not.toHaveBeenCalled();
  });
});
