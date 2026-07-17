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

async function currentSession(request: NextRequest) {
  return getInboxSession(
    request.cookies.get(INBOX_SESSION_COOKIE)?.value,
  );
}

async function canManage(
  session: Awaited<ReturnType<typeof getInboxSession>>,
) {
  if (!session) return false;

  return (await getAccessCapabilities(session)).automations;
}

async function relay(response: Response) {
  return new NextResponse(await response.arrayBuffer(), {
    status: response.status,
    headers: {
      'content-type':
        response.headers.get('content-type') ?? 'application/json',
    },
  });
}

async function authorize(request: NextRequest) {
  const session = await currentSession(request);

  if (!session) {
    return {
      response: NextResponse.json(
        { ok: false, error: 'Sesión requerida.' },
        { status: 401 },
      ),
    };
  }

  if (!(await canManage(session))) {
    return {
      response: NextResponse.json(
        {
          ok: false,
          error: 'No tienes permiso para administrar plantillas.',
        },
        { status: 403 },
      ),
    };
  }

  return { session };
}

export async function GET(request: NextRequest) {
  const access = await authorize(request);

  if ('response' in access) return access.response;

  try {
    const { apiBase, inboxKey } = config();
    const target = new URL(`${apiBase}/whatsapp-templates`);
    target.searchParams.set('company', access.session.companySlug);

    return relay(
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
            : 'No se pudieron cargar las plantillas.',
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const access = await authorize(request);

  if ('response' in access) return access.response;

  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: unknown;
    };

    if (body.action !== 'sync') {
      return NextResponse.json(
        { ok: false, error: 'Acción no válida.' },
        { status: 400 },
      );
    }

    const { apiBase, inboxKey } = config();
    const target = new URL(`${apiBase}/whatsapp-templates/sync`);
    target.searchParams.set('company', access.session.companySlug);

    return relay(
      await fetch(target, {
        method: 'POST',
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
            : 'No se pudieron sincronizar las plantillas.',
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  const access = await authorize(request);

  if ('response' in access) return access.response;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const eventKey =
      typeof body.eventKey === 'string' ? body.eventKey.trim() : '';

    if (!eventKey) {
      return NextResponse.json(
        { ok: false, error: 'Falta el evento.' },
        { status: 400 },
      );
    }

    const { eventKey: _eventKey, ...payload } = body;
    const { apiBase, inboxKey } = config();
    const target = new URL(
      `${apiBase}/whatsapp-templates/bindings/${encodeURIComponent(
        eventKey,
      )}`,
    );
    target.searchParams.set('company', access.session.companySlug);

    return relay(
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
            : 'No se pudo guardar la asignación.',
      },
      { status: 500 },
    );
  }
}
