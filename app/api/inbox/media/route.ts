import { NextRequest, NextResponse } from 'next/server';
import {
  INBOX_SESSION_COOKIE,
  getInboxSession,
} from '../../../lib/inbox-auth';

export const dynamic = 'force-dynamic';

function config() {
  const apiBase = process.env.CHATPRO_API_URL?.trim().replace(/\/$/, '');
  const inboxKey = process.env.CHATPRO_INBOX_KEY?.trim();

  if (!apiBase || !inboxKey) {
    throw new Error('Faltan CHATPRO_API_URL o CHATPRO_INBOX_KEY.');
  }

  return { apiBase, inboxKey };
}

function trustedHeaders(
  inboxKey: string,
  session: NonNullable<Awaited<ReturnType<typeof getInboxSession>>>,
) {
  const headers: Record<string, string> = {
    'x-chatpro-inbox-key': inboxKey,
    'x-chatpro-session-type': session.type,
    'x-chatpro-user-name': session.fullName,
    'x-chatpro-company-id': session.companyId,
    'x-chatpro-role-key': session.roleKey,
  };

  if (session.type === 'user' && session.userId) {
    headers['x-chatpro-user-id'] = session.userId;
  }

  return headers;
}

export async function GET(request: NextRequest) {
  const session = await getInboxSession(
    request.cookies.get(INBOX_SESSION_COOKIE)?.value,
  );

  if (!session) {
    return NextResponse.json(
      { ok: false, error: 'Sesión requerida.' },
      { status: 401 },
    );
  }

  try {
    const sessionId =
      request.nextUrl.searchParams.get('sessionId')?.trim() ?? '';
    const messageId =
      request.nextUrl.searchParams.get('messageId')?.trim() ?? '';

    if (!sessionId || !messageId) {
      return NextResponse.json(
        { ok: false, error: 'Falta identificar el audio.' },
        { status: 400 },
      );
    }

    const { apiBase, inboxKey } = config();
    const target = new URL(
      `${apiBase}/inbox/${encodeURIComponent(
        sessionId,
      )}/messages/${encodeURIComponent(messageId)}/media`,
    );
    target.searchParams.set('company', session.companySlug);

    const response = await fetch(target, {
      headers: trustedHeaders(inboxKey, session),
      cache: 'no-store',
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          error:
            (await response.text()) ||
            'No se pudo cargar el audio.',
        },
        { status: response.status },
      );
    }

    return new NextResponse(await response.arrayBuffer(), {
      status: 200,
      headers: {
        'content-type':
          response.headers.get('content-type') ?? 'audio/ogg',
        'content-disposition':
          response.headers.get('content-disposition') ??
          'inline; filename="audio.ogg"',
        'cache-control': 'private, max-age=120',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo cargar el audio.',
      },
      { status: 500 },
    );
  }
}
