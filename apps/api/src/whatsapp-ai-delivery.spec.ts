import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConversationMemoryService } from './conversation-memory.service';

describe('WhatsApp AI Meta delivery receipts', () => {
  it('retains the Meta ID at every AI text-send site, including fallback and handoff', () => {
    const source = readFileSync(join(__dirname, 'whatsapp-webhook.controller.ts'), 'utf8');
    const sends = source.matchAll(
      /const (sentAiMessage\d+) = await this\.whatsappMessagingService\.sendText\([\s\S]*?\n\s*\);([\s\S]*?)await this\.conversationMemoryService\.saveMessage\(\{([\s\S]*?)\}\);/g,
    );
    let count = 0;
    for (const match of sends) {
      count += 1;
      const id = match[1];
      const savedFields = match[3];
      expect(savedFields).toContain("authorType: 'ai'");
      expect(savedFields).toContain('providerMessageId: ' + id + '.messageId');
    }
    const numberOfSendCalls =
      (source.match(/await this\.whatsappMessagingService\.sendText\(/g) ?? []).length;
    expect(numberOfSendCalls).toBe(18);
    expect(count).toBe(numberOfSendCalls);
  });

  it('stores the provider id returned by Meta for a sent AI message', async () => {
    const insert = jest.fn(async () => ({ error: null }));
    const eventRecord = jest.fn(async () => undefined);
    const getClient = () => ({
      from: (table: string) => {
        if (table === 'conversations') return { insert };
        if (table === 'conversation_sessions') return {
          select: () => ({
            eq: () => ({ eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }) }),
          }),
        };
        throw new Error('Unexpected table: ' + table);
      },
    });
    const memory = new ConversationMemoryService(
      { getClient } as any,
      {} as any,
      { record: eventRecord } as any,
    );
    await memory.saveMessage({
      companyId: 'company-1',
      sessionId: 'session-1',
      customerPhone: '+57 310 000 0000',
      message: 'Te ayudo con la talla.',
      sender: 'assistant',
      authorType: 'ai',
      aiResponse: 'Te ayudo con la talla.',
      providerMessageId: 'wamid.ai-message-01',
    });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      author_type: 'ai',
      customer_phone: '573100000000',
      provider_message_id: 'wamid.ai-message-01',
      status: 'sent',
    }));
  });

  it('updates the AI message to read when Meta confirms it by message id', async () => {
    const eqUpdate = jest.fn(async () => ({ error: null }));
    const update = jest.fn(() => ({ eq: eqUpdate }));
    const eqLookup = jest.fn(() => ({
      maybeSingle: async () => ({ data: { id: 123, status: 'sent' }, error: null }),
    }));
    const getClient = () => ({
      from: (name: string) => {
        expect(name).toBe('conversations');
        return { select: () => ({ eq: eqLookup }), update };
      },
    });
    const memory = new ConversationMemoryService(
      { getClient } as any,
      {} as any,
      {} as any,
    );
    const applied = await memory.applyProviderMessageStatus({
      messageId: 'wamid.ai-message-01',
      status: 'read',
    });
    expect(applied).toBe(true);
    expect(eqLookup).toHaveBeenCalledWith('provider_message_id', 'wamid.ai-message-01');
    expect(update).toHaveBeenCalledWith({ status: 'read', provider_error: null });
    expect(eqUpdate).toHaveBeenCalledWith('id', 123);
  });

  it('does not invent reads or downgrade a confirmed read', async () => {
    const update = jest.fn();
    const getClient = () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { id: 123, status: 'read' }, error: null }),
          }),
        }),
        update,
      }),
    });
    const memory = new ConversationMemoryService(
      { getClient } as any,
      {} as any,
      {} as any,
    );
    expect(await memory.applyProviderMessageStatus({
      messageId: 'wamid.ai-message-01',
      status: 'sent',
    })).toBe(true);
    expect(update).not.toHaveBeenCalled();
  });
});
