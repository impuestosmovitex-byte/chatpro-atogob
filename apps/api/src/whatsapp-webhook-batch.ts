/**
 * Meta may batch several incoming messages in a single webhook notification.
 * Isolate each message with its own phone-number metadata and contact context.
 * Delivery statuses are handled once by the parent webhook request.
 */
export function splitWhatsappInboundWebhookMessages(body: unknown): unknown[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
  const payload = body as Record<string, unknown>;
  if (!Array.isArray(payload.entry)) return [];

  const items: unknown[] = [];
  for (const entry of payload.entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const entryObject = entry as Record<string, unknown>;
    if (!Array.isArray(entryObject.changes)) continue;
    for (const change of entryObject.changes) {
      if (!change || typeof change !== 'object' || Array.isArray(change)) continue;
      const changeObject = change as Record<string, unknown>;
      const value = changeObject.value;
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const valueObject = value as Record<string, unknown>;
      if (!Array.isArray(valueObject.messages)) continue;
      for (const message of valueObject.messages) {
        if (!message || typeof message !== 'object' || Array.isArray(message)) continue;
        items.push({
          ...payload,
          entry: [{
            ...entryObject,
            changes: [{
              ...changeObject,
              value: { ...valueObject, messages: [message], statuses: [] },
            }],
          }],
        });
      }
    }
  }
  return items.length > 1 ? items : [];
}
