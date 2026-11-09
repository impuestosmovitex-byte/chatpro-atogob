import { WhatsappWebhookController } from './whatsapp-webhook.controller';

const makeSession = (context: Record<string, unknown> = {}) => ({
  id: 'session-test',
  companyId: 'company-test',
  customerPhone: '573001234567',
  context,
}) as any;

function harness(lookupResult: Record<string, unknown>) {
  const controller = Object.create(WhatsappWebhookController.prototype) as any;
  const updateSession = jest.fn(async (_id: string, _patch: Record<string, unknown>) => undefined);
  const lookup = jest.fn(async () => lookupResult);
  const requestHuman = jest.fn(async () => 'Se necesita un asesor');

  controller.conversationMemoryService = { updateSession };
  controller.customerOrderService = { lookup };
  controller.formatOrderLookupReply = jest.fn(async () => 'El pedido está confirmado 😊');
  controller.requestCustomerServiceHuman = requestHuman;
  controller.resolveDirectServiceAreaChoice = jest.fn(async () => null);
  controller.classifyPendingOrderLookupIntent = jest.fn(async () => 'unclear');
  return { controller, updateSession, lookup, requestHuman };
}

const order = { id: 'gid://shopify/Order/1001', name: '#45999' };

describe('WhatsApp order lookup continuity and privacy', () => {
  it('reuses the WhatsApp number when the client supplies an order reference', async () => {
    const h = harness({ ok: true, found: true, orders: [order] });
    const reply = await h.controller.resolveOrderLookup(
      makeSession(), 'Mi pedido es #45999', { type: 'order_lookup', identifiers: {}, attempts: 0 },
    );
    expect(reply).toContain('confirmado');
    expect(h.lookup).toHaveBeenCalledWith('company-test', expect.objectContaining({
      orderReference: '45999', phone: '573001234567',
    }));
    const stored = h.updateSession.mock.calls.at(-1)?.[1]?.context?.validated_order_lookup;
    expect(stored?.identifiers).toEqual(expect.objectContaining({
      orderReference: '45999', phone: '573001234567',
    }));
    expect(h.requestHuman).not.toHaveBeenCalled();
  });

  it('reuses WhatsApp to verify an email without asking for a phone again', async () => {
    const h = harness({ ok: true, found: true, orders: [order] });
    await h.controller.resolveOrderLookup(
      makeSession(), 'Mi correo es cliente@ejemplo.com',
      { type: 'order_lookup', identifiers: {}, attempts: 0 },
    );
    expect(h.lookup).toHaveBeenCalledWith('company-test', expect.objectContaining({
      email: 'cliente@ejemplo.com', phone: '573001234567',
    }));
    const stored = h.updateSession.mock.calls.at(-1)?.[1]?.context?.validated_order_lookup;
    expect(stored?.identifiers.phone).toBe('573001234567');
  });

  it('revalidates the same order on a follow-up using both verified identifiers', async () => {
    const h = harness({ ok: true, found: true, orders: [order] });
    const flow = {
      type: 'order_lookup_confirm_previous', order_id: order.id, order_name: order.name,
      identifiers: { orderReference: '45999', phone: '573001234567' },
    };
    const reply = await h.controller.resolveValidatedOrderConfirmation(
      makeSession(), '¿Y la guía?', flow, false,
    );
    expect(reply).toContain('confirmado');
    expect(h.lookup).toHaveBeenCalledWith('company-test', expect.objectContaining({
      orderReference: '45999', phone: '573001234567',
    }));
    expect(h.requestHuman).not.toHaveBeenCalled();
  });

  it('asks for the order reference instead of transferring when email and phone are insufficient', async () => {
    const h = harness({
      ok: true, found: false, requires_verification: true,
      next_action: 'ask_alternate_identifier', orders: [],
    });
    const reply = await h.controller.resolveOrderLookup(
      makeSession(), 'cliente@ejemplo.com',
      {
        type: 'order_lookup',
        identifiers: { phone: '3005551111' },
        attempts: 1,
      },
    );
    expect(reply).toMatch(/número de pedido/i);
    expect(h.requestHuman).not.toHaveBeenCalled();
    expect(h.updateSession).toHaveBeenCalled();
  });

  it('does not ask for the unavailable order number after both other identifiers fail', async () => {
    const h = harness({
      ok: true, found: false, next_action: 'ask_alternate_identifier', orders: [],
    });
    const reply = await h.controller.resolveOrderLookup(
      makeSession(), 'cliente@ejemplo.com',
      {
        type: 'order_lookup',
        identifiers: { phone: '3005551111' },
        attempts: 1,
        order_reference_unavailable: true,
      },
    );
    expect(reply).toContain('asesor');
    expect(h.requestHuman).toHaveBeenCalledTimes(1);
  });

  it('does not loop after email and phone were already tried and the client has no order number', async () => {
    const h = harness({ ok: true, found: false, orders: [] });
    const flow = {
      type: 'order_lookup',
      identifiers: { email: 'cliente@ejemplo.com', phone: '3005551111' },
      attempts: 2,
    };
    const reply = await h.controller.resolveCustomerServiceReply(
      { name: 'Tienda' } as any, [], makeSession({ customer_service_flow: flow }),
      'no tengo número de pedido', 'No tengo número de pedido',
    );
    expect(reply).toContain('asesor');
    expect(h.requestHuman).toHaveBeenCalledTimes(1);
    expect(h.lookup).not.toHaveBeenCalled();
  });

  it('never treats an unverified WhatsApp number as an authenticated identifier', async () => {
    const h = harness({
      ok: true, found: false, requires_verification: true,
      next_action: 'ask_alternate_identifier', orders: [],
    });
    const reply = await h.controller.resolveOrderLookup(
      makeSession(), 'Mi pedido es #45999',
      { type: 'order_lookup', identifiers: {}, attempts: 0 },
    );
    expect(reply).toMatch(/correo|celular/i);
    expect(h.updateSession.mock.calls.at(-1)?.[1]?.context?.validated_order_lookup)
      .toBeUndefined();
    expect(h.updateSession.mock.calls.at(-1)?.[1]?.context?.customer_service_flow?.identifiers)
      .toEqual({ orderReference: '45999', email: '', phone: '' });
    expect(h.requestHuman).not.toHaveBeenCalled();
  });
});

