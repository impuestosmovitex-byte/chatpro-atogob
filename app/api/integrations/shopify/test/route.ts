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

export async function POST(request: NextRequest) {
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
        { ok: false, error: 'No tienes permiso para probar integraciones.' },
        { status: 403 },
      );
    }

    const { apiBase, inboxKey } = config();
    const response = await fetch(`${apiBase}/integrations/shopify/test`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-chatpro-inbox-key': inboxKey,
      },
      body: JSON.stringify({ company: session.companySlug }),
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
          error instanceof Error ? error.message : 'No se pudo probar Shopify.',
      },
      { status: 500 },
    );
  }
}
