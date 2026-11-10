import { ChatAgentService } from './chat-agent.service';
import { MetaSocialAiService } from './meta-social-ai.service';
import { MetaSocialMessageService } from './meta-social-message.service';

const companyWithPriority = {
  slug: 'another-brand',
  aiInstructions: 'Regla prioritaria: solicitudes económicas y cancelaciones expresas deben transferirse a un asesor, sin tramitar reembolso.',
  settings: {},
} as any;

function createSocialHarness() {
  const service = Object.create(MetaSocialMessageService.prototype) as any;
  const tasks: Promise<unknown>[] = [];
  const replyToMessenger = jest.fn(async () => undefined);
  const replyToMessengerImage = jest.fn(async () => undefined);
  const replyToInstagram = jest.fn(async () => undefined);
  const replyToInstagramImage = jest.fn(async () => undefined);
  service.socialAiService = {
    replyToMessenger,
    replyToMessengerImage,
    replyToInstagram,
    replyToInstagramImage,
  };
  service.companyIntegrationService = {
    findActiveIntegrationByExternalId: jest.fn(async () => ({
      companyId: 'tenant-A',
      credentialsEncrypted: 'encrypted-test-credentials',
      config: {},
    })),
  };
  service.saveIncomingMessengerMessage = jest.fn(async () => 'session-A');
  service.saveIncomingInstagramMessage = jest.fn(async () => 'session-A');
  service.latestSocialInbound = new Map();
  service.pendingSocialTexts = new Map();
  service.pendingMessengerImages = new Map();
  service.pendingInstagramImages = new Map();
  service.socialConversationQueues = new Map();
  service.waitForSocialQuietWindow = jest.fn(async () => true);
  service.enqueueSocialConversation = (_key: string, handler: () => Promise<void>) => {
    tasks.push(Promise.resolve().then(handler));
  };
  return { service, tasks, replyToMessenger, replyToMessengerImage, replyToInstagram, replyToInstagramImage };
}

function messengerBody(message: Record<string, unknown>) {
  return {
    object: 'page',
    entry: [{
      id: 'page-tenant-A',
      messaging: [{
        sender: { id: 'messenger-customer' },
        recipient: { id: 'page-tenant-A' },
        message: { mid: 'mid-1', ...message },
      }],
    }],
  };
}

function instagramBody(message: Record<string, unknown>) {
  return {
    object: 'instagram',
    entry: [{
      id: 'ig-tenant-A',
      messaging: [{
        sender: { id: 'instagram-customer' },
        recipient: { id: 'ig-tenant-A' },
        message: { mid: 'mid-2', ...message },
      }],
    }],
  };
}

describe('MW1 equal commercial AI behavior across WhatsApp, Instagram and Messenger', () => {
  it('uses company policy, not a fixed brand identifier', () => {
    const agent = Object.create(ChatAgentService.prototype) as any;
    expect(agent.companyRequiresEconomicHandoff(companyWithPriority)).toBe(true);
    expect(agent.companyRequiresEconomicHandoff({
      slug: 'unrelated-business',
      aiInstructions: 'Ayuda a clientes con compras y clases.',
      settings: {},
    })).toBe(false);
  });

  it('keeps the sale active for a general shipping question', () => {
    const agent = Object.create(ChatAgentService.prototype) as any;
    const session = {
      context: { conversation_category: 'sales' },
    } as any;
    expect(agent.classifyConversationCategory(
      session,
      '¿Cuánto demora en llegar mi pedido?',
      'other',
    )).toBe('sales');
    expect(agent.classifyConversationCategory(
      session,
      '¿Dónde está mi pedido 45999?',
      'other',
    )).toBe('service');
  });

  it('sends a Messenger photograph with its caption to shared visual AI', async () => {
    const h = createSocialHarness();
    await h.service.processMessengerWebhook(messengerBody({
      text: '¿Qué precio tiene esta blusa?',
      attachments: [{ type: 'image', payload: { url: 'https://example.org/product.jpg' } }],
    }));
    await Promise.all(h.tasks);
    expect(h.replyToMessengerImage).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 'tenant-A',
      pageId: 'page-tenant-A',
      recipientId: 'messenger-customer',
      mediaUrl: 'https://example.org/product.jpg',
      caption: '¿Qué precio tiene esta blusa?',
    }));
    expect(h.replyToMessenger).not.toHaveBeenCalled();
  });

  it('sends an Instagram photograph with its caption to shared visual AI', async () => {
    const h = createSocialHarness();
    await h.service.processInstagramWebhook(instagramBody({
      text: '¿Tienen este color?',
      attachments: [{ type: 'image', payload: { url: 'https://example.org/instagram.jpg' } }],
    }));
    await Promise.all(h.tasks);
    expect(h.replyToInstagramImage).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 'tenant-A',
      instagramId: 'ig-tenant-A',
      recipientId: 'instagram-customer',
      mediaUrl: 'https://example.org/instagram.jpg',
      caption: '¿Tienen este color?',
    }));
    expect(h.replyToInstagram).not.toHaveBeenCalled();
  });

  it.each(['messenger', 'instagram'])('still routes %s text to the commercial agent', async (channel) => {
    const h = createSocialHarness();
    const message = { text: '¿Hacen cambios?' };
    if (channel === 'messenger') {
      await h.service.processMessengerWebhook(messengerBody(message));
    } else {
      await h.service.processInstagramWebhook(instagramBody(message));
    }
    await Promise.all(h.tasks);
    const spy = channel === 'messenger' ? h.replyToMessenger : h.replyToInstagram;
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 'tenant-A',
      customerMessage: '¿Hacen cambios?',
    }));
  });

  it('uses the correct Meta delivery channel for Messenger image responses', async () => {
    const ai = Object.create(MetaSocialAiService.prototype) as any;
    const spy = jest.fn(async () => undefined);
    ai.replyToInstagramImage = spy;
    await ai.replyToMessengerImage({
      companyId: 'tenant-A',
      pageId: 'page-tenant-A',
      sessionId: 'session-A',
      recipientId: 'messenger-customer',
      mediaUrl: 'https://example.org/product.jpg',
      credentialsEncrypted: 'encrypted-test-credentials',
    });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'messenger',
      instagramId: 'page-tenant-A',
      companyId: 'tenant-A',
    }));
  });

  it.each([
    ['sales', 'product', 'clarify', false, true],
    ['service', 'product', 'add_or_review_product', true, false],
    ['sales', 'warranty_or_return', 'customer_service', true, false],
    ['sales', 'product', 'customer_service', true, false],
  ])('does not mix sales with service evidence (%s, %s, %s)', (
    category, imageType, primaryIntent, expectedEvidence, expectedInquiry,
  ) => {
    const ai = Object.create(MetaSocialAiService.prototype) as any;
    const result = ai.classifySocialImagePurpose({
      context: { conversation_category: category },
      imageType,
      primaryIntent,
      hasProductIntent: false,
      hasPaymentIntent: false,
    });
    expect(result.isServiceEvidence).toBe(expectedEvidence);
    expect(result.productInquiry).toBe(expectedInquiry);
  });

  it('never treats a payment receipt as a new product inquiry', () => {
    const ai = Object.create(MetaSocialAiService.prototype) as any;
    expect(ai.classifySocialImagePurpose({
      context: { conversation_category: 'sales' },
      imageType: 'payment_proof',
      primaryIntent: 'validate_payment',
      hasProductIntent: true,
      hasPaymentIntent: true,
    })).toEqual({ isServiceEvidence: false, productInquiry: false });
  });
});
