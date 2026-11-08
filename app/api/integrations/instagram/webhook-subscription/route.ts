import { NextRequest, NextResponse } from 'next/server';
import { getInboxSession, INBOX_SESSION_COOKIE } from '../../../../lib/inbox-auth';
import { isInstagramStagingRequest, isInstagramStagingApi } from '../../../../lib/instagram-staging-guard';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await getInboxSession(
    request.cookies.get(INBOX_SESSION_COOKIE)?.value,
  );
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Sesión requerida.' }, { status: 401 });
  }
  if (session.type !== 'user' || session.companySlug !== 'piloto-mw1-prueba' ||
    !['owner', 'admin'].includes(session.roleKey?.toLowerCase() ?? '') ||
    !isInstagramStagingRequest(request)) {
    return NextResponse.json({ ok: false, error: 'Solo disponible para el piloto de staging.' },
      { status: 403 });
  }
  const apiBase = process.env.CHATPRO_API_URL?.trim().replace(/\/$/, '');
  const key = process.env.CHATPRO_INBOX_KEY?.trim();
  if (!apiBase || !key || !isInstagramStagingApi(apiBase)) {
    return NextResponse.json({ok:false,error:'API de staging no configurada.'}, {status:503});
  }
  try {
    const target = new URL(`${apiBase}/integrations/instagram/webhook-subscription`);
    target.searchParams.set('company',session.companySlug);
    const response = await fetch(target,{
      headers: {
        'x-chatpro-inbox-key':key,
        'x-chatpro-user-id':session.userId ?? '',
        'x-chatpro-company-id':session.companyId,
      },
      cache:'no-store',
      signal: AbortSignal.timeout(15000),
    });
    return new NextResponse(await response.text(),{
      status:response.status,
      headers:{'content-type':'application/json','cache-control':'no-store'},
    });
  } catch {
    return NextResponse.json({ok:false,error:'No fue posible consultar Meta. No se cambió nada.'},
      {status:502});
  }
}
