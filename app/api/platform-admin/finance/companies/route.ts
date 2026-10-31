import {NextRequest,NextResponse} from 'next/server';
import {getInboxSession,INBOX_SESSION_COOKIE} from '../../../../lib/inbox-auth';
export const dynamic='force-dynamic';
const response=(value:unknown,status:number)=>NextResponse.json(value,{status,headers:{'Cache-Control':'private, no-store'}});
async function handler(request:NextRequest,method:'GET'|'POST'){
 if(process.env.MW1_STAGING_MODE!=='true')return response({ok:false,error:'Solo staging.'},403);
 const session=await getInboxSession(request.cookies.get(INBOX_SESSION_COOKIE)?.value);
 if(session?.type!=='platform'||!session.userId)
  return response({ok:false,error:'Sesión global de administración requerida.'},401);
 const api=process.env.CHATPRO_API_URL?.trim(),key=process.env.CHATPRO_INBOX_KEY?.trim();
 if(!api||!key)return response({ok:false,error:'Servicio no configurado.'},503);
 const url=new URL(method==='GET'?'/platform-admin/finance/companies':'/platform-admin/finance/company',api);
 url.searchParams.set('user',session.userId);
 let body:unknown;
 if(method==='GET'){
  const month=new URL(request.url).searchParams.get('month')||'';
  if(!/^20[2-9][0-9]-(0[1-9]|1[0-2])-01$/.test(month))
   return response({ok:false,error:'Mes no válido.'},400);
  url.searchParams.set('month',month);
 }else{
  const origin=request.headers.get('origin');
  if(origin!=='https://mw1-web-staging-staging.up.railway.app')
   return response({ok:false,error:'Origen no autorizado.'},403);
  if(Number(request.headers.get('content-length')||0)>6000)
   return response({ok:false,error:'Solicitud demasiado grande.'},413);
  body=await request.json().catch(()=>null);
  if(!body||typeof body!=='object'||Array.isArray(body))
   return response({ok:false,error:'Datos inválidos.'},400);
 }
 try{
  const r=await fetch(url,{method,headers:{
    'x-chatpro-inbox-key':key,...(method==='POST'?{'content-type':'application/json'}:{})
   },...(method==='POST'?{body:JSON.stringify(body)}:{}),cache:'no-store',
    signal:AbortSignal.timeout(14000)});
  return response(await r.json().catch(()=>({ok:false,error:'Respuesta no válida.'})),r.status);
 }catch{return response({ok:false,error:'No se pudo conectar con el control financiero.'},503);}
}
export async function GET(request:NextRequest){return handler(request,'GET');}
export async function POST(request:NextRequest){return handler(request,'POST');}
