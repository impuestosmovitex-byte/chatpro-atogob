import { NextRequest, NextResponse } from 'next/server';
import { getInboxSession, INBOX_SESSION_COOKIE } from '../../../lib/inbox-auth';
import { getAccessCapabilities } from '../../../lib/access-capabilities';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await getInboxSession(
    request.cookies.get(INBOX_SESSION_COOKIE)?.value,
  );

  if (!session) {
    return NextResponse.json({ ok: false, error: 'Sesión requerida.' }, { status: 401 });
  }

  // Never equate a correctly signed 12-hour cookie with a current membership.
  // On isolated staging the existing Railway API is the source of truth.
  // The production session endpoint remains unchanged.
  if (process.env.MW1_STAGING_MODE === 'true' && session.type === 'user') {
    if (!session.userId || !session.companyId) {
      return NextResponse.json(
        { ok: false, error: 'Sesión de empresa no válida.' },
        { status: 403, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    try {
      await getAccessCapabilities(session);
    } catch {
      return NextResponse.json(
        { ok: false, error: 'No fue posible confirmar la membresía activa en esta empresa.' },
        { status: 403, headers: { 'Cache-Control': 'no-store' } },
      );
    }
  }

  return NextResponse.json({
    ok: true,
    session: {
      type: session.type,
      userId: session.userId,
      companyId: session.companyId,
      companySlug: session.companySlug,
      companyName: session.companyName,
      fullName: session.fullName,
      roleKey: session.roleKey,
      roleName: session.roleName,
    },
  });
}
