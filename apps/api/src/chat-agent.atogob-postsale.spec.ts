import { ChatAgentService } from './chat-agent.service';

const companyWithEconomicHandoff = {
  slug: 'fashion-example',
  name: 'Tienda de prueba',
  assistantName: 'Asesora',
  aiInstructions: [
    'REGLA PRIORITARIA: SOLICITUDES ECONÓMICAS.',
    'Las peticiones expresas de reembolso, devolución de dinero o cancelaciones de pedidos se transfieren a un asesor.',
    'Las preguntas informativas y los cambios de talla se responden normalmente.',
  ].join(' '),
  settings: {},
} as any;
const companyWithoutEconomicHandoff = {
  slug: 'other-company',
  name: 'Otra empresa',
  aiInstructions: 'Responde consultas de la empresa y usa sus políticas.',
  settings: {},
} as any;
const session = { id: 'fake-session', context: { conversation_category: 'sales' } } as any;

function harness(status = 'human') {
  const agent = Object.create(ChatAgentService.prototype) as any;
  const requestHumanAttention = jest.fn(async () => ({ attentionStatus: status }));
  agent.agentSessionRuntimeService = { requestHumanAttention };
  agent.enforceSalesReply = jest.fn(async (_session: unknown, text: string) => text);
  agent.getModel = () => 'test-model';
  const create = jest.fn(async () => ({ output_text: '{"explicit_request":false}' }));
  agent.getClient = () => ({ responses: { create } });
  agent.getContextStatus = () => ({ is_within_context_window: true });
  agent.prepareSessionForIncomingActivity = jest.fn(async () => session);
  return { agent, requestHumanAttention, create };
}

