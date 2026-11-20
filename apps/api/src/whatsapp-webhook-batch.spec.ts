import { splitWhatsappInboundWebhookMessages } from './whatsapp-webhook-batch';

describe('WhatsApp inbound webhook batches', () => {
  it('retains every image in a batch without an artificial limit', () => {
    const messages = Array.from({ length: 35 }, (_, i) => ({
      id: `wamid.${i}`,
      from: '573001234567',
      type: 'image',
      image: { id: `media-${i}`, mime_type: 'image/jpeg' },
    }));
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'waba-1',
        changes: [{
          field: 'messages',
          value: {
            metadata: { phone_number_id: 'phone-1' },
            contacts: [{ wa_id: '573001234567' }],
            statuses: [{ id: 'wamid-delivery', status: 'delivered' }],
            messages,
          },
        }],
      }],
    };
    const all = splitWhatsappInboundWebhookMessages(payload) as any[];
    expect(all).toHaveLength(35);
    expect(all.map(x => x.entry[0].changes[0].value.messages[0].id))
      .toEqual(messages.map(x => x.id));
    expect(all.every(x => x.entry[0].changes[0].value.statuses.length === 0)).toBe(true);
    expect(all.every(x => x.entry[0].changes[0].value.metadata.phone_number_id === 'phone-1')).toBe(true);
  });

  it('preserves per-number metadata across multiple entries', () => {
    const payload = { entry: [
      { changes: [{ value: { metadata: { phone_number_id: 'a' }, messages: [{ id: '1' }] } }] },
      { changes: [{ value: { metadata: { phone_number_id: 'b' }, messages: [{ id: '2' }] } }] },
    ] };
    const all = splitWhatsappInboundWebhookMessages(payload) as any[];
    expect(all.map(x => x.entry[0].changes[0].value.metadata.phone_number_id))
      .toEqual(['a', 'b']);
  });

  it('keeps single-message and status-only payloads on the existing path', () => {
    expect(splitWhatsappInboundWebhookMessages({ entry: [{ changes: [{ value: { messages: [{ id: 'a' }] } }] }] })).toEqual([]);
    expect(splitWhatsappInboundWebhookMessages({ entry: [{ changes: [{ value: { statuses: [{ id: 's' }] } }] }] })).toEqual([]);
  });
});
