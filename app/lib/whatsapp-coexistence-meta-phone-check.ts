/**
 * Offline-only validation of phone-number details returned by Meta Graph.
 * Inputs must be supplied by a trusted server flow that first exchanges an
 * authorized ONE-TIME OAuth code and checks tenant ownership. This helper
 * makes no network calls, stores no tokens, and cannot enable integrations.
 *
 * Future read-only Graph calls using the verified business token:
 * GET /{WABA_ID}/phone_numbers?fields=id
 * GET /{PHONE_NUMBER_ID}?fields=is_on_biz_app,platform_type
 */
export type CoexistenceMetaPhoneCheck =
  | { verified: true; phoneNumberId: string; wabaId: string }
  | { verified: false; reason:
      'invalid_identifiers' | 'invalid_response' | 'phone_not_in_waba'
      | 'ambiguous_phone' | 'phone_mismatch' | 'not_coexistence' };

const META_ID = /^[0-9]{6,30}$/;
function asObject(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === 'object' && !Array.isArray(v)
    ? v as Record<string, unknown> : null;
}

/**
 * Fail closed on malformed, ambiguous or mismatched Meta responses.
 * Explicit chosen phoneNumberId MUST be confirmed in the WABA's phone list
 * and a separate direct phone lookup.
 * The conjunction is_on_biz_app === true and platform_type === CLOUD_API
 * proves only Meta-reported coexistence status. It does NOT prove MW1
 * tenant ownership, OAuth scope, user consent or webhook readiness.
 */
export function verifyCoexistenceMetaPhone(
  wabaId: unknown,
  phoneNumberId: unknown,
  wabaPhoneList: unknown,
  phoneDetails: unknown,
): CoexistenceMetaPhoneCheck {
  if (typeof wabaId !== 'string' || !META_ID.test(wabaId) ||
      typeof phoneNumberId !== 'string' || !META_ID.test(phoneNumberId)) {
    return { verified: false, reason: 'invalid_identifiers' };
  }
  const listed = asObject(wabaPhoneList);
  const details = asObject(phoneDetails);
  if (!listed || !details || !Array.isArray(listed.data) ||
      listed.data.length < 1 || listed.data.length > 1000) {
    return { verified: false, reason: 'invalid_response' };
  }
  const paging = asObject(listed.paging);
  // A partial WABA list is never evidence of absence. Future adapters must
  // follow all authorized pages before asking this helper to decide.
  if (paging?.next != null) return { verified: false, reason: 'invalid_response' };
  const ids: string[] = [];
  for (const row of listed.data) {
    const item = asObject(row);
    if (typeof item?.id !== 'string' || !META_ID.test(item.id)) {
      return { verified: false, reason: 'invalid_response' };
    }
    ids.push(item.id);
  }
  if (new Set(ids).size !== ids.length) {
    return { verified: false, reason: 'ambiguous_phone' };
  }
  if (!ids.includes(phoneNumberId)) {
    return { verified: false, reason: 'phone_not_in_waba' };
  }
  if (details.id !== phoneNumberId) {
    return { verified: false, reason: 'phone_mismatch' };
  }
  if (details.is_on_biz_app !== true || details.platform_type !== 'CLOUD_API') {
    return { verified: false, reason: 'not_coexistence' };
  }
  return { verified: true, wabaId, phoneNumberId };
}
