import { NextRequest, NextResponse } from 'next/server';
import {
  INBOX_SESSION_COOKIE,
  getInboxSession,
} from '../../lib/inbox-auth';

export const dynamic = 'force-dynamic';

function text(value: string | null): string {
  return value?.trim() ?? '';
}

function config() {
  const apiBase = process.env.CHATPRO_API_URL?.trim().replace(/\/$/, '');
  const inboxKey = process.env.CHATPRO_INBOX_KEY?.trim();

  if (!apiBase || !inboxKey) {
    throw new Error('Faltan CHATPRO_API_URL o CHATPRO_INBOX_KEY en la web.');
  }

  return { apiBase, inboxKey };
}

async function currentSession(request: NextRequest) {
  return getInboxSession(request.cookies.get(INBOX_SESSION_COOKIE)?.value);
}

function trustedHeaders(
  inboxKey: string,
  session: NonNullable<Awaited<ReturnType<typeof currentSession>>>,
): Record<string, string> {
  const headers: Record<string, string> = {
    'x-chatpro-inbox-key': inboxKey,
  };

  headers['x-chatpro-session-type'] = session.type;
  headers['x-chatpro-user-name'] = session.fullName;
  headers['x-chatpro-company-id'] = session.companyId;
  headers['x-chatpro-role-key'] = session.roleKey;

  if (session.type === 'user' && session.userId) {
    headers['x-chatpro-user-id'] = session.userId;
  }

  return headers;
}

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: 'Sesión de usuario requerida.' },
    { status: 401 },
  );
}

async function proxyResponse(response: Response) {
  const contentType =
    response.headers.get('content-type') ?? 'application/json';
  const body = await response.text();

  return new NextResponse(body, {
    status: response.status,
    headers: { 'content-type': contentType },
  });
}

export async function GET(request: NextRequest) {
  const session = await currentSession(request);

  if (!session) {
    return unauthorized();
  }

  try {
    const { apiBase, inboxKey } = config();
    const company = text(request.nextUrl.searchParams.get('company'));
    const phone = text(request.nextUrl.searchParams.get('phone'));
    const search = text(request.nextUrl.searchParams.get('search'));
    const limit = text(request.nextUrl.searchParams.get('limit')) || '100';

    if (!company) {
      return NextResponse.json(
        { ok: false, error: 'Falta la empresa.' },
        { status: 400 },
      );
    }

    const target = new URL(
      phone ? `${apiBase}/clients/profile` : `${apiBase}/clients`,
    );

    target.searchParams.set('company', company);

    if (phone) {
      target.searchParams.set('phone', phone);
    } else {
      target.searchParams.set('search', search);
      target.searchParams.set('limit', limit);
    }

    const response = await fetch(target, {
      headers: trustedHeaders(inboxKey, session),
      cache: 'no-store',
    });

    return proxyResponse(response);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'No se pudieron consultar los clientes.',
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const session = await currentSession(request);

  if (!session) {
    return unauthorized();
  }

  try {
    const { apiBase, inboxKey } = config();
    const payload = await request.json();
    const company = text(
      typeof payload?.company === 'string'
        ? payload.company
        : request.nextUrl.searchParams.get('company'),
    );

    if (!company) {
      return NextResponse.json(
        { ok: false, error: 'Falta la empresa.' },
        { status: 400 },
      );
    }

    const target = new URL(`${apiBase}/clients`);
    target.searchParams.set('company', company);

    const response = await fetch(target, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...trustedHeaders(inboxKey, session),
      },
      body: JSON.stringify({ ...payload, company }),
      cache: 'no-store',
    });

    return proxyResponse(response);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo guardar el contacto.',
      },
      { status: 500 },
    );
  }
}
