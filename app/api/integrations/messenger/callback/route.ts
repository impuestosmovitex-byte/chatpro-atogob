import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);

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
        request.url,
      ),
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL(
        '/configuracion/integraciones?messenger_error=Meta no devolvió el código de autorización.',
        request.url,
      ),
    );
  }

  return NextResponse.redirect(
    new URL(
      `/configuracion/integraciones?messenger_code=${encodeURIComponent(
        code,
      )}&messenger_state=${encodeURIComponent(state || '')}`,
      request.url,
    ),
  );
}
