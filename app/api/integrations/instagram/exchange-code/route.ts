import { NextRequest, NextResponse } from 'next/server';
import {
  getInboxSession,
  INBOX_SESSION_COOKIE,
} from '../../../../lib/inbox-auth';

export const dynamic = 'force-dynamic';

function canManage(
  session: Awaited<ReturnType<typeof getInboxSession>>,
) {
  if (!session) return false;
  if (session.type === 'bootstrap') {
    return session.roleKey === 'owner';
  }

  const role = session.roleKey?.trim().toLowerCase();

  return (
    session.type === 'user' &&
    (role === 'owner' || role === 'admin')
  );
}

export async function POST(request: NextRequest) {
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
      {
        ok: false,
        error:
          'No tienes permiso para administrar integraciones.',
      },
      { status: 403 },
    );
  }

  if (request.nextUrl.hostname === 'mw1-web-staging-staging.up.railway.app') {
    return NextResponse.json(
      { ok: false, error: 'Conexión de Instagram en preparación para el piloto.' },
      { status: 403 },
    );
  }

  // Staging OAuth remains closed until the signed state and one-time
  // authorization are fully verified on the server.
  if (request.nextUrl.hostname === 'mw1-web-staging-staging.up.railway.app') {
    const submitted = await request.json().catch(() => null) as
      | { state?: unknown }
      | null;
    const state = typeof submitted?.state === 'string'
      ? submitted.state
      : '';
    const stored = request.cookies.get('mw1_ig_oauth_state')?.value || '';
    if (!state || !stored || state !== stored) {
      return NextResponse.json(
        { ok: false, error: 'Estado OAuth de Instagram no válido.' },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { ok: false, error: 'Instagram aún requiere verificación de autorización de un solo uso.' },
      { status: 403 },
    );
  }

  const apiBase =
    process.env.CHATPRO_API_URL?.trim().replace(/\/$/, '');
  const inboxKey =
    process.env.CHATPRO_INBOX_KEY?.trim();

  if (!apiBase || !inboxKey) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Faltan CHATPRO_API_URL o CHATPRO_INBOX_KEY en la web.',
      },
      { status: 500 },
    );
  }

  const target = new URL(
    `${apiBase}/integrations/instagram/exchange-code`,
  );

  target.searchParams.set(
    'company',
    session.companySlug,
  );

  const response = await fetch(target, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-chatpro-inbox-key': inboxKey,
      'x-chatpro-user-id': session.userId ?? '',
      'x-chatpro-company-id': session.companyId,
    },
    body: JSON.stringify(
      await request.json(),
    ),
    cache: 'no-store',
  });

  return new NextResponse(
    await response.text(),
    {
      status: response.status,
      headers: {
        'content-type':
          response.headers.get('content-type') ??
          'application/json',
      },
    },
  );
}
