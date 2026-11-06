import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * Staging-only, server-side signed OAuth state for the future *separate*
 * WhatsApp Business App coexistence Embedded Signup flow.
 *
 * NOT connected to any public route, SDK, Meta signup or provisioning.
 * A future web endpoint MUST first authenticate its signed session and
 * derive the actor from the session, not from a client request body.
 * The state must also be bound to an HttpOnly, Secure, SameSite=Lax cookie.
 * The cookie must be read by the server and cleared on callback.
 *
 * No Meta access tokens or authorization codes are embedded in this state.
 * A separately stored SHA-256 state hash is consumed atomically once.
 */
export type CoexistencePilotActor = {
  companySlug: string;
  companyId: string;
  userId: string;
};
export type CoexistenceSignedState = {
  state: string;
  stateHash: string;
  onboardingId: string;
};
export type VerifiedCoexistenceSignedState = {
  stateHash: string;
  onboardingId: string;
};

const PILOT = 'piloto-mw1-prueba';
const STAGING_DB = 'https://zqfbxqszfnrbwpfukwak.supabase.co';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const STATE_MAX_BYTES = 2048;
const MAX_AGE_MS = 8 * 60 * 1000;
const PURPOSE = 'mw1:whatsapp-coexistence:staging:v1:';

function eligible(actor: CoexistencePilotActor): boolean {
  return actor?.companySlug === PILOT &&
    typeof actor.companyId === 'string' && UUID.test(actor.companyId) &&
    typeof actor.userId === 'string' && UUID.test(actor.userId) &&
    process.env.MW1_STAGING_MODE === 'true' &&
    process.env.SUPABASE_URL?.trim().replace(/\/$/, '') === STAGING_DB;
}
function secret(): string | null {
  const value = process.env.MW1_WHATSAPP_COEXISTENCE_OAUTH_STATE_SECRET;
  if (typeof value !== 'string' || value.length < 32 ||
      /[\r\n\u0000]/.test(value)) return null;
  return value;
}
function hash(state: string) {
  return createHash('sha256').update(state, 'utf8').digest('hex');
}

/** Creates a fresh, purpose-bound HMAC state, without contacting Meta/DB. */
export function issueWhatsappCoexistenceSignedState(
  actor: CoexistencePilotActor,
): CoexistenceSignedState | null {
  const key = secret();
  if (!key || !eligible(actor)) return null;
  const onboardingId = randomUUID();
  const payload = {
    v: 1, provider: 'whatsapp_business_app', mode: 'coexistence',
    companyId: actor.companyId, userId: actor.userId,
    onboardingId, nonce: randomBytes(24).toString('base64url'),
    issuedAt: Date.now(),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', key)
    .update(PURPOSE).update(encoded).digest('base64url');
  const state = encoded + '.' + signature;
  if (Buffer.byteLength(state, 'utf8') > STATE_MAX_BYTES) return null;
  return { state, stateHash: hash(state), onboardingId };
}

/**
 * Callback validation. Cookie is mandatory to resist login CSRF/session
 * swaps. The signed payload must exactly match the trusted session actor,
 * mode and one-time onboarding id. A successful signature alone cannot
 * authorize a connection: the state hash MUST still be consumed in the DB.
 */
export function verifyWhatsappCoexistenceSignedState(
  actor: CoexistencePilotActor,
  state: unknown,
  expectedCookieState: unknown,
): VerifiedCoexistenceSignedState | null {
  const key = secret();
  if (!key || !eligible(actor) || typeof state !== 'string' ||
      typeof expectedCookieState !== 'string' ||
      state.length === 0 ||
      Buffer.byteLength(state, 'utf8') > STATE_MAX_BYTES ||
      state.length !== expectedCookieState.length) return null;

  const stateDigest = createHash('sha256').update(state, 'utf8').digest();
  const cookieDigest = createHash('sha256').update(expectedCookieState, 'utf8').digest();
  if (!timingSafeEqual(stateDigest, cookieDigest)) return null;

  const parts = state.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1] ||
      !BASE64URL.test(parts[0]) || !BASE64URL.test(parts[1])) return null;
  const expectedHmac = createHmac('sha256', key)
    .update(PURPOSE).update(parts[0]).digest();
  const providedHmac = Buffer.from(parts[1], 'base64url');
  if (providedHmac.length !== expectedHmac.length ||
      !timingSafeEqual(providedHmac, expectedHmac)) return null;

  let parsed: unknown;
  try {
    const decoded = Buffer.from(parts[0], 'base64url');
    if (decoded.toString('base64url') !== parts[0]) return null;
    parsed = JSON.parse(decoded.toString('utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const v = parsed as Record<string, unknown>;
  const now = Date.now();
  if (Object.keys(v).sort().join(',') !==
      ['v','provider','mode','companyId','userId','onboardingId','nonce','issuedAt'].sort().join(',') ||
      v.v !== 1 || v.provider !== 'whatsapp_business_app' ||
      v.mode !== 'coexistence' ||
      v.companyId !== actor.companyId ||
      v.userId !== actor.userId ||
      typeof v.onboardingId !== 'string' || !UUID.test(v.onboardingId) ||
      typeof v.nonce !== 'string' ||
      !/^[A-Za-z0-9_-]{32}$/.test(v.nonce) ||
      !Number.isSafeInteger(v.issuedAt) ||
      typeof v.issuedAt !== 'number' ||
      v.issuedAt > now ||
      now - v.issuedAt > MAX_AGE_MS) {
    return null;
  }
  return { stateHash: hash(state), onboardingId: v.onboardingId };
}
