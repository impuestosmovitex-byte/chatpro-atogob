import { NextRequest, NextResponse } from 'next/server';
import {
  INBOX_SESSION_COOKIE,
  isInboxSessionValid,
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

function companyFrom(request: NextRequest): string {
  return request.nextUrl.searchParams.get('company')?.trim().toLowerCase() ?? '';
}

async function hasValidSession(request: NextRequest): Promise<boolean> {
  return isInboxSessionValid(
    request.cookies.get(INBOX_SESSION_COOKIE)?.value,
  );
}

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: 'Sesión requerida.' },
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

function usersTarget(
  apiBase: string,
  company: string,
  suffix = '',
): URL {
  if (!company) {
    throw new Error('Falta la empresa.');
  }

  const target = new URL(`${apiBase}/users${suffix}`);
  target.searchParams.set('company', company);

  return target;
}

export async function GET(request: NextRequest) {
  if (!(await hasValidSession(request))) {
    return unauthorized();
  }

  try {
    const { apiBase, inboxKey } = config();
    const response = await fetch(
      usersTarget(apiBase, companyFrom(request)),
      {
        headers: { 'x-chatpro-inbox-key': inboxKey },
        cache: 'no-store',
      },
    );

    return proxyResponse(response);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'No se pudieron consultar los usuarios.',
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!(await hasValidSession(request))) {
    return unauthorized();
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = typeof body.action === 'string' ? body.action : '';
    const { apiBase, inboxKey } = config();
    const suffix = action === 'reset-password' ? '/reset-password' : '';

    if (action !== 'create' && action !== 'reset-password') {
      return NextResponse.json(
        { ok: false, error: 'Acción no válida.' },
        { status: 400 },
      );
    }

    const { action: _action, ...payload } = body;
    const response = await fetch(
      usersTarget(apiBase, companyFrom(request), suffix),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-chatpro-inbox-key': inboxKey,
        },
        body: JSON.stringify(payload),
        cache: 'no-store',
      },
    );

    return proxyResponse(response);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo procesar la acción.',
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  if (!(await hasValidSession(request))) {
    return unauthorized();
  }

  try {
    const { apiBase, inboxKey } = config();
    const body = await request.json();

    const response = await fetch(
      usersTarget(apiBase, companyFrom(request)),
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-chatpro-inbox-key': inboxKey,
        },
        body: JSON.stringify(body),
        cache: 'no-store',
      },
    );

    return proxyResponse(response);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo actualizar el usuario.',
      },
      { status: 500 },
    );
  }
}
