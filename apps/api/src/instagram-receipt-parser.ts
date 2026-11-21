export type SocialReceiptKind = 'read' | 'delivered';
export type SocialReceipt = {
  accountId: string;
  customerId: string;
  kind: SocialReceiptKind;
  mids: string[];
  watermark: string | null;
};

type Data = Record<string, unknown>;
function record(value: unknown): Data {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {};
}
function str(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }

/** Only positive, reasonable webhook timestamps; no guessed read confirmations. */
export function receiptWatermarkIso(value: unknown): string | null {
  const n = typeof value === 'number' ? value
    : typeof value === 'string' && /^\d{10,13}$/.test(value) ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n < 100_000_000_000 ? n * 1000 : n;
  if (ms > Date.now() + 5 * 60_000 || ms < Date.UTC(2020, 0, 1)) return null;
  return new Date(ms).toISOString();
}

/** Instagram can send messaging_seen / read and delivery in either webhook envelope. */
export function parseInstagramReceipts(input: unknown): SocialReceipt[] {
  const body = record(input);
  if (!Array.isArray(body.entry)) return [];
  const receipts: SocialReceipt[] = [];
  for (const rawEntry of body.entry) {
    const entry = record(rawEntry);
    const accountId = str(entry.id);
    if (!accountId) continue;
    const events: Data[] = Array.isArray(entry.messaging) ? entry.messaging.map(record) : [];
    if (Array.isArray(entry.changes)) {
      for (const rawChange of entry.changes) {
        const change = record(rawChange);
        const field = str(change.field).toLowerCase();
        if (!['messages', 'messaging_seen', 'messaging_delivery', 'messaging_read'].includes(field)) continue;
        const val = record(change.value);
        if (!Object.keys(val).length) continue;
        events.push(field === 'messaging_seen' && !val.read && !val.seen
          ? { ...val, read: { mid: val.mid, watermark: val.watermark } }
          : field === 'messaging_delivery' && !val.delivery
            ? { ...val, delivery: { mids: val.mids, watermark: val.watermark } }
            : val);
      }
    }
    for (const event of events) {
      const senderId = str(record(event.sender).id);
      const recipientId = str(record(event.recipient).id);
      // Don't mark a customer's messages read, or cross an Instagram account boundary.
      if (!senderId || senderId === accountId || (recipientId && recipientId !== accountId)) continue;
      for (const [kind, payload] of [
        ['read', record(event.read || event.seen)],
        ['delivered', record(event.delivery)],
      ] as const) {
        if (!Object.keys(payload).length) continue;
        const mids = [
          str(payload.mid),
          ...(Array.isArray(payload.mids) ? payload.mids.map(str) : []),
        ].filter((x, i, all) => Boolean(x) && all.indexOf(x) === i);
        const watermark = receiptWatermarkIso(payload.watermark ?? payload.timestamp);
        if (!mids.length && !watermark) continue;
        receipts.push({ accountId, customerId: senderId, kind, mids, watermark });
      }
    }
  }
  return receipts;
}
