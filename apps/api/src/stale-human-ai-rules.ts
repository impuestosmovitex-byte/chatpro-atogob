export type StaleReviewDecision = 'reply' | 'transfer' | 'close';
export type CustomerMessage = { author_type?: string | null; created_at?: string | null; message?: string | null };

export function qualifiesForStaleAiReview(
  last: CustomerMessage | null,
  cutoffIso: string,
): boolean {
  if (last?.author_type !== 'customer' || !last.created_at) return false;
  const received = Date.parse(last.created_at);
  const cutoff = Date.parse(cutoffIso);
  return Number.isFinite(received) && Number.isFinite(cutoff) && received <= cutoff;
}

/** Closing without an adviser reply is only permitted for unambiguous acknowledgements. */
export function canSafelyAutoCloseUnansweredCustomer(
  last: CustomerMessage | null,
): boolean {
  if (last?.author_type !== 'customer') return false;
  const text = (last.message || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[!¡.,¿?\s]+/g, ' ').trim();
  return /^(gracias|muchas gracias|mil gracias|perfecto gracias|listo gracias|ok gracias|vale gracias|entendido gracias)$/.test(text);
}

export function pickStaleReviewAction(
  decision: StaleReviewDecision,
  confidence: 'high' | 'medium' | 'low',
  last: CustomerMessage | null,
): 'ai' | 'waiting' | 'closed' {
  if (decision === 'close') {
    return confidence === 'high' && canSafelyAutoCloseUnansweredCustomer(last)
      ? 'closed' : 'waiting';
  }
  if (decision === 'reply' && confidence === 'high') return 'ai';
  return 'waiting';
}
