/**
 * Offline multi-turn tests run REAL MW1 route/agent/social methods.
 * OpenAI text and Meta provider I/O are scripted. These tests check state,
 * tenant isolation and handoff; they do not evaluate real LLM quality.
 */
import { ChatAgentService } from './chat-agent.service';
import { MetaSocialAiService } from './meta-social-ai.service';

type Channel = 'whatsapp' | 'instagram' | 'messenger';
type DemoSession = {
  id: string;
  companyId: string;
  customerPhone: string;
  stage: string;
  context: Record<string, unknown>;
  attentionStatus: 'ai' | 'waiting' | 'human';
};

const profiles: Record<string, any> = {
  fashion: {
    slug: 'demo-fashion', name: 'Moda Demo', assistantName: 'Sofia',
    aiInstructions: 'REGLA PRIORITARIA: SOLICITUDES ECONOMICAS Y CANCELACIONES EXPRESAS. Reembolsos y cancelar pedidos deben transferirse al asesor.',
    settings: {
      economic_handoff_policy: 'required',
      knowledge_base: { exchanges_returns: 'Hacemos cambios según las condiciones del producto.' },
      commercial_flow: { shipping_instructions: 'El 90% de los pedidos se despacha entre 24 y 72 horas hábiles.' },
    },
  },
  education: {
    slug: 'demo-education', name: 'Cursos Demo', assistantName: 'Asesor',
    aiInstructions: 'Atiende solo cursos.',
    settings: { economic_handoff_policy: 'disabled' },
  },
};

