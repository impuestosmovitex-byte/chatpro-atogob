import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ChatProSession } from './inbox-auth';

/**
 * Offline-only building blocks for a future server-side Messenger OAuth.
 * Messenger remains fail-closed in staging. These functions are not wired to
 * an authorization endpoint, Meta, or a database.
 *
 * A future exchange must additionally verify the session membership with the
 * staging API and atomically consume a stored nonce. Signatures alone do not
 * prevent replay.
 */
export const MESSENGER_PILOT_SLUG = 'piloto-mw1-prueba';
export const MESSENGER_STATE_MAX_AGE_MS = 10 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SignedMessengerPayload = {
  v: 1;
  provider: 'messenger';
  companyId: string;
  userId: string;
  nonce: string;
  issuedAt: number;
};

export type MessengerPilotIdentity = {
  companyId: string;
  userId: string;
  companySlug: typeof MESSENGER_PILOT_SLUG;
};

export function getMessengerPilotIdentity(
  session: ChatProSession | null,
): MessengerPilotIdentity | null {
  if (!session || session.type !== 'user' ||
      !['owner', 'admin'].includes(session.roleKey?.toLowerCase()) ||
      session.companySlug !== MESSENGER_PILOT_SLUG ||
      typeof session.companyId !== 'string' || !UUID.test(session.companyId) ||
      typeof session.userId !== 'string' || !UUID.test(session.userId) ||
      !Number.isSafeInteger(session.expiresAt) ||
      session.expiresAt <= Date.now()) return null;

  return {
    companyId: session.companyId,
    userId: session.userId,
    companySlug: MESSENGER_PILOT_SLUG,
  };
}

function stateSecret(): string {
  const secret = process.env.MW1_MESSENGER_OAUTH_STATE_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error('Falta la clave segura de estado OAuth de Messenger.');
  }
  return secret;
}

export function createMessengerPilotOAuthState(
  identity: MessengerPilotIdentity,
): string {
  if (!UUID.test(identity.companyId ?? '') || !UUID.test(identity.userId ?? '') ||
      identity.companySlug !== MESSENGER_PILOT_SLUG) {
    throw new Error('Identidad de empresa piloto no válida.');
  }
  const value: SignedMessengerPayload = {
    v: 1, provider: 'messenger',
    companyId: identity.companyId,
    userId: identity.userId,
    nonce: randomBytes(24).toString('base64url'),
    issuedAt: Date.now(),
  };
  const encoded = Buffer.from(JSON.stringify(value)).toString('base64url');
  const signature = createHmac('sha256', stateSecret())
    .update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

export function verifyMessengerPilotOAuthState(
  state: string,
  identity: MessengerPilotIdentity,
  maxAgeMs = MESSENGER_STATE_MAX_AGE_MS,
): SignedMessengerPayload | null {
  if (!state || state.length > 2048 || !Number.isSafeInteger(maxAgeMs) ||
      maxAgeMs <= 0 || maxAgeMs > MESSENGER_STATE_MAX_AGE_MS) return null;
  const parts = state.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1] ||
      !/^[A-Za-z0-9_-]+$/.test(parts[0]) ||
      !/^[A-Za-z0-9_-]+$/.test(parts[1])) return null;
  const expected = createHmac('sha256', stateSecret()).update(parts[0]).digest();
  const given = Buffer.from(parts[1], 'base64url');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch { return null; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const result = payload as SignedMessengerPayload;
  const now = Date.now();
  if (result.v !== 1 || result.provider !== 'messenger' ||
      result.companyId !== identity.companyId ||
      result.userId !== identity.userId ||
      !UUID.test(identity.companyId) || !UUID.test(identity.userId) ||
      identity.companySlug !== MESSENGER_PILOT_SLUG ||
      typeof result.nonce !== 'string' ||
      !/^[A-Za-z0-9_-]{32}$/.test(result.nonce) ||
      !Number.isSafeInteger(result.issuedAt) ||
      result.issuedAt > now || now - result.issuedAt > maxAgeMs) return null;
  return result;
}

export type MessengerPilotCallback =
  | { valid: true; code: string; state: string }
  | { valid: false; reason: 'invalid_parameters' | 'provider_denied' |
      'missing_code' | 'invalid_state' };

/**
 * Validate an OAuth provider return server-side. Never copy returned codes or
 * descriptions into user-visible redirects. The caller must consume a nonce
 * atomically before any token exchange; this function alone is NOT sufficient.
 */
export function parseMessengerPilotCallback(
  params: URLSearchParams,
  identity: MessengerPilotIdentity,
  expectedCookieState: string,
): MessengerPilotCallback {
  const codes = params.getAll('code');
  const states = params.getAll('state');
  const errors = params.getAll('error');
  const descriptions = params.getAll('error_description');

  if (states.length !== 1 || !states[0] || states[0].length > 2048 ||
      codes.length > 1 || errors.length > 1 || descriptions.length > 1 ||
      (codes.length > 0 && errors.length > 0) ||
      (descriptions.length && !errors.length)) {
    return { valid: false, reason: 'invalid_parameters' };
  }
  if (!expectedCookieState || states[0] !== expectedCookieState) {
    return { valid: false, reason: 'invalid_state' };
  }
  let verified: SignedMessengerPayload | null = null;
  try {
    verified = verifyMessengerPilotOAuthState(states[0], identity);
  } catch { return { valid: false, reason: 'invalid_state' }; }
  if (!verified) return { valid: false, reason: 'invalid_state' };

  if (errors.length) return { valid: false, reason: 'provider_denied' };
  if (!codes.length) return { valid: false, reason: 'missing_code' };
  if (!codes[0] || !codes[0].trim() || codes[0].length > 4096) {
    return { valid: false, reason: 'invalid_parameters' };
  }
  return { valid: true, code: codes[0], state: states[0] };
}
