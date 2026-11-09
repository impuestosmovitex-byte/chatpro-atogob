import { ChatAgentService } from './chat-agent.service';

const atogob = {
  slug: 'atogob',
  name: 'Atogob Group',
  assistantName: 'Sofía',
  aiInstructions: 'Atiendes únicamente clientes de la tienda de moda.',
  settings: {},
} as any;

const other = {
  slug: 'other-store',
  name: 'Otra Tienda',
  assistantName: 'Laura',
  aiInstructions: 'Atiendes únicamente los pedidos de la tienda.',
  settings: {},
} as any;

const ad = 'Se viene la temporada navideña, acá tenemos el look perfecto para estas fiestas, compra ahora en nuestra tienda virtual';

function harness() {
  const agent = Object.create(ChatAgentService.prototype) as any;
  const updateSession = jest.fn(async (id: string, patch: any) => ({
    id,
    companyId: 'company-1',
    context: patch.context,
    attentionStatus: 'ai',
  }));
  const requestHumanAttention = jest.fn(async (id: string) => ({
    id,
    attentionStatus: 'human',
    assignedToName: 'Asesor de pruebas',
    context: {},
  }));
  agent.agentSessionRuntimeService = { updateSession, requestHumanAttention };
  return { agent, updateSession, requestHumanAttention };
}

describe('MW1 company-scoped replies', () => {
  it('recognizes the actual merchant-side Christmas advertisement', async () => {
    const { agent } = harness();
    const create = jest.fn();
    agent.getClient = () => ({ responses: { create } });
    expect(await agent.classifyBusinessScope(atogob, ad)).toBe('outside');
    expect(create).not.toHaveBeenCalled();
  });

  it('does not treat a legitimate customer buying clothes as an off-topic advertisement', () => {
    const { agent } = harness();
    expect(agent.isPromotionalTextFromMerchant(
      atogob,
      'Quiero comprar uno de esos looks de Navidad, ¿qué precio tiene?',
    )).toBe(false);
  });

  it('redirects on first unrelated message without invoking the general agent', async () => {
    const { agent, updateSession, requestHumanAttention } = harness();
    const session = { id: 'session-1', context: {} };
    agent.getContextStatus = () => ({ is_within_context_window: true });
    agent.prepareSessionForIncomingActivity = jest.fn(async () => session);
    agent.classifyBusinessScope = jest.fn(async () => 'outside');
    agent.resolveMessageRouting = jest.fn(async () => ({
      messageOrigin: 'customer',
      understanding: 'clear',
      intent: 'other',
      source: 'local',
    }));

    const reply = await agent.reply(atogob, session, ad);
    expect(reply).toBe('Cuéntame, ¿en qué te puedo ayudar?');
    expect(updateSession).toHaveBeenCalledWith('session-1', {
      context: expect.objectContaining({ out_of_scope_streak: 1 }),
    });
    expect(requestHumanAttention).not.toHaveBeenCalled();
    expect(agent.resolveMessageRouting).toHaveBeenCalledTimes(1);
  });

  it('keeps external automated messages suppressed without responding', async () => {
    const { agent, requestHumanAttention } = harness();
    const session = { id: 'session-bot', context: {} };
    agent.getContextStatus = () => ({ is_within_context_window: true });
    agent.prepareSessionForIncomingActivity = jest.fn(async () => session);
    agent.resolveMessageRouting = jest.fn(async () => ({
      messageOrigin: 'probable_external_automation',
      understanding: 'clear',
      intent: 'other',
      source: 'local',
    }));
    agent.classifyBusinessScope = jest.fn(() => {
      throw new Error('Must skip scope for external bots');
    });
    const reply = await agent.reply(atogob, session, ad);
    expect(reply).toContain('INTERNAL_SUPPRESS_EXTERNAL_AUTOMATION');
    expect(agent.classifyBusinessScope).not.toHaveBeenCalled();
    expect(requestHumanAttention).not.toHaveBeenCalled();
  });

  it('reminds the customer of the actual brand and assistant on second off-topic request', async () => {
    const { agent, updateSession, requestHumanAttention } = harness();
    const reply = await agent.handleOutsideBusinessMessage(other, {
      id: 'session-2',
      context: { out_of_scope_streak: 1 },
    });
    expect(reply).toContain('Laura');
    expect(reply).toContain('Otra Tienda');
    expect(reply).not.toMatch(/redact|instagram|chatgpt/i);
    expect(updateSession).toHaveBeenCalledWith('session-2', {
      context: expect.objectContaining({ out_of_scope_streak: 2 }),
    });
    expect(requestHumanAttention).not.toHaveBeenCalled();
  });

  it('actually transfers the third persistent unrelated request to a human', async () => {
    const { agent, requestHumanAttention } = harness();
    const reply = await agent.handleOutsideBusinessMessage(atogob, {
      id: 'session-3',
      context: { out_of_scope_streak: 2 },
    });
    expect(requestHumanAttention).toHaveBeenCalledTimes(1);
    expect(reply).toContain('Asesor de pruebas');
  });

  it('returns a truthful fallback if the handoff fails', async () => {
    const { agent } = harness();
    agent.agentSessionRuntimeService.requestHumanAttention = jest.fn(async () => {
      throw new Error('simulated failure');
    });
    const reply = await agent.handleOutsideBusinessMessage(atogob, {
      id: 'session-3',
      context: { out_of_scope_streak: 2 },
    });
    expect(reply).toContain('comunícate');
    expect(reply).not.toContain('te voy a comunicar');
  });

  it('blocks the exact generic ChatGPT-style response from the screenshot', async () => {
    const { agent, updateSession } = harness();
    agent.enforceSalesReply = jest.fn(async (_session: any, msg: string) => msg);
    const text = '¡Qué buena idea para Navidad! 🎄 ¿Quieres que te mejore ese texto para publicar en Instagram o prefieres que te muestre 3 looks reales de la tienda para que los compartas?';
    const actual = await agent.enforceCompanyReply(
      atogob, { id: 'session-4', context: {} }, text,
    );
    expect(actual).toBe('Cuéntame, ¿en qué te puedo ayudar?');
    expect(updateSession).toHaveBeenCalledTimes(1);
  });

  it('does not block legitimate customer-support messages', async () => {
    const { agent, requestHumanAttention } = harness();
    agent.enforceSalesReply = jest.fn(async (_session: any, msg: string) => msg);
    const reply = '¡Claro! Tenemos blusas negras. ¿Qué talla necesitas?';
    expect(await agent.enforceCompanyReply(
      atogob, { id: 'session-5', context: {} }, reply,
    )).toBe(reply);
    expect(requestHumanAttention).not.toHaveBeenCalled();
  });

  it('classifies real unrelated general-purpose requests when not a scripted ad', async () => {
    const { agent } = harness();
    agent.getModel = () => 'gpt-4o-mini';
    agent.getClient = () => ({ responses: { create: jest.fn(async () => ({
      output_text: '{"scope":"outside"}',
    })) } });
    expect(await agent.classifyBusinessScope(other, 'Explícame la historia de Roma')).toBe('outside');
  });
});
