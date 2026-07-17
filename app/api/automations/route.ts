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

async function proxy(response: Response) {
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: {
      'content-type':
        response.headers.get('content-type') ?? 'application/json',
    },
  });
}

async function session(request: NextRequest) {
  return getInboxSession(
    request.cookies.get(INBOX_SESSION_COOKIE)?.value,
  );
}

export async function GET(request: NextRequest) {
  const current = await session(request);

  if (!current) {
    return NextResponse.json(
      { ok: false, error: 'Sesión requerida.' },
      { status: 401 },
    );
  }

  if (!(await canManage(current))) {
    return NextResponse.json(
      {
        ok: false,
        error: 'No tienes permiso para administrar automatizaciones.',
      },
      { status: 403 },
    );
  }

  try {
    const { apiBase, inboxKey } = config();
    const target = new URL(`${apiBase}/automations`);
    target.searchParams.set('company', current.companySlug);

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
            : 'No se pudieron cargar las automatizaciones.',
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  const current = await session(request);

  if (!current) {
    return NextResponse.json(
      { ok: false, error: 'Sesión requerida.' },
      { status: 401 },
    );
  }

  if (!(await canManage(current))) {
    return NextResponse.json(
      {
        ok: false,
        error: 'No tienes permiso para administrar automatizaciones.',
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
        { ok: false, error: 'Falta la automatización.' },
        { status: 400 },
      );
    }

    const { apiBase, inboxKey } = config();
    const target = new URL(
      `${apiBase}/automations/${encodeURIComponent(automationKey)}`,
    );
    target.searchParams.set('company', current.companySlug);

    const { automationKey: _key, ...payload } = body;

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
            : 'No se pudo guardar la automatización.',
      },
      { status: 500 },
    );
  }
}


export async function POST(request: NextRequest) {
  const current = await session(request);

  if (!current) {
    return NextResponse.json(
      { ok: false, error: 'Sesión requerida.' },
      { status: 401 },
    );
  }

  if (!(await canManage(current))) {
    return NextResponse.json(
      {
        ok: false,
        error: 'No tienes permiso para enviar pruebas.',
      },
      { status: 403 },
    );
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const executionId =
      typeof body.executionId === 'string'
        ? body.executionId.trim()
        : '';

    if (body.action !== 'send-test' || !executionId) {
      return NextResponse.json(
        { ok: false, error: 'Falta la ejecución de prueba.' },
        { status: 400 },
      );
    }

    const { apiBase, inboxKey } = config();
    const target = new URL(
      `${apiBase}/automations/executions/${encodeURIComponent(
        executionId,
      )}/test-send`,
    );
    target.searchParams.set('company', current.companySlug);

    return proxy(
      await fetch(target, {
        method: 'POST',
        headers: {
          'x-chatpro-inbox-key': inboxKey,
        },
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
            : 'No se pudo enviar la prueba.',
      },
      { status: 500 },
    );
  }
}
