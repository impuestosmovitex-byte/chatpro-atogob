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

  it('preserves valid exchanges without automatic transfer', async () => {
    const { agent, requestHumanAttention } = harness();
    const valid = 'Podemos revisar las condiciones de cambio de la prenda. ¿Tienes el número de pedido?';
    expect(await agent.enforceAtogobReply(atogob, session, valid)).toBe(valid);
    expect(requestHumanAttention).not.toHaveBeenCalled();
  });

  it('does not change other company policies', async () => {
    const { agent, requestHumanAttention } = harness();
    const text = '¿Prefieres cambio o devolución?';
    expect(await agent.enforceAtogobReply(maogo, session, text)).toBe(text);
    expect(requestHumanAttention).not.toHaveBeenCalled();
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
