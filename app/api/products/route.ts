import { NextRequest, NextResponse } from 'next/server';
import {
  getInboxSession,
  INBOX_SESSION_COOKIE,
} from '../../lib/inbox-auth';

export const dynamic = 'force-dynamic';

function config() {
  const apiBase = process.env.CHATPRO_API_URL?.trim().replace(/\/$/, '');
  const inboxKey = process.env.CHATPRO_INBOX_KEY?.trim();

  if (!apiBase || !inboxKey) {
    throw new Error('Faltan CHATPRO_API_URL o CHATPRO_INBOX_KEY.');
  }

  return { apiBase, inboxKey };
}

function text(value: string | null): string {
  return value?.trim() || '';
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

    const { apiBase, inboxKey } = config();
    const target = new URL(`${apiBase}/company-products`);

    target.searchParams.set('company', session.companySlug);

    for (const key of ['search', 'status', 'after', 'limit']) {
      const value = text(request.nextUrl.searchParams.get(key));

      if (value) {
        target.searchParams.set(key, value);
      }
    }

    const response = await fetch(target, {
      headers: {
        'x-chatpro-inbox-key': inboxKey,
      },
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
          error instanceof Error
            ? error.message
            : 'No se pudieron consultar los productos.',
      },
      { status: 500 },
    );
  }
}
