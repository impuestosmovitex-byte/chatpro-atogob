import { NextRequest, NextResponse } from 'next/server';
import { getInboxSession, INBOX_SESSION_COOKIE } from '../../../lib/inbox-auth';

export const dynamic = 'force-dynamic';

function config() {
  const apiBase = process.env.CHATPRO_API_URL?.trim().replace(/\/$/, '');
  const inboxKey = process.env.CHATPRO_INBOX_KEY?.trim();

  if (!apiBase || !inboxKey) {
    throw new Error('Faltan CHATPRO_API_URL o CHATPRO_INBOX_KEY.');
  }

  return { apiBase, inboxKey };
}

async function currentUser(request: NextRequest) {
  const session = await getInboxSession(
    request.cookies.get(INBOX_SESSION_COOKIE)?.value,
  );

  if (!session?.userId || session.type !== 'user') {
    return null;
  }

  return session.userId;
}

export async function GET(request: NextRequest) {
  try {
    const userId = await currentUser(request);

    if (!userId) {
      return NextResponse.json(
        { ok: false, error: 'Sesión de usuario requerida.' },
        { status: 401 },
      );
    }

    const { apiBase, inboxKey } = config();
    const target = new URL(`${apiBase}/platform-admin/companies`);
    target.searchParams.set('user', userId);

    const response = await fetch(target, {
      headers: { 'x-chatpro-inbox-key': inboxKey },
      cache: 'no-store',
    });

    return new NextResponse(await response.text(), {
      status: response.status,
      headers: {
        'content-type': response.headers.get('content-type') || 'application/json',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'No se pudieron cargar las empresas.',
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await currentUser(request);

    if (!userId) {
      return NextResponse.json(
        { ok: false, error: 'Sesión de usuario requerida.' },
        { status: 401 },
      );
    }

    const payload = await request.json();
    const { apiBase, inboxKey } = config();
    const target = new URL(`${apiBase}/platform-admin/companies`);
    target.searchParams.set('user', userId);

    const response = await fetch(target, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-chatpro-inbox-key': inboxKey,
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

    return new NextResponse(await response.text(), {
      status: response.status,
      headers: {
        'content-type': response.headers.get('content-type') || 'application/json',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo crear la empresa.',
      },
      { status: 500 },
    );
  }
}
