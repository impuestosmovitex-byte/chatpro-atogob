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

function usersTarget(apiBase: string, companySlug: string, suffix = '') {
  const target = new URL(`${apiBase}/users${suffix}`);
  target.searchParams.set('company', companySlug);

  return target;
}

async function requireManager(request: NextRequest) {
  const session = await currentSession(request);

  if (!session) return { response: unauthorized() as NextResponse, session: null };

  if (!canManage(session)) {
    return {
      response: NextResponse.json(
        { ok: false, error: 'No tienes permiso para administrar usuarios.' },
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
      await fetch(usersTarget(apiBase, session.companySlug), {
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
            : 'No se pudieron consultar los usuarios.',
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const { response: denied, session } = await requireManager(request);

  if (denied || !session) return denied;

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

    return proxyResponse(
      await fetch(usersTarget(apiBase, session.companySlug, suffix), {
        method: 'POST',
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
            : 'No se pudo procesar la acción.',
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const { response: denied, session } = await requireManager(request);

  if (denied || !session) return denied;

  try {
    const { apiBase, inboxKey } = config();

    return proxyResponse(
      await fetch(usersTarget(apiBase, session.companySlug), {
        method: 'PATCH',
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
            : 'No se pudo actualizar el usuario.',
      },
      { status: 500 },
    );
  }
}
