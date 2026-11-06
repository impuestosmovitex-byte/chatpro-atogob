/**
 * Messenger's legacy ChatPro browser-token OAuth is not authorized for the
 * isolated MW1 staging pilot. Keep all login, exchange and completion routes
 * fail-closed until a separate reviewed server-side flow is implemented.
 *
 * This check does not enable any integration or affect production domains.
 */
export const MW1_STAGING_MESSENGER_HOST =
  'mw1-web-staging-staging.up.railway.app';

export function isMessengerDisabledInStaging(hostname: string): boolean {
  return hostname.toLowerCase() === MW1_STAGING_MESSENGER_HOST;
}
