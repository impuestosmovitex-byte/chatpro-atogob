/** Safe hosted checkout URL validation for a future Mercado Pago adapter.
 * Never accept an arbitrary link from chat, merchant input or webhook payload.
 * Only provider API responses obtained server-side may be passed here.
 */
export function validatedMercadoPagoCheckoutUrl(
  candidate: unknown,
  providerApiVerified: boolean,
): string | null {
  if (!providerApiVerified || typeof candidate !== 'string' || candidate.length > 2048) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
    const hosts = new Set([
      'www.mercadopago.com.co',
      'mercadopago.com.co',
      'www.mercadopago.com',
      'mercadopago.com',
    ]);
    if (!hosts.has(url.hostname.toLowerCase())) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Checkout can only be created with a server-derived amount and verified merchant context. */
export function merchantCheckoutGate(input: {
  verifiedMerchantConnection:boolean;
  authorizedTenant:boolean;
  orderTenantMatches:boolean;
  orderEligible:boolean;
  attemptMatchesOrder:boolean;
  idempotencyKeyPresent:boolean;
  providerSandboxConfigured:boolean;
}):boolean {
  return Object.values(input).every(x=>x===true);
}
