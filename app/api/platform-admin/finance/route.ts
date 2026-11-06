import {NextRequest,NextResponse} from 'next/server';
import {getInboxSession,INBOX_SESSION_COOKIE} from '../../../lib/inbox-auth';
export const dynamic='force-dynamic';
const json=(data:unknown,status:number)=>NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
async function send(request:NextRequest,method:'GET'|'POST'){
 if(process.env.MW1_STAGING_MODE!=='true')return json({ok:false,error:'Solo staging.'},403);
 const session=await getInboxSession(request.cookies.get(INBOX_SESSION_COOKIE)?.value);
 if(session?.type!=='platform'||!session.userId)
  return json({ok:false,error:'Necesitas la sesión de administración global.'},401);
 const apiBase=process.env.CHATPRO_API_URL?.trim(),internalKey=process.env.CHATPRO_INBOX_KEY?.trim();
 if(!apiBase||!internalKey)return json({ok:false,error:'Finanzas no configuradas.'},503);
 let route='/platform-admin/finance';
 let payload:unknown;
 if(method==='GET'){
  const month=new URL(request.url).searchParams.get('month')||'';
  if(!/^20[2-9][0-9]-(0[1-9]|1[0-2])-01$/.test(month))
   return json({ok:false,error:'Mes inválido.'},400);
  route+='?month='+encodeURIComponent(month);
 }else{
  const origin=request.headers.get('origin');
  if(origin&&origin!=='https://mw1-web-staging-staging.up.railway.app')
   return json({ok:false,error:'Origen no autorizado.'},403);
  const kind=new URL(request.url).searchParams.get('kind');
  if(kind!=='scenario'&&kind!=='actual')return json({ok:false,error:'Operación inválida.'},400);
  route+='/'+kind;
  if(Number(request.headers.get('content-length')||0)>8192)
   return json({ok:false,error:'Solicitud demasiado grande.'},413);
  payload=await request.json().catch(()=>null);
  if(!payload||typeof payload!=='object'||Array.isArray(payload))
   return json({ok:false,error:'Datos inválidos.'},400);
 }
 try{
  const url=new URL(route,apiBase);
  url.searchParams.set('user',session.userId);
  const response=await fetch(url,{method,
   headers:{'x-chatpro-inbox-key':internalKey,...(method==='POST'?{'content-type':'application/json'}:{})},
   ...(method==='POST'?{body:JSON.stringify(payload)}:{}),
   cache:'no-store',signal:AbortSignal.timeout(14000),
  });
  const body=await response.json().catch(()=>({ok:false,error:'Respuesta financiera no válida.'}));
  return json(body,response.status);
 }catch{return json({ok:false,error:'Servicio financiero temporalmente no disponible.'},503);}
}
export async function GET(request:NextRequest){return send(request,'GET');}
export async function POST(request:NextRequest){return send(request,'POST');}
