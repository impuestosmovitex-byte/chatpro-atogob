import { NextRequest, NextResponse } from 'next/server';
import {
  getInboxSession,
  INBOX_SESSION_COOKIE,
} from '../../lib/inbox-auth';
import { getAccessCapabilities } from '../../lib/access-capabilities';

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

async function proxyResponse(response: Response) {
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') ?? 'application/json',
    },
  });
}

function targetFor(apiBase: string, companySlug: string, id = '') {
  const target = new URL(
    `${apiBase}/quick-replies${id ? `/${encodeURIComponent(id)}` : ''}`,
  );
  target.searchParams.set('company', companySlug);

  return target;
}

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: 'Sesión requerida.' },
    { status: 401 },
  );
}

async function currentSession(request: NextRequest) {
  return getInboxSession(request.cookies.get(INBOX_SESSION_COOKIE)?.value);
}

export async function GET(request: NextRequest) {
  const session = await currentSession(request);

  if (!session) {
    return unauthorized();
  }

  try {
    const capabilities = await getAccessCapabilities(session);

    if (!capabilities.useQuickReplies) {
      return NextResponse.json(
        {
          ok: false,
          error: 'No tienes permiso para usar respuestas rápidas.',
        },
        { status: 403 },
      );
    }

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
          error instanceof Error ? error.message : 'No se pudieron cargar.',
      },
      { status: 500 },
    );
  }
}

async function mutate(request: NextRequest, method: 'POST' | 'PUT' | 'DELETE') {
  const session = await currentSession(request);

  if (!session) {
    return unauthorized();
  }

  if (!canManage(session)) {
    return NextResponse.json(
      { ok: false, error: 'No tienes permiso para administrar respuestas rápidas.' },
      { status: 403 },
    );
  }

  try {
    const id = request.nextUrl.searchParams.get('id')?.trim() ?? '';

    if ((method === 'PUT' || method === 'DELETE') && !id) {
      return NextResponse.json(
        { ok: false, error: 'Falta la respuesta.' },
        { status: 400 },
      );
    }

    const { apiBase, inboxKey } = config();
    const init: RequestInit = {
      method,
      headers: { 'x-chatpro-inbox-key': inboxKey },
      cache: 'no-store',
    };

    if (method !== 'DELETE') {
      init.headers = {
        'x-chatpro-inbox-key': inboxKey,
        'content-type': 'application/json',
      };
      init.body = JSON.stringify(await request.json());
    }

    return proxyResponse(
      await fetch(targetFor(apiBase, session.companySlug, id), init),
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : 'No se pudo completar.',
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  return mutate(request, 'POST');
}

export async function PUT(request: NextRequest) {
  return mutate(request, 'PUT');
}

export async function DELETE(request: NextRequest) {
  return mutate(request, 'DELETE');
}
