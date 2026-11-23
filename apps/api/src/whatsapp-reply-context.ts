/** Only an explicitly selected, verified WhatsApp message adds reply context. */
export function whatsappQuotedReplyContext(
  providerMessageId?: string | null,
): { context: { message_id: string } } | Record<string, never> {
  const id = providerMessageId?.trim();
  return id ? { context: { message_id: id } } : {};
}
