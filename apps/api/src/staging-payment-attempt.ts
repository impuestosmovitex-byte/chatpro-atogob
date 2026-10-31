import { createHash, randomUUID } from 'node:crypto';

export type PaymentAttemptDraft = Readonly<{
  companyId: string;
  orderId: string;
  provider: 'mercado_pago' | 'bold' | 'addi' | 'sistecredito' | 'bank_transfer';
  currency: string;
  amountMinor: number;
  requestKey: string;
}>;

/** A deterministic fingerprint used in a future tenant-scoped UNIQUE constraint.
 * Never use this alone for deduplication: the database must enforce uniqueness.
 */
export function paymentAttemptFingerprint(draft: PaymentAttemptDraft): string {
  const supportedProviders = ['mercado_pago','bold','addi','sistecredito','bank_transfer'];
  if (!supportedProviders.includes(draft.provider) ||
      !/^[0-9a-f-]{36}$/i.test(draft.companyId) ||
      !/^[0-9a-f-]{36}$/i.test(draft.orderId) ||
      !/^[0-9a-f-]{36}$/i.test(draft.requestKey) ||
      !/^[A-Z]{3}$/.test(draft.currency) ||
      !Number.isSafeInteger(draft.amountMinor) || draft.amountMinor <= 0) {
    throw new Error('Datos de intento de pago no válidos.');
  }
  return createHash('sha256').update(JSON.stringify([
    draft.companyId,draft.orderId,draft.provider,draft.currency,
    draft.amountMinor,draft.requestKey,
  ])).digest('hex');
}

export function newPaymentAttemptReference(): string {
  return randomUUID();
}

/** Default deny until the exact merchant's credentials and provider callback are verified. */
export function mayInitiateLiveCheckout(input: {
  companyVerified: boolean;
  merchantConnectionVerified: boolean;
  providerCheckoutEnabled: boolean;
  orderEligible: boolean;
  orderMatchesCompany: boolean;
}): boolean {
  return Object.values(input).every(value=>value===true);
}
