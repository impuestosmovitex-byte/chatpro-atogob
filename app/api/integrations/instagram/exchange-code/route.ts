import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
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
    if (process.env.MW1_STAGING_INSTAGRAM_ONBOARDING_ENABLED !== 'true' || process.env.MW1_STAGING_INSTAGRAM_OAUTH_ENABLED !== 'true') {
      return NextResponse.json({ ok: false, error: 'Instagram no habilitado en staging.' }, { status: 403 });
    }
    const submitted = await request.json().catch(() => null) as
      | { state?: unknown; code?: unknown; redirectUri?: unknown }
      | null;
    const state = typeof submitted?.state === 'string' ? submitted.state : '';
    const code = typeof submitted?.code === 'string' ? submitted.code.trim() : '';
    const expectedRedirect = 'https://mw1-web-staging-staging.up.railway.app/api/integrations/instagram/callback';
    if (!code || code.length > 4096 || submitted?.redirectUri !== expectedRedirect) {
      return NextResponse.json(
        { ok: false, error: 'El retorno de Instagram es inválido.' },
        { status: 400 },
      );
    }
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
    const apiBase = process.env.CHATPRO_API_URL?.trim().replace(/\/$/, '');
    const inboxKey = process.env.CHATPRO_INBOX_KEY?.trim();
    if (!apiBase || !inboxKey) {
      return NextResponse.json({ ok: false, error: 'API de staging no configurada.' }, { status: 503 });
    }
    if (apiBase !== 'https://mw1-api-staging-staging.up.railway.app' ||
        session.companySlug !== 'piloto-mw1-prueba') {
      return NextResponse.json(
        { ok: false, error: 'Esta autorización solo se procesa en la empresa piloto.' },
        { status: 403 },
      );
    }
    const nonceHash = createHash('sha256').update(state).digest('hex');
    const target = new URL(apiBase + '/integrations/instagram/oauth/consume');
    target.searchParams.set('company', session.companySlug);
    const consumption = await fetch(target, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-chatpro-inbox-key': inboxKey,
        'x-chatpro-company-id': session.companyId,
        'x-chatpro-user-id': session.userId ?? '',
      },
      body: JSON.stringify({ nonceHash }),
      cache: 'no-store',
    }).catch(() => null);
    if (!consumption?.ok) {
      return NextResponse.json({ ok: false, error: 'No se pudo verificar la autorización.' }, { status: 403 });
    }
    const result = await consumption.json().catch(() => ({})) as { consumed?: boolean };
    if (result.consumed !== true) {
      return NextResponse.json({ ok: false, error: 'Autorización vencida o utilizada anteriormente.' }, { status: 403 });
    }
    // This path intentionally does not exchange authorization codes for tokens.
    const blocked = NextResponse.json(
      { ok: false, error: 'Autorización de uso único validada. La conexión real de Instagram sigue deshabilitada.' },
      { status: 403 },
    );
    blocked.cookies.set('mw1_ig_oauth_state', '', {
      httpOnly: true, secure: true, sameSite: 'lax', maxAge: 0,
      path: '/api/integrations/instagram',
    });
    return blocked;
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
