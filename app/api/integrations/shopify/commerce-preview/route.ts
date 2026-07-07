import { NextRequest, NextResponse } from 'next/server';
import {
  getInboxSession,
  INBOX_SESSION_COOKIE,
} from '../../../../lib/inbox-auth';

export const dynamic = 'force-dynamic';

function config() {
  const apiBase = process.env.CHATPRO_API_URL?.trim().replace(/\/$/, '');
  const inboxKey = process.env.CHATPRO_INBOX_KEY?.trim();

  if (!apiBase || !inboxKey) {
    throw new Error('Faltan CHATPRO_API_URL o CHATPRO_INBOX_KEY.');
  }

  return { apiBase, inboxKey };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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

    let value: unknown = {};

    try {
      value = await request.json();
    } catch {
      value = {};
    }

    const payload =
      value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};

    const handle = text(payload.handle).toLowerCase().slice(0, 160);
    const { apiBase, inboxKey } = config();

    const response = await fetch(
      `${apiBase}/integrations/shopify/commerce-preview`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-chatpro-inbox-key': inboxKey,
        },
        body: JSON.stringify({
          company: session.companySlug,
          ...(handle ? { handle } : {}),
        }),
        cache: 'no-store',
      },
    );

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
          error instanceof Error
            ? error.message
            : 'No se pudo ejecutar la prueba comercial.',
      },
      { status: 500 },
    );
  }
}
