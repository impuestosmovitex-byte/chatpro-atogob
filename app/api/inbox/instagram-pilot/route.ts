import { NextRequest, NextResponse } from 'next/server';
import { getInboxSession, INBOX_SESSION_COOKIE } from '../../../lib/inbox-auth';
import { isInstagramStagingRequest, isInstagramStagingApi } from '../../../lib/instagram-staging-guard';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await getInboxSession(request.cookies.get(INBOX_SESSION_COOKIE)?.value);
  if (!isInstagramStagingRequest(request) || !session ||
    session.type !== 'user' || !session.userId ||
    session.companySlug !== 'piloto-mw1-prueba') {
    return NextResponse.json({ok:false,error:'Acceso no autorizado.'}, {status:403});
  }
  const base = process.env.CHATPRO_API_URL?.trim().replace(/\/$/, '');
  const key = process.env.CHATPRO_INBOX_KEY?.trim();
  if (!isInstagramStagingApi(base) || !key) {
    return NextResponse.json({ok:false,error:'API de pruebas no configurada.'}, {status:503});
  }
  try {
    const target = new URL(base + '/inbox/instagram-pilot');
    target.searchParams.set('company', session.companySlug);
    const result = await fetch(target, {
      headers: {
        'x-chatpro-inbox-key':key,
        'x-chatpro-user-id':session.userId,
        'x-chatpro-company-id':session.companyId,
      },
      cache:'no-store',
      signal:AbortSignal.timeout(10000),
    });
    return new NextResponse(await result.text(), {
      status:result.status,headers:{'content-type':'application/json','cache-control':'private, no-store'},
    });
  } catch {
    return NextResponse.json({ok:false,error:'No se pudo consultar el diagnóstico de Instagram.'},{status:503});
  }
}
