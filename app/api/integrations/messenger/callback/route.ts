import { NextRequest, NextResponse } from 'next/server';

import { isMessengerDisabledInStaging } from '../../../../lib/staging-messenger-gate';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // In staging, never forward an OAuth code or provider error details.
  // Use a fixed destination, not caller-controlled forwarded headers.
  if (isMessengerDisabledInStaging(request.nextUrl.hostname)) {
    const destination = new URL(
      '/configuracion/integraciones',
      'https://mw1-web-staging-staging.up.railway.app',
    );
    destination.searchParams.set(
      'messenger_error',
      'La autorización de Messenger todavía no está habilitada en MW1 staging.',
    );
    const denied = NextResponse.redirect(destination);
    denied.headers.set('Cache-Control', 'no-store, private');
    denied.headers.set('Referrer-Policy', 'no-referrer');
    return denied;
  }

  const url = new URL(request.url);

  const forwardedHost =
    request.headers.get('x-forwarded-host')?.trim() || '';
  const forwardedProto =
    request.headers.get('x-forwarded-proto')?.trim() || 'https';

  const publicOrigin = forwardedHost
    ? `${forwardedProto}://${forwardedHost}`
    : 'https://chatpro-web-production.up.railway.app';

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const errorDescription =
    url.searchParams.get('error_description');

  if (error) {
    return NextResponse.redirect(
      new URL(
        `/configuracion/integraciones?messenger_error=${encodeURIComponent(
          errorDescription || error,
        )}`,
        publicOrigin,
      ),
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL(
        '/configuracion/integraciones?messenger_error=Meta no devolvió el código de autorización.',
        publicOrigin,
      ),
    );
  }

  return NextResponse.redirect(
    new URL(
      `/configuracion/integraciones?messenger_code=${encodeURIComponent(
        code,
      )}&messenger_state=${encodeURIComponent(state || '')}`,
      publicOrigin,
    ),
  );
}
