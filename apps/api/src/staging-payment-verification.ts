export type PaymentVerification = Readonly<{
  companyId: string;
  orderId: string;
  orderCompanyId: string;
  externalReference: string;
  callbackReference: string;
  currency: string;
  callbackCurrency: string;
  amountMinor: number;
  callbackAmountMinor: number;
  providerSignatureVerified: boolean;
  fetchedFromProviderApi: boolean;
  providerPaymentState: 'approved'|'pending'|'rejected'|'refunded';
}>;

/** Payment confirmation must never rely exclusively on a browser redirect,
 * chat text, user-submitted screenshot or unverified webhook payload. */
export function verifiedMerchantPayment(input:PaymentVerification):boolean {
  return input.providerSignatureVerified === true &&
    input.fetchedFromProviderApi === true &&
    input.providerPaymentState === 'approved' &&
    input.companyId.length > 0 && input.companyId === input.orderCompanyId &&
    input.orderId.length > 0 &&
    input.externalReference.length > 0 &&
    input.externalReference === input.callbackReference &&
    /^[A-Z]{3}$/.test(input.currency) &&
    input.currency === input.callbackCurrency &&
    Number.isSafeInteger(input.amountMinor) && input.amountMinor > 0 &&
    input.amountMinor === input.callbackAmountMinor;
}

export function paymentReviewStatus(input:PaymentVerification):'verified'|'needs_review' {
  return verifiedMerchantPayment(input)?'verified':'needs_review';
}