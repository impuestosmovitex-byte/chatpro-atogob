/**
 * Read-only, offline classification of Meta WhatsApp Business App coexistence
 * webhooks. This does not authorize a webhook: caller MUST first verify
 * X-Hub-Signature-256 on the original raw request bytes and independently
 * confirm that the phone and WABA belong to one active staging tenant.
 *
 * Does not persist or return customer names, contact numbers, message bodies
 * or history. It is deliberately not wired to the live webhook controller.
 * Real imports require consent, deduplication, transaction isolation and an
 * approved history sync process before any messages are ever ingested.
 */
export type WhatsappCoexistenceWebhookKind =
  | 'history'
  | 'smb_app_state_sync'
  | 'smb_message_echoes';

export type WhatsappCoexistenceWebhookSummary = {
  kind: WhatsappCoexistenceWebhookKind;
  wabaId: string;
  phoneNumberId: string;
  itemCount: number;
  historySharing: 'declined' | 'not_determined';
};

const ASSET_ID = /^[0-9]{6,30}$/;
const KINDS: readonly string[] = [
  'history', 'smb_app_state_sync', 'smb_message_echoes',
];

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function account(
  data: Record<string, unknown>,
  waba: unknown,
): { wabaId: string; phoneNumberId: string } | null {
  const meta = object(data.metadata);
  const phone = meta?.phone_number_id;
  if (typeof waba !== 'string' || !ASSET_ID.test(waba) ||
      typeof phone !== 'string' || !ASSET_ID.test(phone) ||
      data.messaging_product !== 'whatsapp') return null;
  return { wabaId: waba, phoneNumberId: phone };
}

function summarize(
  kind: WhatsappCoexistenceWebhookKind,
  data: Record<string, unknown>,
  wabaId: unknown,
): WhatsappCoexistenceWebhookSummary | null {
  const identity = account(data, wabaId);
  if (!identity) return null;

  const key = kind === 'history' ? 'history'
    : kind === 'smb_app_state_sync' ? 'state_sync'
    : 'message_echoes';
  const items = data[key];
  if (!Array.isArray(items) || items.length > 10000) return null;

  // Denial is a specific Meta history error, never inferred from missing data.
  const historySharing: WhatsappCoexistenceWebhookSummary['historySharing'] =
    kind === 'history' && items.some((item: unknown) => {
      const history = object(item);
      return Array.isArray(history?.errors) && history.errors.some(
        (value: unknown) => object(value)?.code === 2593109,
      );
    }) ? 'declined' : 'not_determined';

  return { kind, ...identity, itemCount: items.length, historySharing };
}

/**
 * Accepts the documented direct history/contact webhook and normal
 * whatsapp_business_account entry/change envelopes. Fails closed on mixed
 * tenants, unknown event shapes or ambiguous account IDs. An empty array is
 * not proof of valid data, hence null is returned for unsupported events.
 */
export function summarizeWhatsappCoexistenceWebhook(
  payload: unknown,
): WhatsappCoexistenceWebhookSummary[] | null {
  const root = object(payload);
  if (!root) return null;
  const summaries: WhatsappCoexistenceWebhookSummary[] = [];

  // Direct partner webhook event format.
  if (typeof root.event === 'string' && KINDS.includes(root.event)) {
    const data = object(root.data);
    const event = root.event as WhatsappCoexistenceWebhookKind;
    const summary = data && event !== 'smb_message_echoes'
      ? summarize(event, data, data.id) : null;
    return summary ? [summary] : null;
  }

  // Standard Meta webhook envelope (including smb_message_echoes).
  if (root.object !== 'whatsapp_business_account' ||
      !Array.isArray(root.entry) || root.entry.length === 0 ||
      root.entry.length > 100) return null;
  for (const entryValue of root.entry) {
    const entry = object(entryValue);
    if (!entry || !Array.isArray(entry.changes) ||
        entry.changes.length === 0 || entry.changes.length > 100) return null;
    for (const changeValue of entry.changes) {
      const change = object(changeValue);
      const kind = change?.field;
      const data = object(change?.value);
      if (typeof kind !== 'string' || !KINDS.includes(kind) || !data) return null;
      const summary = summarize(kind as WhatsappCoexistenceWebhookKind, data, entry.id);
      if (!summary) return null;
      summaries.push(summary);
    }
  }
  if (!summaries.length) return null;
  // Never treat one webhook containing multiple unrelated phone IDs or WABAs
  // as a single tenant event.
  const { phoneNumberId, wabaId } = summaries[0];
  return summaries.every(x => x.phoneNumberId === phoneNumberId &&
    x.wabaId === wabaId) ? summaries : null;
}
