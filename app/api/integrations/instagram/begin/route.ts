import { NextRequest, NextResponse } from 'next/server';
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