describe('WhatsApp return inquiry bypass protection', () => {
  it('transfers before order lookup or area routing can explain a policy', async () => {
    const controller = Object.create(WhatsappWebhookController.prototype) as any;
    const handoff = jest.fn(async () => 'Te voy a comunicar con uno de nuestros asesores.');
    const listActiveServiceAreas = jest.fn(async () => {
      throw new Error('Service area routing must not run before handoff');
    });
    controller.chatAgentService = { routeReturnInquiryToHuman: handoff };
    controller.conversationMemoryService = { listActiveServiceAreas };
    const profile = {
      id: 'company-test',
      settings: { return_inquiry_handoff_policy: 'required' },
    } as any;
    const reply = await controller.resolveReply(
      profile, makeSession({ customer_service_flow: { type: 'order_lookup' } }),
      '¿Hacen devoluciones?',
    );
    expect(reply).toContain('asesores');
    expect(handoff).toHaveBeenCalledTimes(1);
    expect(listActiveServiceAreas).not.toHaveBeenCalled();
  });
});

describe('WhatsApp caption return requests', () => {
  it('transfers a photograph caption without running vision, catalog or policy explanations', async () => {
    const controller = Object.create(WhatsappWebhookController.prototype) as any;
    const session = {
      ...makeSession({ conversation_category: 'sales' }),
      attentionStatus: 'ai',
    };
    const profile = {
      id: 'company-test',
      settings: { return_inquiry_handoff_policy: 'required' },
    };
    const routeHandoff = jest.fn(async () =>
      'Te voy a comunicar con uno de nuestros asesores.');
    const saveMessage = jest.fn(async () => 'saved');
    const classifyIncomingImageIntent = jest.fn(() => {
      throw new Error('Vision must not run for return captions');
    });
    const sendText = jest.fn(async () => ({ messageId: 'out-1' }));
    controller.companyIntegrationService = {
      findActiveIntegrationByExternalId: jest.fn(async () => ({
        companyId: 'company-test',
      })),
    };
    controller.chatAgentService = {
      prepareSessionForIncomingActivity: jest.fn(async () => session),
      routeReturnInquiryToHuman: routeHandoff,
    };
    controller.conversationMemoryService = {
      getCompanyProfileById: jest.fn(async () => profile),
      getOrCreateSessionByCompanyId: jest.fn(async () => session),
      saveMessage,
      touchSession: jest.fn(async () => undefined),
      persistIncomingMedia: jest.fn(async () => undefined),
    };
    controller.whatsappMessagingService = {
      downloadRawMedia: jest.fn(async () => ({
        buffer: Buffer.from('fake-image'),
        mimeType: 'image/jpeg',
      })),
      sendText,
    };
    controller.attachRecoveryContext = jest.fn(async () => session);
    controller.classifyIncomingImageIntent = classifyIncomingImageIntent;

    await controller.processIncomingImage({
      incomingPhoneNumberId: 'phone-number-id',
      phone: '573001234567',
      incomingMessageId: 'message-id',
      replyToProviderMessageId: null,
      mediaId: 'media-id',
      mimeType: 'image/jpeg',
      caption: 'Quiero una devolución',
      burstId: 'burst-test',
    });

    expect(routeHandoff).toHaveBeenCalledWith(
      profile, session, 'Quiero una devolución',
    );
    expect(classifyIncomingImageIntent).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(
      'company-test', '573001234567',
      'Te voy a comunicar con uno de nuestros asesores.',
    );
    expect(saveMessage).toHaveBeenCalledWith(expect.objectContaining({
      sender: 'assistant',
      message: 'Te voy a comunicar con uno de nuestros asesores.',
    }));
  });
});

