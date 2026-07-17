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
    throw new Error('Faltan CHATPRO_API_URL o CHATPRO_INBOX_KEY.');
  }

  return { apiBase, inboxKey };
}

async function canManage(
  session: Awaited<ReturnType<typeof getInboxSession>>,
): Promise<boolean> {
  if (!session) return false;

  return (await getAccessCapabilities(session)).automations;
}

async function currentSession(request: NextRequest) {
  return getInboxSession(
    request.cookies.get(INBOX_SESSION_COOKIE)?.value,
  );
}

async function proxy(response: Response) {
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: {
      'content-type':
        response.headers.get('content-type') ?? 'application/json',
    },
  });
}

export async function GET(request: NextRequest) {
  const session = await currentSession(request);

  if (!session) {
    return NextResponse.json(
      { ok: false, error: 'Sesión requerida.' },
      { status: 401 },
    );
  }

  if (!(await canManage(session))) {
    return NextResponse.json(
      {
        ok: false,
        error: 'No tienes permiso para configurar mensajes.',
      },
      { status: 403 },
    );
  }

  try {
    const { apiBase, inboxKey } = config();
    const target = new URL(`${apiBase}/automation-messages`);
    target.searchParams.set('company', session.companySlug);

    return proxy(
      await fetch(target, {
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
            : 'No se pudieron cargar los mensajes.',
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  const session = await currentSession(request);

  if (!session) {
    return NextResponse.json(
      { ok: false, error: 'Sesión requerida.' },
      { status: 401 },
    );
  }

  if (!(await canManage(session))) {
    return NextResponse.json(
      {
        ok: false,
        error: 'No tienes permiso para configurar mensajes.',
      },
      { status: 403 },
    );
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const automationKey =
      typeof body.automationKey === 'string'
        ? body.automationKey.trim()
        : '';

    if (!automationKey) {
      return NextResponse.json(
        { ok: false, error: 'Falta el tipo de mensaje.' },
        { status: 400 },
      );
    }

    const { automationKey: _key, ...payload } = body;
    const { apiBase, inboxKey } = config();
    const target = new URL(
      `${apiBase}/automation-messages/${encodeURIComponent(
        automationKey,
      )}`,
    );
    target.searchParams.set('company', session.companySlug);

    return proxy(
      await fetch(target, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-chatpro-inbox-key': inboxKey,
        },
        body: JSON.stringify(payload),
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
            : 'No se pudieron guardar los mensajes.',
      },
      { status: 500 },
    );
  }
}
