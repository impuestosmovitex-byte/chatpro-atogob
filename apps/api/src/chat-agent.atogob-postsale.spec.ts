import { ChatAgentService } from './chat-agent.service';

const atogob = { slug: 'atogob' } as any;
const maogo = { slug: 'maogo' } as any;
const session = { id: 'fake-session', context: {} } as any;

function harness(status = 'waiting') {
  const agent = Object.create(ChatAgentService.prototype) as any;
  const requestHumanAttention = jest.fn(async () => ({
    attentionStatus: status,
  }));
  agent.agentSessionRuntimeService = { requestHumanAttention };
  agent.enforceSalesReply = jest.fn(async (_session: unknown, text: string) => text);
  return { agent, requestHumanAttention };
}

describe('ATOGOB strict post-sale policy', () => {
  it('intercepts an explicit return request before AI routing', async () => {
    const { agent, requestHumanAttention } = harness('human');
    agent.getContextStatus = () => ({ is_within_context_window: true });
    agent.prepareSessionForIncomingActivity = jest.fn(async () => session);
    agent.resolveMessageRouting = jest.fn(() => {
      throw new Error('AI routing should not run');
    });
    const result = await agent.reply(atogob, session, 'Devolución por favor');
    expect(result).toContain('asesores');
    expect(result).not.toMatch(/devoluci[oó]n|reembolso|cancelaci[oó]n/i);
    expect(requestHumanAttention).toHaveBeenCalledTimes(1);
    expect(agent.resolveMessageRouting).not.toHaveBeenCalled();
  });

  it('blocks spontaneous refund choices from ATOGOB AI', async () => {
    const { agent, requestHumanAttention } = harness();
    const result = await agent.enforceAtogobReply(
      atogob,
      session,
      '¿Prefieres cambio de talla o devolución del dinero?',
    );
    expect(result).toContain('asesores');
    expect(result).not.toMatch(/devoluci[oó]n|reembolso|cancelaci[oó]n/i);
    expect(requestHumanAttention).toHaveBeenCalledTimes(1);
  });

  it('keeps exchange requests with expressly declined refunds in the normal flow', () => {
    const { agent } = harness();
    expect(agent.isAtogobRestrictedCustomerRequest(
      'Quiero un cambio por talla, no quiero devolución',
    )).toBe(false);
    expect(agent.isAtogobRestrictedCustomerRequest(
      'No quiero devolución, solo cambio por color',
    )).toBe(false);
    expect(agent.isAtogobRestrictedCustomerRequest(
      'No quiero devolución, quiero cancelar el pedido',
    )).toBe(true);
    expect(agent.isAtogobRestrictedCustomerRequest(
      'Quiero cambiar de talla. No quiero que me devuelvan el dinero',
    )).toBe(false);
  });

  it('preserves valid exchanges without automatic transfer', async () => {
    const { agent, requestHumanAttention } = harness();
    const valid = 'Podemos revisar las condiciones de cambio de la prenda. ¿Tienes el número de pedido?';
    expect(await agent.enforceAtogobReply(atogob, session, valid)).toBe(valid);
    expect(requestHumanAttention).not.toHaveBeenCalled();
  });

  it('blocks unsolicited monetary alternatives for every company without changing their policies', async () => {
    const { agent, requestHumanAttention } = harness();
    const text = '¿Prefieres cambio o devolución?';
    expect(await agent.enforceAtogobReply(maogo, session, text))
      .toBe('Con gusto revisamos tu solicitud según las condiciones de la tienda.');
    expect(requestHumanAttention).not.toHaveBeenCalled();
  });

  it.each([
    '¿No quieres una devolución de dinero?',
    '¿Quieres cambio de talla o devolución?',
    '¿Prefieres el cambio o un reembolso?',
    'Podemos ofrecer una devolución del valor pagado.',
    '¿Quieres cancelar o cambiar el pedido?',
  ])('never offers an unrequested economic option: %s', async (draft) => {
    const { agent, requestHumanAttention } = harness();
    const result = await agent.enforceAtogobReply(maogo, session, draft);
    expect(result).not.toMatch(/devoluci[oó]n|reembolso|cancelaci[oó]n|cancelar/i);
    expect(result).toContain('condiciones de la tienda');
    expect(requestHumanAttention).not.toHaveBeenCalled();
  });

  it('preserves policy responses without economic options', async () => {
    const { agent, requestHumanAttention } = harness();
    const text = 'Los cambios se revisan según las condiciones de cada producto.';
    expect(await agent.enforceAtogobReply(maogo, session, text)).toBe(text);
    expect(requestHumanAttention).not.toHaveBeenCalled();
  });

  it('loads approved company policies before a chat has a service classification', () => {
    const { agent } = harness();
    agent.readConversationCategory = () => 'unclassified';
    agent.getCommercialFlowRules = () => '';
    const profile = {
      slug: 'other-brand',
      name: 'Empresa piloto',
      assistantName: 'Asistente',
      aiInstructions: 'No prometas resultados.',
      settings: {
        knowledge_base: { exchanges_returns: 'CAMBIOS: consultar primero el producto real.' },
      },
    };
    const prompt = agent.buildInstructions(profile, session, false);
    expect(prompt).toContain('CAMBIOS: consultar primero el producto real.');
    expect(prompt).toContain('Está prohibido introducir por tu cuenta opciones de devolución de dinero');
  });

  it('sanitizes a handoff message and does not pretend a failed transfer succeeded', async () => {
    const { agent } = harness();
    expect(agent.sanitizeAtogobHandoffMessage(atogob, 'Revisaremos tu devolución con un asesor.'))
      .toBe('Para revisar si tu solicitud es viable, uno de nuestros asesores te atenderá.');
    agent.agentSessionRuntimeService.requestHumanAttention = jest.fn(async () => {
      throw new Error('simulated handoff failure');
    });
    const fallback = await agent.requestAtogobPolicyReview(session, 'test');
    expect(fallback).toContain('comunícate');
    expect(fallback).not.toContain('te voy a comunicar');
  });
});