describe('MW1 automatic payment template must transfer to advisor, never create a new cart', () => {
  function fixture(action: string, templateButton = true) {
    const webhook = Object.create(WhatsappWebhookController.prototype) as any;
    const session: any = {
      id: 'fictional-session', companyId: 'fictional-company',
      stage: 'active', attentionStatus: 'ai',
      context: { cart: [], conversation_category: 'sales' },
    };
    const handoff = jest.fn(async () => {
      session.attentionStatus = 'waiting';
      return 'Perfecto 😊 Te voy a comunicar con uno de nuestros asesores para finalizar el proceso.';
    });
    const ai = jest.fn(async () => { throw Error('IA de carrito no debe intervenir'); });
    const sendText = jest.fn(async () => ({ messageId: 'wamid.sent-confirmed' }));
    const saveMessage = jest.fn(async (message: any) => message.sender === 'customer' ? 'saved' : 'saved');
    webhook.companyIntegrationService = {
      findActiveIntegrationByExternalId: jest.fn(async () => ({
        companyId: 'fictional-company',
      })),
    };
    webhook.conversationMemoryService = {
      getCompanyProfileById: jest.fn(async () => ({ id: 'fictional-company' })),
      getOrCreateSessionByCompanyId: jest.fn(async () => session),
      saveMessage,
      touchSession: jest.fn(async () => undefined),
      updateSession: jest.fn(async (_id: string, patch: any) => {
        session.stage = patch.stage ?? session.stage;
        if (patch.context) session.context = patch.context;
        return session;
      }),
    };
    webhook.automationRuntimeService = {
      findByProviderMessageId: jest.fn(async () => ({
        eventKey: 'payment_pending', automationKey: 'pending_payment',
        payload: { order_id: 'fictional-order' },
      })),
    };
    webhook.whatsappTemplateExecutionService = {
      resolveButtonAction: jest.fn(async () => ({
        action,
        buttonText: 'Completar pago',
        eventKey: 'payment_pending',
      })),
    };
    webhook.whatsappMessagingService = { sendText };
    webhook.requestCustomerServiceHuman = handoff;
    webhook.resolveReply = ai;
    webhook.attachRecoveryContext = jest.fn(async () => session);
    webhook.waitForInboundQuietWindow = jest.fn(async () => true);
    webhook.isCurrentInboundMessage = jest.fn(() => true);
    return { webhook, session, sendText, handoff, ai, saveMessage, templateButton };
  }

  it.each(['request_human_agent', 'continue_payment'])(
    'button "Completar pago" with action %s hands off without invoking IA',
    async (action) => {
      const h = fixture(action);
      await h.webhook.processIncomingText({
        incomingPhoneNumberId: 'fictional-phone-id',
        phone: '573001234567',
        text: 'Completar pago',
        incomingMessageId: 'wamid.customer-1',
        replyToProviderMessageId: 'wamid.template-1',
        suppressReply: false,
        templateButton: true,
      });
      expect(h.handoff).toHaveBeenCalledTimes(1);
      expect(h.ai).not.toHaveBeenCalled();
      expect(h.sendText).toHaveBeenCalledWith(
        'fictional-company', '573001234567',
        expect.stringMatching(/asesor/i),
      );
      expect(h.session.attentionStatus).toBe('waiting');
      expect(h.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
        sender: 'assistant',
        providerMessageId: 'wamid.sent-confirmed',
      }));
    },
  );

  it('also resolves the configured action when Meta surfaces the response as text', async () => {
    const h = fixture('request_human_agent', false);
    await h.webhook.processIncomingText({
      incomingPhoneNumberId: 'fictional-phone-id',
      phone: '573001234567',
      text: 'Completar pago',
      incomingMessageId: 'wamid.customer-2',
      replyToProviderMessageId: null,
      suppressReply: false,
      templateButton: false,
    });
    expect(h.handoff).toHaveBeenCalledTimes(1);
    expect(h.ai).not.toHaveBeenCalled();
  });

  it('does not reactivate IA when the customer follows up with Sí after handoff', async () => {
    const h = fixture('request_human_agent');
    h.session.attentionStatus = 'waiting';
    await h.webhook.processIncomingText({
      incomingPhoneNumberId: 'fictional-phone-id',
      phone: '573001234567',
      text: 'si',
      incomingMessageId: 'wamid.customer-3',
      replyToProviderMessageId: null,
      suppressReply: false,
      templateButton: false,
    });
    expect(h.ai).not.toHaveBeenCalled();
    expect(h.handoff).not.toHaveBeenCalled();
  });
});
