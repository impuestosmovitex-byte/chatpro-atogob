import { NextRequest, NextResponse } from 'next/server';
import { getInboxSession, INBOX_SESSION_COOKIE } from '../../../../lib/inbox-auth';

export const dynamic = 'force-dynamic';

function config() {
  const apiBase = process.env.CHATPRO_API_URL?.trim().replace(/\/$/, '');
  const inboxKey = process.env.CHATPRO_INBOX_KEY?.trim();

  if (!apiBase || !inboxKey) {
    throw new Error('Faltan CHATPRO_API_URL o CHATPRO_INBOX_KEY.');
  }

  return { apiBase, inboxKey };
}

export async function GET(request: NextRequest) {
  try {
    const session = await getInboxSession(
      request.cookies.get(INBOX_SESSION_COOKIE)?.value,
    );

    if (!session) {
      return NextResponse.json(
        { ok: false, error: 'Sesión requerida.' },
        { status: 401 },
      );
    }

    if (session.roleKey !== 'owner' && session.roleKey !== 'admin') {
      return NextResponse.json(
        { ok: false, error: 'No tienes permiso para administrar integraciones.' },
        { status: 403 },
      );
    }

    const company =
      request.nextUrl.searchParams.get('company')?.trim().toLowerCase() || '';
    const shop = request.nextUrl.searchParams.get('shop')?.trim() || '';

    if (!company || !shop) {
      return NextResponse.json(
        { ok: false, error: 'Falta la empresa o el dominio de Shopify.' },
        { status: 400 },
      );
    }

    const { apiBase, inboxKey } = config();
    const target = new URL(`${apiBase}/integrations/shopify/connect`);
    target.searchParams.set('company', company);
    target.searchParams.set('shop', shop);

    const response = await fetch(target, {
      headers: { 'x-chatpro-inbox-key': inboxKey },
      cache: 'no-store',
    });

    return new NextResponse(await response.text(), {
      status: response.status,
      headers: {
        'content-type':
          response.headers.get('content-type') || 'application/json',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : 'No se pudo iniciar Shopify.',
      },
      { status: 500 },
    );
  }
}
