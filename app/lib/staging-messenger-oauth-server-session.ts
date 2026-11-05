import { getInboxSession } from './inbox-auth';
import {
  getMessengerPilotIdentity,
  type MessengerPilotIdentity,
} from './staging-messenger-oauth-protocol';

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
