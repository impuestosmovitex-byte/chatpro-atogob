/**
 * Offline, fail-closed policy for a future one-time WhatsApp Business App
 * Coexistence contacts/history sync. NO network requests, database writes or
 * webhooks. Callers must verify Meta's signed events, OAuth credentials,
 * account ownership and tenant authorization independently.
 *
 * Meta allows one request per sync type during the first 24 hours after
 * onboarding. The future adapter MUST atomically reserve the returned
 * idempotency key in a tenant-scoped unique store BEFORE contacting Meta;
 * calculating a key alone is not a duplicate-prevention mechanism.
 */
export type WhatsappAppSyncKind = 'history' | 'smb_app_state_sync';
export type WhatsappAppSyncState =
  | 'never_requested' | 'reserved' | 'requested' | 'completed'
  | 'declined' | 'window_closed' | 'failed_unknown';
export type WhatsappAppSyncBlockReason =
  | 'invalid_context' | 'tenant_mismatch' | 'phone_mismatch'
  | 'not_coexistence' | 'not_ready' | 'not_authorized'
  | 'consent_required' | 'window_closed' | 'already_attempted';

export type WhatsappAppSyncContext = {
  companyId: string;
  sessionCompanyId: string;
  phoneNumberId: string;
  ownedPhoneNumberId: string;
  onboardingId: string;
  mode: 'cloud_api' | 'coexistence';
  registrationActive: boolean;
  webhooksSubscribed: boolean;
  adminAuthorized: boolean;
  consentToShare: boolean;
  kind: WhatsappAppSyncKind;
  priorState: WhatsappAppSyncState;
  onboardedAtMs: number;
  nowMs: number;
};
export type WhatsappAppSyncDecision =
  | { allowed: false; reason: WhatsappAppSyncBlockReason }
  | { allowed: true; syncType: WhatsappAppSyncKind;
      idempotencyKey: string; expiresAtMs: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHONE_ID = /^[0-9]{6,30}$/;
const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Plans (does not perform) a one-time Meta sync operation. Explicit
 * opt-in/consent is required for EACH data type; no consent is inferred
 * from an Embedded Signup completion. A missing or unknown previous state
 * cannot be used to make a request.
 */
export function planWhatsappCoexistenceSync(
  context: WhatsappAppSyncContext,
): WhatsappAppSyncDecision {
  if (!context || typeof context !== 'object') {
    return { allowed: false, reason: 'invalid_context' };
  }
  const c = context;
  if (!UUID.test(c.companyId ?? '') || !UUID.test(c.sessionCompanyId ?? '') ||
      !UUID.test(c.onboardingId ?? '') ||
      !PHONE_ID.test(c.phoneNumberId ?? '') ||
      !PHONE_ID.test(c.ownedPhoneNumberId ?? '') ||
      !['history', 'smb_app_state_sync'].includes(c.kind) ||
      typeof c.onboardedAtMs !== 'number' ||
      typeof c.nowMs !== 'number' ||
      !Number.isSafeInteger(c.onboardedAtMs) ||
      !Number.isSafeInteger(c.nowMs) ||
      c.onboardedAtMs <= 0 || c.nowMs <= 0 ||
      typeof c.registrationActive !== 'boolean' ||
      typeof c.webhooksSubscribed !== 'boolean' ||
      typeof c.adminAuthorized !== 'boolean' ||
      typeof c.consentToShare !== 'boolean') {
    return { allowed: false, reason: 'invalid_context' };
  }
  if (c.companyId.toLowerCase() !== c.sessionCompanyId.toLowerCase()) {
    return { allowed: false, reason: 'tenant_mismatch' };
  }
  if (c.phoneNumberId !== c.ownedPhoneNumberId) {
    return { allowed: false, reason: 'phone_mismatch' };
  }
  if (c.mode !== 'coexistence') {
    return { allowed: false, reason: 'not_coexistence' };
  }
  if (!c.registrationActive || !c.webhooksSubscribed) {
    return { allowed: false, reason: 'not_ready' };
  }
  if (!c.adminAuthorized) {
    return { allowed: false, reason: 'not_authorized' };
  }
  if (!c.consentToShare) {
    return { allowed: false, reason: 'consent_required' };
  }
  const elapsedMs = c.nowMs - c.onboardedAtMs;
  if (elapsedMs < 0 || elapsedMs >= WINDOW_MS) {
    return { allowed: false, reason: 'window_closed' };
  }
  if (c.priorState !== 'never_requested') {
    return { allowed: false, reason: 'already_attempted' };
  }
  return {
    allowed: true,
    syncType: c.kind,
    // Designed to be unique per tenant, onboarding instance, number and
    // type. A persistent UNIQUE constraint / atomic reservation is required.
    idempotencyKey: [
      c.companyId.toLowerCase(), c.onboardingId.toLowerCase(),
      c.phoneNumberId, c.kind,
    ].join(':'),
    expiresAtMs: c.onboardedAtMs + WINDOW_MS,
  };
}
