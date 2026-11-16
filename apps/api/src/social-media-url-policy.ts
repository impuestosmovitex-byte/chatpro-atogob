/**
 * Strict origin policy for remote Instagram / Messenger attachment downloads.
 * Applies only to HTTPS Meta-owned domains that are known to host media.
 * No cookies or bearer tokens are sent by the download handler.
 */
const EXACT_MEDIA_HOSTS = new Set([
  'graph.facebook.com',
  'graph.instagram.com',
  'lookaside.facebook.com',
  'lookaside.instagram.com',
]);
const MEDIA_CDN_SUFFIXES = [
  '.fbcdn.net',
  '.fbsbx.com',
  '.cdninstagram.com',
];

export function parseTrustedSocialMediaUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const hostname = url.hostname.toLowerCase();
  const trusted =
    EXACT_MEDIA_HOSTS.has(hostname) ||
    MEDIA_CDN_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
  if (
    url.protocol !== 'https:' ||
    (url.port && url.port !== '443') ||
    url.username ||
    url.password ||
    !trusted
  ) {
    return null;
  }
  return url;
}
