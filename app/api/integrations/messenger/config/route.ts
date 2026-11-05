import { NextRequest, NextResponse } from 'next/server';
import {
  getInboxSession,
  INBOX_SESSION_COOKIE,
} from '../../../../lib/inbox-auth';

import { isMessengerDisabledInStaging } from '../../../../lib/staging-messenger-gate';

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

export async function GET(request: NextRequest) {
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

  // Messenger onboarding is intentionally unavailable in isolated staging.
  // Do not call legacy API endpoints or expose tokens to the web client.
  if (isMessengerDisabledInStaging(request.nextUrl.hostname)) {
    return NextResponse.json(
      {
        ok: true,
        ready: false,
        authorizationEnabled: false,
        connectionEnabled: false,
        message: 'Messenger todavía no está habilitado en MW1 staging. No se autorizan páginas ni se reciben mensajes.',
      },
      { headers: { 'Cache-Control': 'no-store' } },
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
    `${apiBase}/integrations/messenger/config`,
  );

  target.searchParams.set(
    'company',
    session.companySlug,
  );

  const response = await fetch(target, {
    headers: {
      'x-chatpro-inbox-key': inboxKey,
    },
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
