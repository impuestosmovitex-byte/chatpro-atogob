import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConversationMemoryService } from './conversation-memory.service';

const company = { id: 'company-one', slug: 'atogob', name: 'ATOGOB' };
const phone = '573100000001';
const date = '2026-11-08T17:00:00.000Z';

function execution(overrides: Record<string, unknown> = {}) {
  return {
    id: 'execution-one',
    company_id: company.id,
    automation_key: 'order_created',
    channel: 'whatsapp',
    recipient: phone,
    status: 'sent',
    sent_at: date,
    created_at: date,
    provider_message_id: 'wamid.automation-one',
    error_message: null,
    payload: {
      production_send: true,
      prepared_only: true,
      order_number: '46467',
      provider_status: 'delivered',
    },
    ...overrides,
  };
}

function query(rows: unknown[], filters: Array<[string, unknown]>) {
  const chain: any = {};
  for (const key of ['eq', 'neq', 'in', 'gte', 'lt', 'order', 'limit']) {
    chain[key] = jest.fn((...args: unknown[]) => {
      filters.push([key, args]);
      return chain;
    });
  }
  chain.then = (resolve: (value: unknown) => void, reject: (error: unknown) => void) =>
    Promise.resolve({ data: rows, error: null }).then(resolve, reject);
  return chain;
}

function harness(automations: unknown[], existingSessions: unknown[] = []) {
  const operations: Array<{ table: string; operation: string; args?: unknown }> = [];
  const db = {
    from: (table: string) => ({
      select: (fields: string) => {
        operations.push({ table, operation: 'select', args: fields });
        return query(
          table === 'automation_executions' ? automations : existingSessions,
          [],
        );
      },
    }),
  };
  const memory: any = Object.create(ConversationMemoryService.prototype);
  memory.supabaseService = { getClient: () => db };
  memory.getCompanyProfile = jest.fn(async () => company);
  memory.getContactsByPhones = jest.fn(async () => new Map());
  return { memory, operations };
}

describe('Read-only automated WhatsApp activity in customer conversations', () => {
  it('displays Meta confirmed delivery and reading without fabricating receipts', () => {
    const { memory } = harness([]);
    const delivered = memory.toAutomaticInboxMessage(execution(), 'automation:' + phone);
    expect(delivered).toEqual(expect.objectContaining({
      id: 'automation-execution-one',
      deliveryStatus: 'delivered',
      messageSource: 'automation',
      providerMessageId: 'wamid.automation-one',
    }));
    expect(delivered.message).toContain('#46467');

    const read = memory.toAutomaticInboxMessage(execution({
      payload: {
        production_send: true, prepared_only: true,
        provider_status: 'read',
      },
    }), 'automation:' + phone);
    expect(read.deliveryStatus).toBe('read');

    const noConfirmation = memory.toAutomaticInboxMessage(execution({
      payload: { production_send: true, prepared_only: true },
    }), 'automation:' + phone);
    expect(noConfirmation.deliveryStatus).toBe('sent');
  });

  it('does not display test, blocked or never-accepted records as sent WhatsApp bubbles', () => {
    const { memory } = harness([]);
    expect(memory.toAutomaticInboxMessage(
      execution({ payload: { prepared_only: true, production_send: false } }),
      'automation:' + phone,
    )).toBeNull();
    expect(memory.toAutomaticInboxMessage(
      execution({ provider_message_id: null,
        payload: { production_send: true, prepared_only: true } }),
      'automation:' + phone,
    )).toBeNull();
  });

  it('shows actual Meta failures, not fictional unread states', () => {
    const { memory } = harness([]);
    const message = memory.toAutomaticInboxMessage(execution({
      status: 'failed',
      error_message: 'Error desconocido',
      payload: {
        production_send: true, prepared_only: true,
        provider_status: 'failed',
        provider_error: '131049 · Meta limitó este mensaje',
      },
    }), 'automation:' + phone);
    expect(message.deliveryStatus).toBe('failed');
    expect(message.providerError).toContain('131049');
  });

  it('opens automatic-only history with no chat session writes or sends', async () => {
    const { memory, operations } = harness([
      execution(),
      execution({
        id: 'execution-two',
        provider_message_id: 'wamid.second',
        payload: {
          production_send: true, prepared_only: true,
          provider_status: 'read',
        },
      }),
      execution({
        id: 'not-sent',
        provider_message_id: null,
        payload: { prepared_only: true, production_send: true },
      }),
    ]);
    const result = await memory.getAutomaticOnlyInboxConversation(
      company.slug, 'automation:' + phone,
    );
    expect(result.session.context.read_only_automation).toBe(true);
    expect(result.session.attentionStatus).toBe('closed');
    expect(result.messages).toHaveLength(2);
    expect(result.messages.map((m: any) => m.deliveryStatus)).toEqual(['delivered', 'read']);
    expect(operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'automation_executions', operation: 'select' }),
    ]));
    expect(operations.every((op) => op.operation === 'select')).toBe(true);
  });

  it('lists an automatic-only recipient while preserving normal real chats', async () => {
    const { memory } = harness([
      execution(),
      execution({ id: 'cart-two',
        automation_key: 'abandoned_cart',
        provider_message_id: 'wamid.cart-two',
        recipient: '573100000002',
        payload: { deliveryMode: 'template', provider_status: 'read' },
      }),
    ], [{ customer_phone: '573100000002' }]);
    const results = await memory.listAutomaticOnlyInboxSessions(company.slug, {
      status: 'all',
    });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('automation:' + phone);
    expect(results[0].context.read_only_automation).toBe(true);
    expect(results[0].lastMessage.messageSource).toBe('automation');
  });

  it('does not add automation-only recipients to adviser or unread queues', async () => {
    const { memory } = harness([execution()]);
    expect(await memory.listAutomaticOnlyInboxSessions(company.slug, {
      status: 'human',
    })).toHaveLength(0);
    expect(await memory.listAutomaticOnlyInboxSessions(company.slug, {
      status: 'all', offset: 20,
    })).toHaveLength(0);
  });

  it('enforces company-bound history and prevents sending from display-only chats', () => {
    const api = readFileSync(join(__dirname, 'inbox.controller.ts'), 'utf8');
    const view = readFileSync(join(__dirname, '../../../app/page.tsx'), 'utf8');
    expect(api).toContain('readOnlyAutomation: true');
    expect(api).toContain('const actor = await this.actor(');
    expect(view).toContain('!readOnlyAutomation && selected?.session.takeAvailable');
    expect(view).toContain('canSendTemplates &&');
    expect(view).toContain('!readOnlyAutomation &&');
    expect(view).toContain('Solo lectura · automatizaciones');
  });
});
