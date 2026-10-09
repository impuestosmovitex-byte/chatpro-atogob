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
    throw new Error('Faltan CHATPRO_API_URL o CHATPRO_INBOX_KEY en la web.');
  }

  return { apiBase, inboxKey };
}

function trustedHeaders(
  inboxKey: string,
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
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

async function getSession(request?: NextRequest) {
  if (!request) return null;
  return getInboxSession(request.cookies.get(INBOX_SESSION_COOKIE)?.value);
}

export async function GET(request: NextRequest) {
  const session = await getSession(request);

  if (!session) {
    return NextResponse.json(
      { ok: false, error: 'Sesión requerida.' },
      { status: 401 },
    );
  }

  try {
    const { apiBase, inboxKey } = config();
    const requestedLimit = request.nextUrl.searchParams.get('limit')?.trim();
    const limit = requestedLimit || '5000';
    const target = new URL(`${apiBase}/lead-registry`);

    target.searchParams.set('company', session.companySlug);
    target.searchParams.set('tag', 'EFFIX-2026');
    target.searchParams.set('limit', limit);

    const response = await fetch(target, {
      headers: trustedHeaders(inboxKey, session),
      cache: 'no-store',
    });

    return new NextResponse(await response.text(), {
      status: response.status,
      headers: {
        'content-type':
          response.headers.get('content-type') ?? 'application/json',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'No se pudieron consultar los leads.',
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const session = await getSession(request);

  if (!session) {
    return NextResponse.json(
      { ok: false, error: 'Sesión requerida.' },
      { status: 401 },
    );
  }

  try {
    const { apiBase, inboxKey } = config();
    const body = (await request.json()) as {
      phone?: unknown;
      status?: unknown;
    };

    const response = await fetch(`${apiBase}/lead-registry/status`, {
      method: 'PATCH',
      headers: {
        ...trustedHeaders(inboxKey, session),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        company: session.companySlug,
        phone: body.phone,
        status: body.status,
      }),
      cache: 'no-store',
    });

    return new NextResponse(await response.text(), {
      status: response.status,
      headers: {
        'content-type':
          response.headers.get('content-type') ?? 'application/json',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo actualizar el estado del lead.',
      },
      { status: 500 },
    );
  }
}
