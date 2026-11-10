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
