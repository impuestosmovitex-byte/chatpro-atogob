import {NextRequest,NextResponse} from 'next/server';
import {getInboxSession,INBOX_SESSION_COOKIE} from '../../../lib/inbox-auth';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){
 const session=await getInboxSession(request.cookies.get(INBOX_SESSION_COOKIE)?.value);
 if(!session||session.type!=='platform'||!session.userId||session.roleKey!=='platform_admin')
  return NextResponse.json({ok:false,error:'Solo el superadministrador puede consultar las solicitudes.'},{status:403});
 if(process.env.MW1_STAGING_MODE!=='true')return NextResponse.json({ok:false,error:'No disponible.'},{status:404});
 const api=process.env.CHATPRO_API_URL?.trim(),key=process.env.CHATPRO_INBOX_KEY?.trim();
 if(!api||!key)return NextResponse.json({ok:false,error:'Servicio no configurado.'},{status:503});
 try{
  const r=await fetch(new URL('/staging-subscription-admin',api),{cache:'no-store',headers:{
    'x-chatpro-inbox-key':key,'x-chatpro-user-id':session.userId}});
  return new NextResponse(await r.text(),{status:r.status,headers:{'content-type':'application/json','cache-control':'no-store'}});
 }catch{return NextResponse.json({ok:false,error:'No fue posible consultar las solicitudes.'},{status:502})}
}

export async function POST(request:NextRequest){
 const session=await getInboxSession(request.cookies.get(INBOX_SESSION_COOKIE)?.value);
 if(!session||session.type!=='platform'||!session.userId||session.roleKey!=='platform_admin')
  return NextResponse.json({ok:false,error:'Acceso reservado al superadministrador.'},{status:403});
 if(process.env.MW1_STAGING_MODE!=='true')return NextResponse.json({ok:false,error:'No disponible.'},{status:404});
 const api=process.env.CHATPRO_API_URL?.trim(),key=process.env.CHATPRO_INBOX_KEY?.trim();
 if(!api||!key)return NextResponse.json({ok:false,error:'Servicio no configurado.'},{status:503});
 try{
 const body=await request.json();
 const r=await fetch(new URL('/staging-subscription-admin/review',api),{method:'POST',cache:'no-store',headers:{
 'content-type':'application/json','x-chatpro-inbox-key':key,'x-chatpro-user-id':session.userId
 },body:JSON.stringify(body)});
 return new NextResponse(await r.text(),{status:r.status,headers:{'content-type':'application/json','cache-control':'no-store'}});
 }catch{return NextResponse.json({ok:false,error:'No se pudo registrar la decisión.'},{status:502})}
}
