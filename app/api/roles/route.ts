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

function canManage(session: Awaited<ReturnType<typeof getInboxSession>>) {
  if (!session) return false;

  if (session.type === 'bootstrap') {
    return session.roleKey === 'owner';
  }

  const role = session.roleKey?.trim().toLowerCase();

  return session.type === 'user' && (role === 'owner' || role === 'admin');
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

function targetFor(apiBase: string, companySlug: string) {
  const target = new URL(`${apiBase}/roles`);
  target.searchParams.set('company', companySlug);

  return target;
}

async function requireManager(request: NextRequest) {
  const session = await currentSession(request);

  if (!session) return { response: unauthorized() as NextResponse, session: null };

  if (!canManage(session)) {
    return {
      response: NextResponse.json(
        { ok: false, error: 'No tienes permiso para administrar roles.' },
        { status: 403 },
      ),
      session: null,
    };
  }

  return { response: null, session };
}

export async function GET(request: NextRequest) {
  const { response: denied, session } = await requireManager(request);

  if (denied || !session) return denied;

  try {
    const { apiBase, inboxKey } = config();

    return proxyResponse(
      await fetch(targetFor(apiBase, session.companySlug), {
        headers: { 'x-chatpro-inbox-key': inboxKey },
        cache: 'no-store',
      }),
    );
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
  const { response: denied, session } = await requireManager(request);

  if (denied || !session) return denied;

  try {
    const { apiBase, inboxKey } = config();

    return proxyResponse(
      await fetch(targetFor(apiBase, session.companySlug), {
        method,
        headers: {
          'content-type': 'application/json',
          'x-chatpro-inbox-key': inboxKey,
        },
        body: JSON.stringify(await request.json()),
        cache: 'no-store',
      }),
    );
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
