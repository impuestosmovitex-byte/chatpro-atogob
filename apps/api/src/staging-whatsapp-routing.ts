/** Extract untrusted candidate phone IDs from Meta webhook payloads.
 * Only call after checking the original-byte X-Hub-Signature-256.
 * The caller must resolve each ID against tenant-owned integrations.
 */
export function extractStagingWhatsappPhoneIds(input: unknown): string[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return [];
  const entries = (input as {entry?: unknown}).entry;
  if (!Array.isArray(entries) || entries.length > 50) return [];
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const changes = (entry as {changes?: unknown}).changes;
    if (!Array.isArray(changes) || changes.length > 50) continue;
    for (const change of changes) {
      if (!change || typeof change !== 'object' || Array.isArray(change)) continue;
      const value = (change as {value?: unknown}).value;
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const metadata = (value as {metadata?: unknown}).metadata;
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) continue;
      const candidate = (metadata as {phone_number_id?: unknown}).phone_number_id;
      if (typeof candidate === 'string' && /^[0-9]{6,30}$/.test(candidate)) ids.add(candidate);
    }
  }
  return [...ids];
}
