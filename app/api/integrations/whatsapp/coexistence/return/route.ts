import { NextRequest, NextResponse } from 'next/server';
import { getInboxSession, INBOX_SESSION_COOKIE } from '../../../../../lib/inbox-auth';

export const dynamic='force-dynamic';
const HOST='mw1-web-staging-staging.up.railway.app';
const ORIGIN='https://'+HOST;
const APIS=new Set([
  'http://mw1-api-staging.railway.internal:8080',
  'https://mw1-api-staging-staging.up.railway.app',
]);
const HEADERS={'Cache-Control':'no-store'};
const COOKIE='__Host-mw1-wa-coexistence-state';

/**
 * Meta return is a server-only staging bridge, not an onboarding endpoint.
 * Requires prior signed owner/admin session + nonce set by /pilot, and an
 * independent explicit review flag. Browser never supplies the signed state.
 */
export async function POST(request:NextRequest){
  if(request.headers.get('host')!==HOST||
      process.env.MW1_STAGING_MODE!=='true'||
      process.env.MW1_STAGING_WHATSAPP_COEXISTENCE_META_LAUNCH_ENABLED!=='true'||
      process.env.MW1_STAGING_WHATSAPP_COEXISTENCE_META_REVIEW_ENABLED!=='true'||
      process.env.MW1_STAGING_WHATSAPP_COEXISTENCE_OAUTH_BEGIN_ENABLED!=='true'){
    return NextResponse.json({ok:false,error:'Retorno de piloto no habilitado.'},
      {status:403,headers:HEADERS});
  }
  if(request.headers.get('origin')!==ORIGIN ||
      (request.headers.get('sec-fetch-site') &&
       request.headers.get('sec-fetch-site')!=='same-origin')){
    return NextResponse.json({ok:false,error:'Origen no autorizado.'},
      {status:403,headers:HEADERS});
  }
  const session=await getInboxSession(
    request.cookies.get(INBOX_SESSION_COOKIE)?.value);
  if(!session||session.type!=='user'||!session.userId||
      session.companySlug!=='piloto-mw1-prueba'||
      !['owner','admin'].includes(session.roleKey.trim().toLowerCase())){
    return NextResponse.json({ok:false,error:'Acceso al piloto no autorizado.'},
      {status:403,headers:HEADERS});
  }
  const api=process.env.CHATPRO_API_URL?.trim().replace(/\/$/,'')||'';
  const key=process.env.CHATPRO_INBOX_KEY?.trim()||'';
  const signedState=request.cookies.get(COOKIE)?.value||'';
  if(!APIS.has(api)||!key||signedState.length<64||
      signedState.length>2048){
    return NextResponse.json({ok:false,error:'Estado temporal inválido o vencido.'},
      {status:403,headers:HEADERS});
  }
  let body:{metaMessageOrigin?:unknown;metaMessageJson?:unknown;
    sdkLoginResponse?:unknown};
  try{
    const text=await request.text();
    if(text.length>15000)throw Error('too large');
    body=JSON.parse(text);
    if(!body||typeof body!=='object'||Array.isArray(body)||
        typeof body.metaMessageOrigin!=='string'||
        typeof body.metaMessageJson!=='string')throw Error('invalid');
  }catch{
    return NextResponse.json({ok:false,error:'Retorno de Meta no válido.'},
      {status:400,headers:HEADERS});
  }
  try{
    const url=new URL(api+'/integrations/whatsapp/coexistence/pilot/review');
    url.searchParams.set('company',session.companySlug);
    const response=await fetch(url,{
      method:'POST',cache:'no-store',redirect:'error',
      signal:AbortSignal.timeout(20000),
      headers:{
        'content-type':'application/json',
        'x-chatpro-inbox-key':key,
        'x-chatpro-user-id':session.userId,
        'x-chatpro-company-id':session.companyId,
      },
      body:JSON.stringify({
        signedState, trustedHttpOnlyCookieState:signedState,
        metaMessageOrigin:body.metaMessageOrigin,
        metaMessageJson:body.metaMessageJson,
        sdkLoginResponse:body.sdkLoginResponse,
      }),
    });
    const data=await response.json() as {
      ok?:unknown;status?:unknown;connectionEnabled?:unknown;
      webhookEnabled?:unknown;historySyncEnabled?:unknown;
    };
    const safe=response.ok&&data.ok===true&&
      data.connectionEnabled===false&&
      data.webhookEnabled===false&&data.historySyncEnabled===false;
    const answer=NextResponse.json({
      ok:safe,
      status:safe?'meta_evidence_reviewed_only':'review_not_approved',
      connectionEnabled:false,webhookEnabled:false,
      historySyncEnabled:false,
      message:safe?'Meta validó las evidencias. La conexión todavía no está activada.':
        'No se pudo verificar la titularidad y la coexistencia. Nada fue conectado.',
    },{status:safe?200:403,headers:HEADERS});
    answer.cookies.set(COOKIE,'',{httpOnly:true,secure:true,
      sameSite:'lax',path:'/',maxAge:0});
    return answer;
  }catch{
    return NextResponse.json({ok:false,error:'Revisión del piloto no disponible.'},
      {status:503,headers:HEADERS});
  }
}
