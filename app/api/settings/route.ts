
import { NextRequest, NextResponse } from 'next/server';
import { signInternalAttestation } from '../../lib/internal-attestation';
import {
  INBOX_SESSION_COOKIE,
  getInboxSession,
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

async function currentSession(request: NextRequest) {
  return getInboxSession(request.cookies.get(INBOX_SESSION_COOKIE)?.value);
}

function forbidden(message: string, status = 403) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function canManageSettings(
  session: Awaited<ReturnType<typeof getInboxSession>>,
) {
  if (!session) return false;

  if (session.type === 'bootstrap') {
    return session.roleKey === 'owner';
  }

  const role = session.roleKey?.trim().toLowerCase();

  return session.type === 'user' && (role === 'owner' || role === 'admin');
}

async function proxyResponse(response: Response) {
  const contentType = response.headers.get('content-type') ?? 'application/json';
  const body = await response.text();

  return new NextResponse(body, {
    status: response.status,
    headers: { 'content-type': contentType },
  });
}

export async function GET(request: NextRequest) {
  const session = await currentSession(request);

  if (!session) {
    return forbidden('Sesión requerida.', 401);
  }

  if (!canManageSettings(session)) {
    return forbidden('No tienes permiso para administrar esta configuración.');
  }

  try {
    const { apiBase, inboxKey } = config();
    const target = new URL(`${apiBase}/settings`);
    target.searchParams.set('company', session.companySlug);

    const response = await fetch(target, {
      headers: process.env.MW1_STAGING_MODE === 'true' ? {
        'x-chatpro-inbox-key': inboxKey,
        'x-chatpro-session-type': session.type,
        'x-chatpro-user-id': session.userId || '',
        'x-chatpro-company-id': session.companyId,
        'x-mw1-internal-assertion': signInternalAttestation({
          kind: 'user', userId: session.userId || '', companyId: session.companyId,
          companySlug: session.companySlug, method: 'GET', path: '/settings',
        }),
      } : { 'x-chatpro-inbox-key': inboxKey },
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
            : 'No se pudo cargar la configuración.',
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  const session = await currentSession(request);

  if (!session) {
    return forbidden('Sesión requerida.', 401);
  }

  if (!canManageSettings(session)) {
    return forbidden('No tienes permiso para administrar esta configuración.');
  }

  if (process.env.MW1_STAGING_MODE === 'true') {
    return forbidden('Los ajustes de IA están disponibles en modo consulta en staging.');
  }

  try {
    const body = await request.json();
    const { apiBase, inboxKey } = config();
    const target = new URL(`${apiBase}/settings`);
    target.searchParams.set('company', session.companySlug);

    const response = await fetch(target, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-chatpro-inbox-key': inboxKey,
      },
      body: JSON.stringify(body),
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
            : 'No se pudo guardar la configuración.',
      },
      { status: 500 },
    );
  }
}
