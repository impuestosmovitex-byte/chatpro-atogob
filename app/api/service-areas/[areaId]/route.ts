import { NextRequest, NextResponse } from 'next/server';
import {
  getInboxSession,
  INBOX_SESSION_COOKIE,
} from '../../../lib/inbox-auth';

export const dynamic = 'force-dynamic';

type Params = {
  params: Promise<{ areaId: string }>;
};

function config() {
  const apiBase = process.env.CHATPRO_API_URL?.trim().replace(/\/$/, '');
  const inboxKey = process.env.CHATPRO_INBOX_KEY?.trim();

  if (!apiBase || !inboxKey) {
    throw new Error('Faltan CHATPRO_API_URL o CHATPRO_INBOX_KEY.');
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

async function proxyResponse(response: Response) {
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') ?? 'application/json',
    },
  });
}

async function run(
  request: NextRequest,
  context: Params,
  method: 'PATCH' | 'DELETE',
) {
  const session = await getInboxSession(
    request.cookies.get(INBOX_SESSION_COOKIE)?.value,
  );

  if (!session) {
    return NextResponse.json(
      { ok: false, error: 'Sesión requerida.' },
      { status: 401 },
    );
  }

  if (!canManage(session)) {
    return NextResponse.json(
      { ok: false, error: 'No tienes permiso para administrar áreas.' },
      { status: 403 },
    );
  }

  try {
    const { areaId } = await context.params;
    const id = areaId?.trim();

    if (!id) {
      return NextResponse.json(
        { ok: false, error: 'Falta el área.' },
        { status: 400 },
      );
    }

    const { apiBase, inboxKey } = config();
    const target = new URL(`${apiBase}/service-areas/${encodeURIComponent(id)}`);
    target.searchParams.set('company', session.companySlug);

    const response = await fetch(target, {
      method,
      headers: {
        'x-chatpro-inbox-key': inboxKey,
        ...(method === 'PATCH' ? { 'content-type': 'application/json' } : {}),
      },
      body: method === 'PATCH' ? JSON.stringify(await request.json()) : undefined,
      cache: 'no-store',
    });

    return proxyResponse(response);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Error' },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, context: Params) {
  return run(request, context, 'PATCH');
}

export async function DELETE(request: NextRequest, context: Params) {
  return run(request, context, 'DELETE');
}