function makeSimulation() {
  const sessions = new Map<string, DemoSession>();
  const socialRows = new Map<string, { id: string; company_id: string; attention_status: string }>();
  const deliveries: Array<{ channel: Channel; companyId: string; message: string }> = [];
  const handoffs = jest.fn();
  const model = jest.fn(async (req: any) => {
    if (typeof req.input === 'string') {
      const classification = JSON.parse(req.input) as { customer_message?: string };
      const message = (classification.customer_message || '').toLowerCase();
      return {
        output_text: JSON.stringify({
          explicit_request: message.includes('quiero cancelar mi pedido'),
        }),
        output: [],
      };
    }
    const envelope = JSON.parse(req.input[0].content) as {
      company: { name: string }; current_customer_message: string;
    };
    const text = envelope.current_customer_message.toLowerCase();
    const fashion = envelope.company.name === 'Moda Demo';
    const answer = text.includes('hacen cambios')
      ? (fashion ? 'Claro que sí, hacemos cambios según las condiciones del producto.' : 'Atendemos consultas de cursos.')
      : text.includes('demora') || text.includes('tarda')
        ? (fashion ? 'El 90% de los pedidos se despacha entre 24 y 72 horas hábiles.' : 'Te informo los tiempos de acceso a tu curso.')
        : text.includes('blusa')
          ? (fashion ? '¿Qué talla buscas?' : 'Nuestra empresa vende cursos, no prendas.')
          : (fashion ? '¿En qué más puedo ayudarte?' : '¿Qué deseas aprender?');
    return { output_text: answer, output: [] };
  });

  const agent = Object.create(ChatAgentService.prototype) as any;
  agent.getContextStatus = () => ({ is_within_context_window: true });
  agent.prepareSessionForIncomingActivity = jest.fn(async (_p: unknown, s: DemoSession) => s);
  agent.resolveMessageRouting = jest.fn(async () => ({
    messageOrigin: 'customer', source: 'offline', understanding: 'clear', intent: 'other',
  }));
  agent.applyMessageUnderstanding = jest.fn(async () => null);
  agent.rememberConversationCategory = jest.fn(async (s: DemoSession, cat: string) => {
    s.context.conversation_category = cat; return s;
  });
  agent.getCollectionsForSession = jest.fn(async () => []);
  agent.getActiveRecoveryContext = () => null;
  agent.getRecentMessages = jest.fn(async () => []);
  agent.getModel = () => 'offline-demo';
  agent.getClient = () => ({ responses: { create: model } });
  agent.getTools = () => [];
  agent.buildInstructions = (p: any) => p.aiInstructions;
  agent.recordStagingAiUsage = jest.fn(async () => undefined);
  agent.clearTechnicalFailureState = jest.fn(async () => undefined);
  agent.enforceSalesReply = jest.fn(async (_s: unknown, answer: string) => answer);
  agent.agentSessionRuntimeService = {
    getSessionById: jest.fn(async (id: string) => sessions.get(id)),
    requestHumanAttention: jest.fn(async (id: string) => {
      const s = sessions.get(id);
      if (!s) throw Error('Invalid simulated session');
      s.attentionStatus = 'waiting';
      const socialRow = socialRows.get(id);
      if (socialRow) socialRow.attention_status = 'waiting';
      handoffs(id);
      return s;
    }),
    updateSession: jest.fn(async (id: string, patch: any) => {
      const s = sessions.get(id);
      if (!s) throw Error('Invalid simulated session');
      if (patch.context) s.context = patch.context;
      if (patch.stage) s.stage = patch.stage;
      return s;
    }),
  };

  function newSession(channel: Channel, tenant: 'fashion' | 'education', customer: string) {
    const id = [channel, tenant, customer].join(':');
    const s: DemoSession = {
      id, companyId: tenant,
      customerPhone: channel === 'whatsapp' ? '573001234567' : channel + ':' + customer,
      stage: 'sales', context: { channel, conversation_category: 'sales' },
      attentionStatus: 'ai',
    };
    sessions.set(id, s);
    if (channel !== 'whatsapp') {
      socialRows.set(id, { id, company_id: tenant, attention_status: 'ai' });
    }
    return s;
  }

  const from = jest.fn((table: string) => {
    const filters: Record<string, unknown> = {};
    const builder: any = {
      select: () => builder,
      eq: (key: string, value: unknown) => { filters[key] = value; return builder; },
      maybeSingle: async () => {
        const row = table === 'social_conversation_sessions'
          ? socialRows.get(String(filters.id)) : null;
        return {
          data: row && row.company_id === filters.company_id ? row : null,
          error: null,
        };
      },
      insert: async () => ({ error: null }),
      update: () => builder,
      then: (resolve: (value: any) => unknown) =>
        Promise.resolve({ error: null }).then(resolve),
    };
    return builder;
  });
  const social = Object.create(MetaSocialAiService.prototype) as any;
  social.supabaseService = { getClient: () => ({ from }) };
  social.conversationMemoryService = {
    getCompanyProfileById: async (id: string) => profiles[id],
  };
  social.agentSessionRuntimeService = agent.agentSessionRuntimeService;
  social.chatAgentService = agent;
  social.sendInstagramText = jest.fn(async (input: any) => {
    deliveries.push({ channel: 'instagram', companyId: input.recipientId.split(':')[1], message: input.text });
    return 'offline-meta-message';
  });
  social.sendMessengerText = jest.fn(async (input: any) => {
    deliveries.push({ channel: 'messenger', companyId: input.recipientId.split(':')[1], message: input.text });
    return 'offline-meta-message';
  });
  async function send(channel: Channel, session: DemoSession, text: string) {
    if (channel === 'whatsapp') {
      if (session.attentionStatus !== 'ai') return null;
      return agent.reply(profiles[session.companyId], session, text) as Promise<string>;
    }
    const before = deliveries.length;
    if (channel === 'instagram') {
      await social.replyToInstagram({
        companyId: session.companyId, instagramId: 'demo-ig',
        sessionId: session.id, recipientId: session.id,
        customerMessage: text, credentialsEncrypted: 'fake',
      });
    } else {
      await social.replyToMessenger({
        companyId: session.companyId, pageId: 'demo-page',
        sessionId: session.id, recipientId: session.id,
        customerMessage: text, credentialsEncrypted: 'fake',
      });
    }
    return deliveries.length > before ? deliveries[deliveries.length - 1].message : null;
  }
  return { agent, social, sessions, deliveries, handoffs, model, newSession, send };
}

