import { NextRequest, NextResponse } from 'next/server';
import { getAccessCapabilities } from '../../lib/access-capabilities';
import {
  getInboxSession,
  INBOX_SESSION_COOKIE,
} from '../../lib/inbox-auth';

export const dynamic = 'force-dynamic';

function text(value: string | null): string {
  return value?.trim() ?? '';
}

function config() {
  const apiBase = process.env.CHATPRO_API_URL?.trim().replace(/\/$/, '');
  const inboxKey = process.env.CHATPRO_INBOX_KEY?.trim();

  if (!apiBase || !inboxKey) {
    throw new Error(
      'Faltan CHATPRO_API_URL o CHATPRO_INBOX_KEY en la web.',
    );
  }

  return { apiBase, inboxKey };
}

async function currentSession(request: NextRequest) {
  return getInboxSession(
    request.cookies.get(INBOX_SESSION_COOKIE)?.value,
  );
}

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: 'Sesión requerida.' },
    { status: 401 },
  );
}

export async function GET(request: NextRequest) {
  const session = await currentSession(request);

  if (!session) {
    return unauthorized();
  }

  try {
    const capabilities = await getAccessCapabilities(session);

    if (!capabilities.statistics) {
      return NextResponse.json(
        {
          ok: false,
          error: 'No tienes permiso para consultar estadísticas.',
        },
        { status: 403 },
      );
    }

    const { apiBase, inboxKey } = config();

    const from = text(request.nextUrl.searchParams.get('from'));
    const to = text(request.nextUrl.searchParams.get('to'));
    const timezone =
      text(request.nextUrl.searchParams.get('timezone')) ||
      'America/Bogota';
    const bucket =
      text(request.nextUrl.searchParams.get('bucket')) || 'hour';

    const target = new URL(`${apiBase}/statistics`);

    target.searchParams.set('from', from);
    target.searchParams.set('to', to);
    target.searchParams.set('timezone', timezone);
    target.searchParams.set('bucket', bucket);

    const response = await fetch(target, {
      headers: {
        'x-chatpro-inbox-key': inboxKey,
        'x-chatpro-company-id': session.companyId,
        'x-chatpro-role-key': session.roleKey,
        ...(session.userId
          ? { 'x-chatpro-user-id': session.userId }
          : {}),
      },
      cache: 'no-store',
    });

    return new NextResponse(await response.text(), {
      status: response.status,
      headers: {
        'content-type':
          response.headers.get('content-type') ??
          'application/json',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'No se pudieron consultar las estadísticas.',
      },
      { status: 500 },
    );
  }
}
