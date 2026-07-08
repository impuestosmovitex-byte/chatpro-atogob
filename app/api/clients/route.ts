import { NextRequest, NextResponse } from 'next/server';
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
    throw new Error('Faltan CHATPRO_API_URL o CHATPRO_INBOX_KEY en la web.');
  }

  return { apiBase, inboxKey };
}

async function currentSession(request: NextRequest) {
  return getInboxSession(request.cookies.get(INBOX_SESSION_COOKIE)?.value);
}

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: 'Sesión requerida.' },
    { status: 401 },
  );
}

async function proxyResponse(response: Response) {
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') ?? 'application/json',
    },
  });
}

export async function GET(request: NextRequest) {
  const session = await currentSession(request);

  if (!session) {
    return unauthorized();
  }

  try {
    const { apiBase, inboxKey } = config();
    const phone = text(request.nextUrl.searchParams.get('phone'));
    const search = text(request.nextUrl.searchParams.get('search'));
    const limit = text(request.nextUrl.searchParams.get('limit')) || '100';

    const target = new URL(
      phone ? `${apiBase}/clients/profile` : `${apiBase}/clients`,
    );

    target.searchParams.set('company', session.companySlug);

    if (phone) {
      target.searchParams.set('phone', phone);
    } else {
      target.searchParams.set('search', search);
      target.searchParams.set('limit', limit);
    }

    const response = await fetch(target, {
      headers: { 'x-chatpro-inbox-key': inboxKey },
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

    const target = new URL(`${apiBase}/clients`);
    target.searchParams.set('company', session.companySlug);

    const response = await fetch(target, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-chatpro-inbox-key': inboxKey,
      },
      body: JSON.stringify({ ...payload, company: session.companySlug }),
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
