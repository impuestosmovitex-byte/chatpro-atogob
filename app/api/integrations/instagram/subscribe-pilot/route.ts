import { NextRequest, NextResponse } from 'next/server';
import { getInboxSession, INBOX_SESSION_COOKIE } from '../../../../lib/inbox-auth';
import { isInstagramStagingRequest, isInstagramStagingApi } from '../../../../lib/instagram-staging-guard';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  // State-changing Meta calls require a same-origin browser action.
  // A signed user cookie alone must not authorize cross-site submission.
  if (request.headers.get('origin') !==
    'https://mw1-web-staging-staging.up.railway.app') {
    return NextResponse.json({ok:false,error:'Origen no autorizado.'},
      {status:403,headers:{'Cache-Control':'no-store'}});
  }
  const session = await getInboxSession(
    request.cookies.get(INBOX_SESSION_COOKIE)?.value,
  );
  if (!session || session.type !== 'user' ||
    !['owner','admin'].includes(session.roleKey?.toLowerCase() ?? '') ||
    session.companySlug !== 'piloto-mw1-prueba' ||
    !isInstagramStagingRequest(request)) {
    return NextResponse.json({ok:false,error:'Solo el administrador del piloto puede realizar esta operación.'},
      {status:403,headers:{'Cache-Control':'no-store'}});
  }
  // Intentionally disabled until end-to-end webhook ingestion tests finish.
  if (process.env.MW1_STAGING_INSTAGRAM_SUBSCRIBE_UI_ENABLED !== 'true') {
    return NextResponse.json({
      ok:false,
      error:'La suscripción de Instagram sigue bloqueada hasta completar las pruebas del receptor.',
    },{status:403,headers:{'Cache-Control':'no-store'}});
  }
  const base = process.env.CHATPRO_API_URL?.trim().replace(/\/$/,'');
  const key = process.env.CHATPRO_INBOX_KEY?.trim();
  if (!base || !key || !isInstagramStagingApi(base)) {
    return NextResponse.json({ok:false,error:'La API de pruebas no está configurada.'},{status:503});
  }
  try {
    const target = new URL(base + '/integrations/instagram/subscribe-pilot');
    target.searchParams.set('company',session.companySlug);
    const response = await fetch(target,{
      method:'POST',
      headers:{
        'x-chatpro-inbox-key':key,
        'x-chatpro-user-id':session.userId ?? '',
        'x-chatpro-company-id':session.companyId,
      },
      cache:'no-store',
      signal:AbortSignal.timeout(20000),
    });
    return new NextResponse(await response.text(),{
      status:response.status,
      headers:{'content-type':'application/json','cache-control':'no-store'},
    });
  } catch {
    return NextResponse.json({ok:false,error:'No se pudo completar la operación con Meta.'},{status:502});
  }
}
