import { ShopifyAutomaticTestSendService } from './shopify-automatic-test-send.service';
import { ConversationMemoryService } from './conversation-memory.service';

const companyId = 'company-1';
const phone = '573100000001';
const sessionId = 'session-1';
const recordedAt = '2026-11-07T20:00:00.000Z';

function queryResult(result: { data: any; error: any }) {
  const chain: any = {};
  for (const method of ['eq', 'in', 'gte', 'lt', 'order', 'limit', 'select', 'is']) {
    chain[method] = jest.fn(() => chain);
  }
  chain.maybeSingle = jest.fn(async () => result);
  chain.then = (resolve: any, reject: any) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

describe('Shopify automatic template Meta receipt tracking', () => {
  it('persists the provider message ID in both the tracked column and payload without resending', async () => {
    const changes: Record<string, unknown>[] = [];
    const data = {
      id: 'execution-1',
      company_id: companyId,
      automation_key: 'order_created',
      status: 'queued',
      recipient: phone,
      attempt_count: 0,
      payload: { prepared_only: true, prepared_message: 'Notificación del pedido' },
    };
    const db = {
      from: jest.fn(() => ({
        select: jest.fn(() => queryResult({ data, error: null })),
        update: jest.fn((patch: Record<string, unknown>) => {
          changes.push(patch);
          const q = queryResult({ data: { id: 'execution-1' }, error: null });
          return q;
        }),
      })),
    };
    const sendTemplate = jest.fn(async () => ({
      messageId: 'wamid.shopify-test-001',
      recipient: phone,
    }));
    const sendText = jest.fn();
    const service: any = new ShopifyAutomaticTestSendService(
      { getClient: () => db } as any,
      { sendText } as any,
      { sendAssignedTemplate: sendTemplate } as any,
    );
    service.deliveryPolicy = jest.fn(async () => ({
      mode: 'production',
      allowedPhones: [],
    }));

    expect(await service.sendIfAllowed(companyId, 'execution-1')).toBe('sent');
    expect(sendTemplate).toHaveBeenCalledTimes(1);
    expect(sendText).not.toHaveBeenCalled();
    const sentRecord = changes.find((patch) => patch.status === 'sent');
    expect(sentRecord).toEqual(expect.objectContaining({
      status: 'sent',
      provider_message_id: 'wamid.shopify-test-001',
      next_retry_at: null,
    }));
    expect((sentRecord?.payload as Record<string, unknown>)).toEqual(
      expect.objectContaining({
        provider_message_id: 'wamid.shopify-test-001',
        provider_status: 'accepted',
        production_send: true,
      }),
    );
  });
});

function makeInboxHarness(automations: any[], options: {
  manual?: any[];
  automationError?: { message: string; code?: string } | null;
} = {}) {
  const seen: Array<{table: string; filters: Array<[string, unknown]>}> = [];
  const db = {
    from: (table: string) => {
      const filters: Array<[string, unknown]> = [];
      seen.push({ table, filters });
      const rows = table === 'automation_executions'
        ? automations
        : table === 'conversations'
          ? (options.manual ?? [])
          : [];
      const result = {
        data: rows,
        error: table === 'automation_executions'
          ? (options.automationError ?? null)
          : null,
      };
      const q = queryResult(result);
      q.eq = jest.fn((name: string, value: unknown) => {
        filters.push([name, value]);
        return q;
      });
      q.in = jest.fn((name: string, value: unknown) => {
        filters.push([name, value]);
        return q;
      });
      q.maybeSingle = jest.fn(async () => ({
        data: table === 'conversation_sessions'
          ? { id: sessionId, company_id: companyId, customer_phone: phone }
          : null,
        error: null,
      }));
      return { select: jest.fn(() => q) };
    },
  };

  const memory: any = Object.create(ConversationMemoryService.prototype);
  memory.supabaseService = { getClient: () => db };
  memory.getCompanyProfile = jest.fn(async () => ({
    id: companyId, slug: 'atogob', name: 'Atogob Group',
  }));
  memory.toSession = jest.fn(() => ({
    id: sessionId, customerPhone: phone,
  }));
  memory.getContactsByPhones = jest.fn(async () => new Map());
  memory.toInboxMessage = jest.fn((row: any) => ({
    id: row.id,
    sessionId,
    message: row.message,
    authorType: row.author_type,
    providerMessageId: row.provider_message_id,
    deliveryStatus: row.status,
    createdAt: row.created_at,
  }));
  return { memory, seen };
}

describe('Read-only WhatsApp automation timeline', () => {
  it('shows authentic Meta receipts, old IDs and cart templates without inferring reads', async () => {
    const base = {
      company_id: companyId,
      status: 'sent',
      sent_at: recordedAt,
      created_at: recordedAt,
      error_message: null,
    };
    const rows = [
      {
        ...base, id: 'automatic-read', automation_key: 'order_created',
        provider_message_id: 'wamid.read-001',
        payload: {
          prepared_only: true, production_send: true,
          provider_status: 'read', order_number: '46440',
          used_assigned_template: true,
        },
      },
      {
        ...base, id: 'automatic-old', automation_key: 'payment_pending',
        provider_message_id: null,
        payload: {
          prepared_only: true, production_send: true,
          provider_message_id: 'wamid.old-001',
        },
      },
      {
        ...base, id: 'automatic-cart', automation_key: 'abandoned_cart',
        provider_message_id: 'wamid.cart-001',
        payload: { deliveryMode: 'template', provider_status: 'delivered' },
      },
      {
        ...base, id: 'automatic-failed', status: 'failed', automation_key: 'order_created',
        provider_message_id: 'wamid.failed-001',
        payload: {
          prepared_only: true, production_send: true,
          provider_status: 'failed', provider_error: '131026: undeliverable',
        },
      },
      {
        ...base, id: 'test-only', automation_key: 'order_created',
        provider_message_id: 'wamid.test-001',
        payload: { prepared_only: true, test_send: true, production_send: false },
      },
      {
        ...base, id: 'no-provider', automation_key: 'order_created',
        provider_message_id: null,
        payload: { prepared_only: true, production_send: true },
      },
    ];
    const { memory, seen } = makeInboxHarness(rows);
    const result = await memory.getInboxConversation('atogob', sessionId);
    expect(result.messages).toHaveLength(4);
    expect(result.messages.map((m: any) => m.deliveryStatus).sort())
      .toEqual(['delivered','failed','read','sent']);
    const read = result.messages.find((m: any) => m.id === 'automation-automatic-read');
    expect(read).toEqual(expect.objectContaining({
      deliveryStatus: 'read',
      providerMessageId: 'wamid.read-001',
      messageSource: 'automation',
    }));
    expect(read.message).toContain('Plantilla automática');
    expect(read.message).toContain('#46440');
    expect(read.message).not.toContain('preparado'); // not pretending to show Meta body
    expect(result.messages.find((m: any) => m.id === 'automation-automatic-old')
      .deliveryStatus).toBe('sent');
    expect(result.messages.find((m: any) => m.id === 'automation-automatic-failed')
      .providerError).toContain('131026');
    const filter = seen.find((entry) => entry.table === 'automation_executions');
    expect(filter?.filters).toContainEqual(['company_id', companyId]);
    expect(filter?.filters).toContainEqual(['channel', 'whatsapp']);
    expect(filter?.filters.some(([key, value]) => key === 'recipient' &&
      Array.isArray(value) && value.includes(phone))).toBe(true);
  });

  it('deduplicates provider IDs already represented as ordinary chat messages', async () => {
    const rows = [{
      id: 'duplicate-template', status: 'sent', provider_message_id: 'wamid.same',
      automation_key: 'order_created', sent_at: recordedAt,
      created_at: recordedAt,
      payload: { production_send: true, prepared_only: true },
    }];
    const manual = [{
      id: 'manual-1', message: 'Mensaje existente',
      author_type: 'advisor', status: 'delivered',
      provider_message_id: 'wamid.same',
      created_at: recordedAt,
    }];
    const { memory } = makeInboxHarness(rows, { manual });
    const result = await memory.getInboxConversation('atogob', sessionId);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].id).toBe('manual-1');
  });

  it('keeps the normal inbox usable if the optional automation table query fails', async () => {
    const manual = [{
      id: 'manual-1', message: 'Atención humana',
      author_type: 'advisor', status: 'read',
      provider_message_id: 'wamid.manual',
      created_at: recordedAt,
    }];
    const { memory } = makeInboxHarness([], {
      manual, automationError: { message: 'Query unavailable', code: 'PGRST205' },
    });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const result = await memory.getInboxConversation('atogob', sessionId);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].message).toBe('Atención humana');
    } finally {
      spy.mockRestore();
    }
  });
});
