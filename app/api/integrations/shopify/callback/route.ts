import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const apiBase = process.env.CHATPRO_API_URL?.trim().replace(/\/$/, '');

  if (!apiBase) {
    return new NextResponse('Falta CHATPRO_API_URL.', { status: 500 });
  }

  const target = new URL(`${apiBase}/integrations/shopify/callback`);
  request.nextUrl.searchParams.forEach((value, key) => {
    target.searchParams.append(key, value);
  });

  try {
    const response = await fetch(target, { cache: 'no-store' });

    return new NextResponse(await response.text(), {
      status: response.status,
      headers: {
        'content-type':
          response.headers.get('content-type') || 'text/html; charset=utf-8',
      },
    });
  } catch {
    return new NextResponse('No se pudo completar la conexión con Shopify.', {
      status: 500,
    });
  }
}
