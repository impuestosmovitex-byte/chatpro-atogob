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
  const contentType = response.headers.get('content-type') ?? 'application/json';
  const body = await response.text();

  return new NextResponse(body, {
    status: response.status,
    headers: { 'content-type': contentType },
  });
}

function targetFor(apiBase: string, company: string): URL {
  if (!company) {
    throw new Error('Falta la empresa.');
  }

  const target = new URL(`${apiBase}/roles`);
  target.searchParams.set('company', company);
  return target;
}

export async function GET(request: NextRequest) {
  if (!(await hasValidSession(request))) {
    return unauthorized();
  }

  try {
    const { apiBase, inboxKey } = config();
    const response = await fetch(targetFor(apiBase, companyFrom(request)), {
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
            : 'No se pudieron consultar los roles.',
      },
      { status: 500 },
    );
  }
}

async function mutate(request: NextRequest, method: 'POST' | 'PATCH') {
  if (!(await hasValidSession(request))) {
    return unauthorized();
  }

  try {
    const { apiBase, inboxKey } = config();
    const response = await fetch(targetFor(apiBase, companyFrom(request)), {
      method,
      headers: {
        'content-type': 'application/json',
        'x-chatpro-inbox-key': inboxKey,
      },
      body: JSON.stringify(await request.json()),
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
            : 'No se pudo guardar el rol.',
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  return mutate(request, 'POST');
}

export async function PATCH(request: NextRequest) {
  return mutate(request, 'PATCH');
}