describe.each(['whatsapp', 'instagram', 'messenger'] as Channel[])(
  'MW1 simulated multi-turn %s conversation',
  (channel) => {
    it('answers changes and dispatch FAQs during an active sale', async () => {
      const h = makeSimulation();
      const s = h.newSession(channel, 'fashion', 'client-one');
      expect(await h.send(channel, s, 'Busco una blusa')).toContain('talla');
      expect(await h.send(channel, s, '¿Hacen cambios?')).toContain('Claro que sí');
      expect(await h.send(channel, s, '¿Cuánto demora el envío?')).toContain('24 y 72');
      expect(s.context.conversation_category).toBe('sales');
      expect(h.handoffs).not.toHaveBeenCalled();
      expect(h.model.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it('distinguishes general shipping timing from a real existing-order request', async () => {
      const h = makeSimulation();
      const s = h.newSession(channel, 'fashion', 'client-orders');
      await h.send(channel, s, '¿Cuánto demora en llegar mi pedido?');
      expect(s.context.conversation_category).toBe('sales');
      await h.send(channel, s, '¿Dónde está mi pedido #45999?');
      expect(s.context.conversation_category).toBe('service');
      // Mock LLM does not query Shopify or reveal any fictitious order status.
    });

    it('moves explicit cancellations to human and stays silent after queueing', async () => {
      const h = makeSimulation();
      const s = h.newSession(channel, 'fashion', 'client-handoff');
      const first = await h.send(channel, s, 'Quiero cancelar mi pedido');
      expect(first).toContain('asesores');
      expect(h.handoffs).toHaveBeenCalledTimes(1);
      expect(s.attentionStatus).toBe('waiting');
      const calls = h.model.mock.calls.length;
      expect(await h.send(channel, s, '¿Me responden?')).toBeNull();
      expect(h.model.mock.calls.length).toBe(calls);
      expect(h.handoffs).toHaveBeenCalledTimes(1);
    });

    it('does not transfer general exchange or negated-refund questions', async () => {
      const h = makeSimulation();
      const s = h.newSession(channel, 'fashion', 'client-changes');
      await h.send(channel, s, '¿Hacen cambios?');
      await h.send(channel, s, 'Quiero cambiar de talla, no quiero devolución');
      expect(h.handoffs).not.toHaveBeenCalled();
      expect(s.attentionStatus).toBe('ai');
    });

    it('separates companies when their customers have the same external ID', async () => {
      const h = makeSimulation();
      const a = h.newSession(channel, 'fashion', 'same-id');
      const b = h.newSession(channel, 'education', 'same-id');
      expect(await h.send(channel, a, '¿Hacen cambios?')).toContain('Claro que sí');
      expect(await h.send(channel, b, '¿Hacen cambios?')).toContain('cursos');
      expect(a.companyId).not.toBe(b.companyId);
      expect(a.context).not.toBe(b.context);
      expect(h.handoffs).not.toHaveBeenCalled();
    });
  },
);

describe('Simulated visual context on social channels', () => {
  it.each(['instagram', 'messenger'])(
    '%s treats product photos as shopping but warranty photos as service evidence',
    (channel) => {
      const h = makeSimulation();
      const s = h.newSession(channel as Channel, 'fashion', 'client-photo');
      const classify = (type: string, intent: string) =>
        h.social.classifySocialImagePurpose({
          context: s.context, imageType: type, primaryIntent: intent,
          hasProductIntent: intent === 'add_or_review_product',
          hasPaymentIntent: false,
        });
      expect(classify('product', 'clarify')).toEqual({
        isServiceEvidence: false, productInquiry: true,
      });
      expect(classify('warranty_or_return', 'customer_service')).toEqual({
        isServiceEvidence: true, productInquiry: false,
      });
      s.context.conversation_category = 'service';
      expect(classify('product', 'add_or_review_product')).toEqual({
        isServiceEvidence: true, productInquiry: false,
      });
    },
  );
});
