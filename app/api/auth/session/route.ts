import { NextRequest, NextResponse } from 'next/server';
import { getInboxSession, INBOX_SESSION_COOKIE } from '../../../lib/inbox-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await getInboxSession(
    request.cookies.get(INBOX_SESSION_COOKIE)?.value,
  );

  if (!session) {
    return NextResponse.json({ ok: false, error: 'Sesión requerida.' }, { status: 401 });
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
