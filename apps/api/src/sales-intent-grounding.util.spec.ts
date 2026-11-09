import { ChatAgentService } from './chat-agent.service';
import {
  customerExplicitlyAskedForAdvisor,
  customerExplicitlyAskedForFreeBenefit,
  handoffAssertsUnrequestedFreeBenefit,
} from './sales-intent-grounding.util';

describe('Tenant-neutral sales intent safeguards', () => {
  it.each([
    'Regálame el pedido así',
    'Me regalas esas tres referencias',
    'Por favor, me regalas dos camisetas en talla M',
    'Me das el pedido como está',
    'Quiero comprar estos productos',
  ])('does not interpret a colloquial purchase as a free concession: %s', (phrase) => {
    expect(customerExplicitlyAskedForFreeBenefit(phrase)).toBe(false);
    expect(handoffAssertsUnrequestedFreeBenefit(
      'Solicitud de regalo del pedido',
      'El cliente solicita entrega sin costo.',
      [phrase],
    )).toBe(true);
  });

  it.each([
    '¿Pueden enviármelo gratis?',
    'Necesito el domicilio sin costo',
    '¿Me lo pueden dar sin pagar?',
    '¿Me regalas el envío?',
    'Can I get free delivery?',
  ])('preserves an explicit concession request: %s', (phrase) => {
    expect(customerExplicitlyAskedForFreeBenefit(phrase)).toBe(true);
    expect(handoffAssertsUnrequestedFreeBenefit(
      'Solicitud de regalo del pedido',
      'Cliente solicita envío sin costo.',
      [phrase],
    )).toBe(false);
  });

  it('does not flag unrelated, ordinary human handoffs', () => {
    expect(handoffAssertsUnrequestedFreeBenefit(
      'Cliente solicita un asesor para validar una compra',
      'Resolver un dato sin confirmar',
      ['Necesito hablar con un asesor'],
    )).toBe(false);
  });

  it.each([
    'Necesito hablar con un asesor',
    '¿Me puedes comunicar con una persona real?',
    'Asesora',
    'Quiero un agente humano',
    'I need to speak with a human agent',
  ])('recognizes direct customer requests for an advisor: %s', (phrase) => {
    expect(customerExplicitlyAskedForAdvisor(phrase)).toBe(true);
  });

  it.each([
    'No quiero un asesor, quiero pagar',
    'No me transfieras a un asesor',
    'Regálame el pedido así',
    'Quiero la blusa sola',
    'Quiero pagar con tarjeta',
  ])('does not invent a customer request for human support: %s', (phrase) => {
    expect(customerExplicitlyAskedForAdvisor(phrase)).toBe(false);
  });

  function harness(context: Record<string, unknown> = {}) {
    const session = {
      id: 'session-tenant-1',
      companyId: 'company-tenant-1',
      customerPhone: '573100000001',
      context: {
        conversation_category: 'sales',
        ...context,
      },
      attentionStatus: 'ai',
    };
    const transfer = jest.fn(async () => ({
      ...session,
      attentionStatus: 'human',
      assignedToName: 'Agente de la empresa',
    }));
    const agent: any = Object.create(ChatAgentService.prototype);
    agent.agentSessionRuntimeService = {
      getSessionById: jest.fn(async () => session),
      requestHumanAttention: transfer,
    };
    return { agent, session, transfer };
  }

  it('prevents fictitious gift/free-shipping transfers without mutating the session', async () => {
    const { agent, session, transfer } = harness();
    const result = await agent.executeTool(
      'request_human_attention',
      JSON.stringify({
        reason: 'Solicitud de regalo del pedido',
        summary: 'Cliente pidió regalo de todo el pedido y entrega sin costo.',
        customer_message: 'Un asesor revisará tu regalo.',
      }),
      session,
      '👆🏽',
      ['Regálame el pedido así'],
    );
    expect(result).toEqual(expect.objectContaining({
      ok: false,
      blocked: true,
      next_action: 'correct_customer_intent',
    }));
    expect(transfer).not.toHaveBeenCalled();
  });

  it('does not trust the model-created advisor claim instead of actual customer words', async () => {
    const { agent, session, transfer } = harness({
      sale_context: { shipping_resolution_status: 'needs_payment' },
    });
    const result = await agent.executeTool(
      'request_human_attention',
      JSON.stringify({
        reason: 'Cliente quiere hablar con asesor sobre pago',
        summary: 'Cliente requiere asesor por medio de pago.',
        customer_message: 'Te comunicaré con un asesor.',
      }),
      session,
      'Quiero pagar con tarjeta',
      [],
    );
    expect(result).toEqual(expect.objectContaining({
      ok: false,
      blocked: true,
    }));
    expect(transfer).not.toHaveBeenCalled();
  });

  it('does not block a human transfer explicitly requested by the customer', async () => {
    const { agent, session, transfer } = harness({
      sale_context: { shipping_resolution_status: 'needs_payment' },
    });
    const result = await agent.executeTool(
      'request_human_attention',
      JSON.stringify({
        reason: 'Solicitud explícita de asesor para información de pago',
        summary: 'Cliente pidió una persona real.',
        customer_message: 'Te comunico con un asesor.',
      }),
      session,
      'Necesito hablar con un asesor',
      [],
    );
    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(transfer).toHaveBeenCalledTimes(1);
  });

  it('contains no tenant, merchant, catalog or size fixtures in the generic validator', () => {
    const { readFileSync } = require('node:fs');
    const { join } = require('node:path');
    const source: string = readFileSync(
      join(__dirname, 'sales-intent-grounding.util.ts'), 'utf8',
    );
    expect(source).not.toMatch(/atogob|maogo|movitex|shopify|talla unica|falda beige/i);
  });
});
