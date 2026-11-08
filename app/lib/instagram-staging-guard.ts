import type { NextRequest } from 'next/server';

const WEB_HOST = 'mw1-web-staging-staging.up.railway.app';
const STAGING_API_URLS = new Set([
  'https://mw1-api-staging-staging.up.railway.app',
  'http://mw1-api-staging.railway.internal:8080',
]);

/** Recognize the staging public Host independently of the env switch, so a missing flag never causes a production OAuth fallback. */
export function isInstagramStagingRequest(request: NextRequest): boolean {
  return request.headers.get('host')?.split(':')[0]?.toLowerCase() === WEB_HOST ||
    request.nextUrl.hostname === WEB_HOST;
}

/** Reject a production API or an arbitrary URL from the staging OAuth flow. */
export function isInstagramStagingApi(apiBase: string | undefined | null): boolean {
  return typeof apiBase === 'string' && STAGING_API_URLS.has(apiBase.trim().replace(/\/$/, ''));
}
