import { isInstagramStagingRequest, isInstagramStagingApi } from '../../../../lib/instagram-staging-guard';
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

  if (isInstagramStagingRequest(request) &&
      !isInstagramStagingApi(apiBase)) {
    return NextResponse.json(
      { ok: false, error: 'La configuración de Instagram debe consultarse en la API de staging.' },
      { status: 503 },
    );
  }

  const target = new URL(
    `${apiBase}/integrations/instagram/config`,
  );

  target.searchParams.set(
    'company',
    session.companySlug,
  );

  const response = await fetch(target, {
    headers: {
      'x-chatpro-inbox-key': inboxKey,
      'x-chatpro-user-id': session.userId ?? '',
      'x-chatpro-company-id': session.companyId,
    },
    cache: 'no-store',
  });

  if (isInstagramStagingRequest(request) &&
      response.ok) {
    const body = await response.json().catch(() => null) as
      | { ready?: boolean; missing?: string[]; authorizationEnabled?: boolean;
          message?: string; [key: string]: unknown }
      | null;
    if (!body) {
      return NextResponse.json({ ok: false, error: 'Configuración inválida.' }, { status: 502 });
    }
    const stateSecret = process.env.MW1_INSTAGRAM_OAUTH_STATE_SECRET?.trim() || '';
    const webSecretReady = stateSecret.length >= 32;
    const uiEnabled = process.env.MW1_STAGING_INSTAGRAM_LOGIN_UI_ENABLED === 'true';
    return NextResponse.json({
      ...body,
      ready: body.ready === true && webSecretReady,
      authorizationEnabled: body.ready === true && webSecretReady &&
        body.authorizationEnabled === true && uiEnabled,
      missing: [
        ...(Array.isArray(body.missing) ? body.missing : []),
        ...(!webSecretReady ? ['MW1_INSTAGRAM_OAUTH_STATE_SECRET'] : []),
        ...(!uiEnabled ? ['MW1_STAGING_INSTAGRAM_LOGIN_UI_ENABLED (web)'] : []),
      ],
      // Read-only status for an authenticated tenant admin. Never disclose
      // credentials, OAuth codes, environment values or provider tokens.
      diagnostics: {
        pilotOnly: true,
        multiCompanyActivationEnabled: false,
        apiReady: body.ready === true,
        apiAuthorizationEnabled: body.authorizationEnabled === true,
        webStateSecretReady: webSecretReady,
        webAuthorizationEnabled: uiEnabled,
        callbackRegisteredInMeta: 'not_verified_by_server',
      },
      message: !webSecretReady
        ? 'Falta configurar la seguridad OAuth de Instagram en la web de staging.'
        : body.message,
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  return new NextResponse(
    await response.text(),
    {
      status: response.status,
      headers: {
        'content-type': response.headers.get('content-type') ?? 'application/json',
        'cache-control': 'no-store',
      },
    },
  );
}
