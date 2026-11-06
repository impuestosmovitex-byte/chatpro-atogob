import {NextRequest,NextResponse} from 'next/server';
import {createHmac} from 'node:crypto';
import {getInboxSession,INBOX_SESSION_COOKIE} from '../../../lib/inbox-auth';

export const dynamic='force-dynamic';
const base='https://mw1-web-staging-staging.up.railway.app';
const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{
  'Cache-Control':'private, no-store',
}});
function config(){
 const api=process.env.CHATPRO_API_URL?.trim().replace(/\/$/,'');
 const key=process.env.CHATPRO_INBOX_KEY?.trim();
 if(!api||!key)throw new Error('Servicio no configurado');
 return {api,key};
}
export async function POST(request:NextRequest){
 if(process.env.MW1_STAGING_MODE!=='true')
  return json({ok:false,error:'Recuperación asistida no habilitada.'},403);
 if(request.headers.get('origin')!==base)
  return json({ok:false,error:'Origen no autorizado.'},403);
 if(Number(request.headers.get('content-length')||0)>2000)
  return json({ok:false,error:'Solicitud demasiado extensa.'},413);
 const body=await request.json().catch(()=>null);
 if(!body||typeof body!=='object'||Array.isArray(body))
  return json({ok:false,error:'Solicitud inválida.'},400);
 try{
  const {api,key}=config();
  const row=body as Record<string,unknown>;
  if(row.website)return json({ok:true,message:'Solicitud recibida.'});
  const ip=(request.headers.get('x-forwarded-for')||'unknown').split(',')[0].trim().slice(0,80);
  const digest=createHmac('sha256',key).update(ip).digest('hex');
  const response=await fetch(new URL('/platform-admin/recovery-requests',api),{
   method:'POST',headers:{'content-type':'application/json','x-chatpro-inbox-key':key},
   body:JSON.stringify({
    companySlug:row.companySlug,identifier:row.identifier,
    method:row.method,contact:row.contact,visitorDigest:digest,
   }),cache:'no-store',signal:AbortSignal.timeout(12000),
  });
  if(!response.ok)return json({ok:false,error:response.status===400
    ?'Revisa la empresa, tu código de acceso y el contacto.':'No fue posible registrar la solicitud.'},
   response.status===400?400:503);
  return json({ok:true,message:'Recibimos tu solicitud. Un asesor verificará tu identidad antes de restablecer la contraseña.'});
 }catch{return json({ok:false,error:'No fue posible registrar la solicitud.'},503);}
}
export async function GET(request:NextRequest){
 if(process.env.MW1_STAGING_MODE!=='true')
  return json({ok:false,error:'Solo staging.'},403);
 const session=await getInboxSession(request.cookies.get(INBOX_SESSION_COOKIE)?.value);
 if(session?.type!=='platform'||!session.userId)
  return json({ok:false,error:'Solo superadministrador.'},401);
 try{
  const {api,key}=config();
  const url=new URL('/platform-admin/recovery-requests',api);
  url.searchParams.set('user',session.userId);
  const res=await fetch(url,{headers:{'x-chatpro-inbox-key':key},cache:'no-store',signal:AbortSignal.timeout(12000)});
  return new NextResponse(await res.text(),{status:res.status,headers:{
   'content-type':'application/json','Cache-Control':'private, no-store',
  }});
 }catch{return json({ok:false,error:'No se pudieron consultar solicitudes.'},503);}
}
