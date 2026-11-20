/** Rules shared by inbox cleanup and native Instagram webhook synchronization. */
export function canArchiveAnsweredHumanChat(
  lastMessage: { author_type?: string | null; created_at?: string | null } | null,
  cutoffIso: string,
): boolean {
  if (!lastMessage || lastMessage.author_type !== 'advisor') return false;
  if (!lastMessage.created_at) return false;
  const replyTime = Date.parse(lastMessage.created_at);
  const deadline = Date.parse(cutoffIso);
  return Number.isFinite(replyTime) && Number.isFinite(deadline) && replyTime <= deadline;
}

export function isInstagramNativeOutgoingEcho(
  accountId: string,
  senderId: string,
  recipientId: string,
  isEcho: boolean,
): boolean {
  return Boolean(
    accountId && recipientId && recipientId !== accountId &&
    (senderId === accountId || isEcho),
  );
}