describe('MW1 tenant-configured economic handoffs', () => {
  it('detects the handoff policy from company instructions, not the brand slug', () => {
    const { agent } = harness();
    expect(agent.companyRequiresEconomicHandoff(companyWithEconomicHandoff)).toBe(true);
    expect(agent.companyRequiresEconomicHandoff(companyWithoutEconomicHandoff)).toBe(false);
    expect(agent.companyRequiresEconomicHandoff({
      ...companyWithEconomicHandoff,
      slug: 'another-tenant',
      settings: { economic_handoff_policy: 'disabled' },
    })).toBe(false);
    expect(agent.companyRequiresEconomicHandoff({
      ...companyWithoutEconomicHandoff,
      settings: { economic_handoff_policy: 'required' },
    })).toBe(true);
  });

  it('transfers an explicit request before any sales routing', async () => {
    const { agent, requestHumanAttention, create } = harness();
    create.mockResolvedValue({ output_text: '{"explicit_request":true}' });
    agent.resolveMessageRouting = jest.fn(() => {
      throw new Error('AI routing must not run for mandatory human request');
    });

    const result = await agent.reply(
      companyWithEconomicHandoff, session, 'Quiero cancelar mi pedido',
    );
    expect(result).toContain('asesores');
    expect(result).not.toMatch(/cancelar|devoluci[oó]n|reembolso/i);
    expect(requestHumanAttention).toHaveBeenCalledTimes(1);
    expect(agent.resolveMessageRouting).not.toHaveBeenCalled();
  });

  it.each([
    '¿Hacen devoluciones?',
    '¿Cuáles son las políticas de cancelaciones?',
    'Quiero cambiar la blusa, no quiero devolución',
    'Quiero devolver la prenda',
    '¿Puedo cancelar un pedido si no me sirve la talla?',
  ])('does not preempt informative or ambiguous conversations: %s', async (message) => {
    const { agent, requestHumanAttention, create } = harness();
    create.mockResolvedValue({ output_text: '{"explicit_request":false}' });
    agent.resolveMessageRouting = jest.fn(async () => {
      throw new Error('arrived at normal routing');
    });
    await expect(agent.reply(companyWithEconomicHandoff, session, message))
      .rejects.toThrow('arrived at normal routing');
    expect(requestHumanAttention).not.toHaveBeenCalled();
    expect(agent.resolveMessageRouting).toHaveBeenCalledTimes(1);
  });

  it('does not enforce another tenant\'s mandatory handoff rule', async () => {
    const { agent, requestHumanAttention, create } = harness();
    agent.resolveMessageRouting = jest.fn(async () => {
      throw new Error('arrived at tenant routing');
    });
    await expect(agent.reply(companyWithoutEconomicHandoff, session, 'Quiero cancelar mi pedido'))
      .rejects.toThrow('arrived at tenant routing');
    expect(create).not.toHaveBeenCalled();
    expect(requestHumanAttention).not.toHaveBeenCalled();
  });

  it.each([
    'Quiero un reembolso de mi pedido',
    'Quiero cancelar mi pedido',
    'Necesito que me devuelvan el dinero',
    'No quiero devolución, quiero cancelar el pedido',
  ])('has a conservative explicit-request fallback when classification fails: %s', async (message) => {
    const { agent, create } = harness();
    create.mockRejectedValue(new Error('model unavailable'));
    expect(await agent.isExplicitEconomicRequest(message)).toBe(true);
  });

  it.each([
    '¿Hacen devoluciones?',
    'Quiero devolver la prenda',
    'Quiero cambiar la talla, no quiero devolución',
    '¿Se puede cancelar un pedido?',
  ])('does not infer a mandatory transfer from an ambiguous phrase: %s', async (message) => {
    const { agent, create } = harness();
    create.mockResolvedValue({ output_text: '{"explicit_request":false}' });
    expect(await agent.isExplicitEconomicRequest(message)).toBe(false);
  });

  it('never confirms a transfer that did not happen', async () => {
    const { agent } = harness('waiting');
    const pending = await agent.requestCompanyPolicyReview(session, 'review');
    // Social channel handoffs enter the human queue as "waiting".
    // A confirmed queue placement is real, even before assignment.
    expect(pending).toContain('te voy a comunicar');
    agent.agentSessionRuntimeService.requestHumanAttention = jest.fn(async () => {
      throw new Error('handoff unavailable');
    });
    const failed = await agent.requestCompanyPolicyReview(session, 'review');
    expect(failed).toContain('comunícate');
  });

  it('keeps normal exchange information and sales follow-up intact', async () => {
    const { agent, requestHumanAttention } = harness();
    const text = 'Claro, hacemos cambios 😊 ¿Qué prenda te gustó?';
    expect(await agent.enforceCompanyReply(companyWithEconomicHandoff, session, text)).toBe(text);
    expect(requestHumanAttention).not.toHaveBeenCalled();
  });

  it('allows informational answers even if a policy topic is mentioned', async () => {
    const { agent, requestHumanAttention } = harness();
    const text = 'Para los cambios, el plazo depende de la condición real del producto.';
    expect(await agent.enforceCompanyReply(companyWithEconomicHandoff, session, text)).toBe(text);
    expect(requestHumanAttention).not.toHaveBeenCalled();
  });

  it('blocks unsolicited economic alternatives for all companies', async () => {
    const { agent, requestHumanAttention } = harness();
    const reply = await agent.enforceCompanyReply(
      companyWithoutEconomicHandoff,
      session,
      '¿Prefieres cambio de talla o devolución del dinero?',
    );
    expect(reply).toBe('Con gusto revisamos tu solicitud según las condiciones de la tienda.');
    expect(requestHumanAttention).not.toHaveBeenCalled();
  });

  it('sanitizes transferred economic messages when the company requires that', () => {
    const { agent } = harness();
    expect(agent.sanitizeCompanyHandoffMessage(
      companyWithEconomicHandoff, 'Revisaremos tu reembolso con un asesor',
    )).toBe('Para revisar si tu solicitud es viable, uno de nuestros asesores te atenderá.');
    expect(agent.sanitizeCompanyHandoffMessage(
      companyWithoutEconomicHandoff, 'Un asesor revisará el reembolso',
    )).toBe('Un asesor revisará el reembolso');
  });

  it('preserves the sale when the customer asks general shipping or change questions', () => {
    const { agent } = harness();
    expect(agent.classifyConversationCategory(
      session, '¿Cuánto demora en llegar mi pedido?', 'other',
    )).toBe('sales');
    expect(agent.classifyConversationCategory(
      session, '¿Hacen cambios?', 'other',
    )).toBe('sales');
    expect(agent.classifyConversationCategory(
      session, '¿Tienen garantía?', 'other',
    )).toBe('sales');
    expect(agent.classifyConversationCategory(
      session, '¿Dónde está mi pedido?', 'other',
    )).toBe('service');
  });

  it('makes approved company policy available in both sales and service', () => {
    const { agent } = harness();
    agent.getCommercialFlowRules = () => '';
    const profile = {
      ...companyWithEconomicHandoff,
      settings: { knowledge_base: { exchanges_returns: 'CAMBIOS: según el producto real.' } },
    };
    const prompt = agent.buildInstructions(profile, session, false);
    expect(prompt).toContain('CAMBIOS: según el producto real.');
    expect(prompt).toContain('preguntas generales sobre sedes');
  });
});
