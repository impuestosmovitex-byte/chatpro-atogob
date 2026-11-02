import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { getInboxSession, INBOX_SESSION_COOKIE } from '../../../../lib/inbox-auth';
import { createInstagramOAuthState } from '../../../../lib/instagram-oauth-state';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (request.nextUrl.hostname !== 'mw1-web-staging-staging.up.railway.app') {
    return NextResponse.json({ ok: false, error: 'Solo staging.' }, { status: 403 });
  }
  const session = await getInboxSession(request.cookies.get(INBOX_SESSION_COOKIE)?.value);
  if (!session || session.type !== 'user' ||
      !['owner', 'admin'].includes(session.roleKey) ||
      session.companySlug !== 'piloto-mw1-prueba' ||
      !session.userId || !session.companyId) {
    return NextResponse.json({ ok: false, error: 'Acceso no autorizado.' }, { status: 403 });
  }
  if (process.env.MW1_STAGING_INSTAGRAM_ONBOARDING_ENABLED !== 'true' ||
      process.env.MW1_STAGING_INSTAGRAM_OAUTH_ENABLED !== 'true') {
    return NextResponse.json({ ok: false, error: 'Instagram no habilitado.' }, { status: 403 });
  }
  try {
    const state = createInstagramOAuthState(session.companyId, session.userId);
    const apiBase = process.env.CHATPRO_API_URL?.trim().replace(/\/$/, '');
    const inboxKey = process.env.CHATPRO_INBOX_KEY?.trim();
    if (!apiBase || !inboxKey) throw new Error('API de staging no configurada.');
    const nonceHash = createHash('sha256').update(state).digest('hex');
    const registerUrl = new URL(apiBase + '/integrations/instagram/oauth/register');
    registerUrl.searchParams.set('company', session.companySlug);
    const registration = await fetch(registerUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-chatpro-inbox-key': inboxKey,
        'x-chatpro-company-id': session.companyId,
        'x-chatpro-user-id': session.userId,
      },
      body: JSON.stringify({ nonceHash, expiresAt: new Date(Date.now() + 9 * 60 * 1000).toISOString() }),
      cache: 'no-store',
    });
    if (!registration.ok) throw new Error('No se pudo registrar el estado OAuth.');
    const response = NextResponse.json({ ok: true, state });
    response.cookies.set('mw1_ig_oauth_state', state, {
      httpOnly: true, secure: true, sameSite: 'lax',
      maxAge: 600, path: '/api/integrations/instagram',
    });
    return response;
  } catch {
    return NextResponse.json({ ok: false, error: 'Seguridad OAuth no configurada.' }, { status: 503 });
  }
}
