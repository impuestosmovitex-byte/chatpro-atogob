import {
  NextRequest,
  NextResponse,
} from 'next/server';

export const dynamic =
  'force-dynamic';

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

  if (error) {
    return NextResponse.redirect(
      new URL(
        `/configuracion/integraciones?instagram_error=${encodeURIComponent(
          errorDescription || error,
        )}`,
        publicOrigin,
      ),
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL(
        '/configuracion/integraciones?instagram_error=Meta no devolvió el código de autorización.',
        publicOrigin,
      ),
    );
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
