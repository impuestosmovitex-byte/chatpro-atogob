/**
 * Presentation-only status for Instagram. Staging must never claim a live
 * messaging connection merely because a database row says "active".
 * This helper does not enable OAuth or mutate integrations.
 */
export type InstagramRowStatus = 'pending' | 'active' | 'disconnected' | 'error';

export function getInstagramDisplayStatus({
  status = 'disconnected',
  isStaging,
  connectionEnabled,
  authorizationEnabled,
}: {
  status?: InstagramRowStatus;
  isStaging: boolean;
  connectionEnabled?: boolean;
  authorizationEnabled?: boolean;
}) {
  const connected = status === 'active' && (!isStaging || connectionEnabled === true);
  const pending = status === 'pending' || (isStaging && status === 'active' && !connected);

  return {
    connected,
    pending,
    requiresReconnect: status === 'error',
    authorizationBlocked: isStaging && authorizationEnabled !== true,
  };
}
