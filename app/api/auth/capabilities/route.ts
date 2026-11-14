import { NextRequest, NextResponse } from 'next/server';
import {
  getInboxSession,
  INBOX_SESSION_COOKIE,
} from '../../../lib/inbox-auth';
import { getAccessCapabilities } from '../../../lib/access-capabilities';
import { isUnifiedPanelEnabled } from '../../../lib/unified-panel-rollout';

export const dynamic = 'force-dynamic';

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

  try {
    return NextResponse.json({
      ok: true,
      capabilities: await getAccessCapabilities(session),
      unifiedPanelEnabled: session.type === 'user' && isUnifiedPanelEnabled(session.companySlug),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'No se pudieron validar los permisos.',
      },
      { status: 403 },
    );
  }
}
