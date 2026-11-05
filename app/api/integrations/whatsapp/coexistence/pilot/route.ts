import { NextRequest, NextResponse } from 'next/server';
import { getInboxSession, INBOX_SESSION_COOKIE } from '../../../../../lib/inbox-auth';

export const dynamic = 'force-dynamic';

const HOST = 'mw1-web-staging-staging.up.railway.app';
const ORIGIN = 'https://' + HOST;
const API_ENDPOINTS = new Set([
  'http://mw1-api-staging.railway.internal:8080',
  'https://mw1-api-staging-staging.up.railway.app',
]);
const noStore = {'Cache-Control':'no-store'};

async function authorized(request: NextRequest) {
  if (request.nextUrl.hostname !== HOST ||
      process.env.MW1_STAGING_MODE !== 'true') return null;
  const session = await getInboxSession(
    request.cookies.get(INBOX_SESSION_COOKIE)?.value,
  );
  if (!session || session.type !== 'user' || !session.userId ||
      session.companySlug !== 'piloto-mw1-prueba' ||
      !['owner','admin'].includes(session.roleKey.trim().toLowerCase())) return null;
  const apiBase = process.env.CHATPRO_API_URL?.trim().replace(/\/$/,'') || '';
  const inboxKey = process.env.CHATPRO_INBOX_KEY?.trim() || '';
  if (!API_ENDPOINTS.has(apiBase) || !inboxKey) return null;
  return {session,apiBase,inboxKey};
}

/** Pure readiness lookup; no SDK, cookies or Meta authorization issued. */
export async function GET(request: NextRequest) {
  const ctx=await authorized(request);
  if (!ctx) return NextResponse.json({ok:false,error:'Piloto no autorizado.'},
    {status:403,headers:noStore});
  try {
    const url=new URL(ctx.apiBase+'/integrations/whatsapp/coexistence/pilot/readiness');
    url.searchParams.set('company',ctx.session.companySlug);
    const r=await fetch(url,{
      method:'GET',cache:'no-store',redirect:'error',
      signal:AbortSignal.timeout(8000),
      headers:{
        'x-chatpro-inbox-key':ctx.inboxKey,
        'x-chatpro-user-id':ctx.session.userId!,
        'x-chatpro-company-id':ctx.session.companyId,
      },
    });
    if (!r.ok) throw Error('staging API not ready');
    const data=await r.json() as {
      ok?:unknown;beginReady?:unknown;message?:unknown;
    };
    if (data.ok!==true) throw Error('bad status');
    const ready=data.beginReady===true &&
      process.env.MW1_STAGING_WHATSAPP_COEXISTENCE_OAUTH_BEGIN_ENABLED==='true';
    return NextResponse.json({
      ok:true,beginReady:ready,
      metaLaunchEnabled:false,codeExchangeEnabled:false,
      connectionEnabled:false,
      message:ready
        ? 'Inicio seguro disponible exclusivamente para el piloto; Meta no se abrirá.'
        : 'El inicio firmado de coexistencia aún necesita habilitación exclusiva en staging.',
    },{headers:noStore});
  } catch {
    return NextResponse.json({ok:false,error:'No se pudo consultar la preparación del piloto.'},
      {status:503,headers:noStore});
  }
}

/**
 * Issues only an internal one-time state. It NEVER calls FB.login, exchanges
 * codes, connects phones, subscribes webhooks or imports messages. Browser
 * receives only the opaque onboarding id; signed state stays HttpOnly.
 */
export async function POST(request: NextRequest) {
  const ctx=await authorized(request);
  if (!ctx) return NextResponse.json({ok:false,error:'Piloto no autorizado.'},
    {status:403,headers:noStore});
  if (request.headers.get('origin')!==ORIGIN ||
      (request.headers.get('sec-fetch-site') &&
       request.headers.get('sec-fetch-site')!=='same-origin')) {
    return NextResponse.json({ok:false,error:'Origen de solicitud no autorizado.'},
      {status:403,headers:noStore});
  }
  if (process.env.MW1_STAGING_WHATSAPP_COEXISTENCE_OAUTH_BEGIN_ENABLED!=='true') {
    return NextResponse.json({ok:false,error:'El inicio firmado del piloto está deshabilitado.'},
      {status:503,headers:noStore});
  }
  try {
    const url=new URL(ctx.apiBase+'/integrations/whatsapp/coexistence/pilot/begin');
    url.searchParams.set('company',ctx.session.companySlug);
    const r=await fetch(url,{
      method:'POST',cache:'no-store',redirect:'error',
      signal:AbortSignal.timeout(8000),
      headers:{
        'x-chatpro-inbox-key':ctx.inboxKey,
        'x-chatpro-user-id':ctx.session.userId!,
        'x-chatpro-company-id':ctx.session.companyId,
      },
    });
    if (!r.ok) throw Error('not authorized for nonce');
    const data=await r.json() as {
      ok?:unknown;signedState?:unknown;onboardingId?:unknown;
      connectionEnabled?:unknown;metaLaunchEnabled?:unknown;
    };
    if (data.ok!==true || typeof data.signedState!=='string' ||
        data.signedState.length<64 || data.signedState.length>2048 ||
        typeof data.onboardingId!=='string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.onboardingId) ||
        data.connectionEnabled!==false || data.metaLaunchEnabled!==false) {
      throw Error('invalid pilot nonce response');
    }
    const reply=NextResponse.json({
      ok:true,status:'nonce_prepared_only',
      onboardingId:data.onboardingId,
      metaLaunchEnabled:false,codeExchangeEnabled:false,
      connectionEnabled:false,
      message:'Se preparó una autorización temporal del piloto. No se abrió Meta ni se conectó WhatsApp.',
    },{headers:noStore});
    reply.cookies.set('__Host-mw1-wa-coexistence-state',data.signedState,{
      httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:420,
    });
    return reply;
  } catch {
    return NextResponse.json({
      ok:false,error:'No se pudo preparar la autorización de prueba. No se inició Meta.',
    },{status:503,headers:noStore});
  }
}
