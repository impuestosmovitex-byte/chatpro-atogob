import {
  NextRequest,
  NextResponse,
} from 'next/server';

import { getInboxSession, INBOX_SESSION_COOKIE } from '../../../../lib/inbox-auth';
import { verifyInstagramOAuthState } from '../../../../lib/instagram-oauth-state';

export const dynamic =
  'force-dynamic';

// A rejected staging authorization cannot be resumed with its old cookie.
// Keep the cookie path identical to the one used by the OAuth begin route.
function rejectStagingReturn(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'no-store, private');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.cookies.set('mw1_ig_oauth_state', '', {
    httpOnly: true, secure: true, sameSite: 'lax',
    maxAge: 0, path: '/api/integrations/instagram',
  });
  return response;
}

export async function GET(
  request: NextRequest,
) {
  const url =
    new URL(request.url);

  // Never trust caller-controlled forwarded host/protocol headers for OAuth redirects.
  // Keep the authorization response on this application's own origin.
  const publicOrigin = request.nextUrl.origin;

  const code =
    url.searchParams.get('code');

  const state =
    url.searchParams.get('state');

  const error =
    url.searchParams.get('error');

  const errorDescription =
    url.searchParams.get(
      'error_description',
    );

  const isStaging =
    request.nextUrl.hostname === 'mw1-web-staging-staging.up.railway.app';

  // Preserve the existing non-staging OAuth error handling unchanged.
  // In staging, even a provider error must have a valid signed request state.
  if (error && !isStaging) {
    return NextResponse.redirect(
      new URL(
        `/configuracion/integraciones?instagram_error=${encodeURIComponent(
          errorDescription || error,
        )}`,
        publicOrigin,
      ),
    );
  }

  if (isStaging) {
    const expected = request.cookies.get('mw1_ig_oauth_state')?.value || '';
    const session = await getInboxSession(request.cookies.get(INBOX_SESSION_COOKIE)?.value);
    let valid = Boolean(
      session?.type === 'user' &&
      (session.roleKey === 'owner' || session.roleKey === 'admin') &&
      session.companySlug === 'piloto-mw1-prueba' &&
      state && expected && state === expected &&
      process.env.MW1_STAGING_INSTAGRAM_ONBOARDING_ENABLED === 'true' &&
      process.env.MW1_STAGING_INSTAGRAM_OAUTH_ENABLED === 'true',
    );
    if (valid && session?.userId && session.companyId) {
      try {
        valid = Boolean(verifyInstagramOAuthState(state!, session.companyId, session.userId));
      } catch {
        valid = false;
      }
    } else {
      valid = false;
    }
    if (!valid) {
      const denied = NextResponse.redirect(
        new URL('/configuracion/integraciones?instagram_error=Autorizacion%20de%20Instagram%20no%20valida', publicOrigin),
      );
      return rejectStagingReturn(denied);
    }
  }

  if (error) {
    // Avoid reflecting arbitrary provider-supplied text into an OAuth error URL.
    const denied = NextResponse.redirect(
      new URL(
        '/configuracion/integraciones?instagram_error=Meta%20no%20autorizo%20la%20conexion%20de%20Instagram',
        publicOrigin,
      ),
    );
    return isStaging ? rejectStagingReturn(denied) : denied;
  }

  if (!code) {
    const denied = NextResponse.redirect(
      new URL(
        '/configuracion/integraciones?instagram_error=Meta no devolvió el código de autorización.',
        publicOrigin,
      ),
    );
    return isStaging ? rejectStagingReturn(denied) : denied;
  }

  const response = NextResponse.redirect(
    new URL(
      `/configuracion/integraciones?instagram_code=${encodeURIComponent(
        code,
      )}&instagram_state=${encodeURIComponent(
        state || '',
      )}`,
      publicOrigin,
    ),
  );
  response.headers.set('Cache-Control', 'no-store, private');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
