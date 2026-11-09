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
