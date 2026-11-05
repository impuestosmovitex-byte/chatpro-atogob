import { getInboxSession } from './inbox-auth.ts';
import {
  getMessengerPilotIdentity,
  createMessengerPilotOAuthState,
  parseMessengerPilotCallback,
  type MessengerPilotCallback,
  type MessengerPilotIdentity,
} from './staging-messenger-oauth-protocol.ts';

/**
 * SERVER-ONLY, OFFLINE preparation for future Messenger OAuth routes.
 * Derives trusted tenant/user identity exclusively from MW1's signed,
 * unexpired HttpOnly session cookie; never from query strings or JSON.
 *
 * Not wired to any public route. Membership must still be rechecked by
 * the authorized staging API before registering or consuming a nonce.
 * This helper never contacts Meta, Supabase or another service.
 */
export async function getMessengerPilotIdentityFromSessionCookie(
  sessionCookie: string | null | undefined,
): Promise<MessengerPilotIdentity | null> {
  if (typeof sessionCookie !== 'string' ||
      !sessionCookie || sessionCookie.length > 8192) return null;
  try {
    const session = await getInboxSession(sessionCookie);
    return getMessengerPilotIdentity(session);
  } catch {
    return null;
  }
}

/**
 * Future server callback preflight, not a route or token-exchange mechanism.
 * The caller must extract both cookie values from the incoming HTTP request,
 * never from a request body, and must atomically consume the nonce before
 * exchanging any code. Reject returns contain no provider-controlled text.
 */
export async function verifyMessengerPilotCallbackFromServerCookies(
  sessionCookie: string | null | undefined,
  oauthStateCookie: string | null | undefined,
  params: URLSearchParams,
): Promise<MessengerPilotCallback> {
  const identity = await getMessengerPilotIdentityFromSessionCookie(sessionCookie);
  if (!identity || typeof oauthStateCookie !== 'string' ||
      !oauthStateCookie || oauthStateCookie.length > 2048 ||
      !(params instanceof URLSearchParams)) {
    return { valid: false, reason: 'invalid_state' };
  }
  try {
    return parseMessengerPilotCallback(params, identity, oauthStateCookie);
  } catch {
    return { valid: false, reason: 'invalid_state' };
  }
}

/**
 * Offline-only callback completion contract. The injected consumer MUST be
 * the reviewed staging API operation that rechecks tenant membership and
 * atomically consumes the signed state nonce. A valid provider code is never
 * released until consumption succeeds. This helper is not a public route,
 * has no Meta access and cannot enable Messenger.
 */
export async function consumeMessengerPilotCallbackOffline(
  sessionCookie: string | null | undefined,
  oauthStateCookie: string | null | undefined,
  params: URLSearchParams,
  consume: (identity: MessengerPilotIdentity, state: string, cookie: string) => Promise<void>,
): Promise<MessengerPilotCallback> {
  const identity = await getMessengerPilotIdentityFromSessionCookie(sessionCookie);
  if (!identity || typeof oauthStateCookie !== 'string' || !oauthStateCookie ||
      typeof consume !== 'function') {
    return { valid: false, reason: 'invalid_state' };
  }
  // Reuse the same verified identity for both callback validation and nonce
  // consumption. Never re-read a potentially changing session mid-operation.
  if (oauthStateCookie.length > 2048 || !(params instanceof URLSearchParams)) {
    return { valid: false, reason: 'invalid_state' };
  }
  let parsed: MessengerPilotCallback;
  try {
    parsed = parseMessengerPilotCallback(params, identity, oauthStateCookie);
  } catch {
    return { valid: false, reason: 'invalid_state' };
  }
  if (!parsed.valid) return parsed;
  try {
    await consume(identity, parsed.state, oauthStateCookie);
  } catch {
    return { valid: false, reason: 'invalid_state' };
  }
  return parsed;
}

/**
 * Prepare a one-time Messenger OAuth state entirely offline.
 * Registration MUST be performed by the reviewed staging API operation
 * checking the active tenant membership and persisting the nonce atomically.
 * No state may leave this helper when registration fails. A future reviewed
 * route must separately set the secure HttpOnly cookie and enforce the gate.
 * This helper is deliberately not wired to any public endpoint or Meta.
 */
export async function prepareMessengerPilotStartOffline(
  sessionCookie: string | null | undefined,
  register: (identity: MessengerPilotIdentity, state: string) => Promise<void>,
): Promise<string | null> {
  const identity = await getMessengerPilotIdentityFromSessionCookie(sessionCookie);
  if (!identity || typeof register !== 'function') return null;
  try {
    const state = createMessengerPilotOAuthState(identity);
    await register(identity, state);
    return state;
  } catch {
    return null;
  }
}
