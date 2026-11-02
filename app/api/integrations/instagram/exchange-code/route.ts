import { NextRequest, NextResponse } from 'next/server';
import {
  getInboxSession,
  INBOX_SESSION_COOKIE,
} from '../../../../lib/inbox-auth';

import { verifyInstagramOAuthState } from '../../../../lib/instagram-oauth-state';

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
    const submitted = await request.json().catch(() => null) as { state?: unknown } | null;
    const state = typeof submitted?.state === 'string' ? submitted.state : '';
    const stored = request.cookies.get('mw1_ig_oauth_state')?.value || '';
    let signedStateValid = false;
    try {
      signedStateValid = Boolean(
        state && stored && state === stored && session.userId &&
        verifyInstagramOAuthState(state, session.companyId, session.userId),
      );
    } catch {
      signedStateValid = false;
    }
    if (!signedStateValid) {
      return NextResponse.json(
        { ok: false, error: 'Autorización de Instagram no válida o vencida.' },
        { status: 403 },
      );
    }
    // Server-side single-use state consumption is not implemented yet.
    return NextResponse.json(
      { ok: false, error: 'Instagram sigue deshabilitado hasta completar la autorización de un solo uso.' },
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
