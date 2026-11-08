/**
 * Keep the original MIME type for received WhatsApp media. Falling through
 * to the image default for audio/video prevents correct playback/download.
 */
export function resolveInboxMediaMimeType(
  messageType: string,
  storageMimeType?: string | null,
  recordedMimeType?: string | null,
): string {
  const stored = storageMimeType?.trim();
  const recorded = recordedMimeType?.trim();
  if (stored) return stored;
  if (recorded) return recorded;

  switch (messageType) {
    case 'image':
      return 'image/jpeg';
    case 'audio':
      return 'audio/ogg';
    case 'video':
      return 'video/mp4';
    default:
      return 'application/octet-stream';
  }
}

export function resolveInboxMediaFilename(
  messageType: string,
  storagePath?: string | null,
): string {
  const fromPath = storagePath?.split('/').pop()?.trim();
  if (fromPath) return fromPath;
  switch (messageType) {
    case 'image':
      return 'imagen.jpg';
    case 'audio':
      return 'audio.ogg';
    case 'video':
      return 'video.mp4';
    default:
      return 'archivo';
  }
}
