import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Offline fail-closed verifier for MW1 Messenger OAuth signed states.
 * Shares the v1 payload contract with the web's staging OAuth protocol.
 * Never registers a route, calls Meta, or accesses a database.
 */
export type MessengerSignedIdentity = {
  companyId: string;
  userId: string;
  companySlug: string;
};

const PILOT = 'piloto-mw1-prueba';
const MAX_AGE_MS = 10 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const B64URL = /^[A-Za-z0-9_-]+$/;

function equalBytes(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function messengerStateHashIfValid(
  state: string,
  identity: MessengerSignedIdentity,
  expectedCookieState?: string,
): string | null {
  if (
    !identity || identity.companySlug !== PILOT ||
    typeof identity.companyId !== 'string' || !UUID.test(identity.companyId) ||
    typeof identity.userId !== 'string' || !UUID.test(identity.userId) ||
    typeof state !== 'string' || state.length > 2048
  ) return null;

  // A callback must match the secure cookie. Registration occurs before
  // the callback and intentionally has no cookie comparison.
  if (expectedCookieState !== undefined &&
      (typeof expectedCookieState !== 'string' ||
       !equalBytes(state, expectedCookieState))) return null;

  const parts = state.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1] ||
      !B64URL.test(parts[0]) || !B64URL.test(parts[1])) return null;

  const secret = process.env.MW1_MESSENGER_OAUTH_STATE_SECRET?.trim();
  if (!secret || secret.length < 32) return null;

  const expected = createHmac('sha256', secret).update(parts[0]).digest();
  const supplied = Buffer.from(parts[1], 'base64url');
  if (supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)) return null;

  let value: unknown;
  try { value = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); }
  catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const data = value as Record<string, unknown>;
  const now = Date.now();
  if (
    data.v !== 1 || data.provider !== 'messenger' ||
    data.companyId !== identity.companyId ||
    data.userId !== identity.userId ||
    typeof data.nonce !== 'string' ||
    !/^[A-Za-z0-9_-]{32}$/.test(data.nonce) ||
    !Number.isSafeInteger(data.issuedAt) ||
    (data.issuedAt as number) > now ||
    now - (data.issuedAt as number) > MAX_AGE_MS
  ) return null;

  return createHash('sha256').update(state).digest('hex');
}
