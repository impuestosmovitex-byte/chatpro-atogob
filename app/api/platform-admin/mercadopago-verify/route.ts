import {NextRequest,NextResponse} from 'next/server';
import {getInboxSession,INBOX_SESSION_COOKIE} from '../../../lib/inbox-auth';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){
 if(process.env.MW1_STAGING_MODE!=='true')
  return NextResponse.json({ok:false,error:'Solo staging.'},{status:403});
 const session=await getInboxSession(request.cookies.get(INBOX_SESSION_COOKIE)?.value);
 if(session?.type!=='platform'||!session.userId)
  return NextResponse.json({ok:false,error:'Acceso exclusivo del superadministrador.'},{status:401});
 const base=process.env.CHATPRO_API_URL?.trim(),key=process.env.CHATPRO_INBOX_KEY?.trim();
 if(!base||!key)return NextResponse.json({ok:false,error:'Servicio no configurado.'},{status:503});
 try{
  const url=new URL('/platform-admin/mercadopago/verify-staging',base);
  url.searchParams.set('user',session.userId);
  const response=await fetch(url,{headers:{'x-chatpro-inbox-key':key},
   cache:'no-store',signal:AbortSignal.timeout(12000)});
  if(!response.ok)return NextResponse.json({ok:false,error:'No se pudo verificar la integración.'},{status:response.status});
  const result=await response.json() as {ok:boolean;configured:boolean;verified:boolean;reason:string};
  return NextResponse.json(result,{headers:{'Cache-Control':'private, no-store'}});
 }catch{return NextResponse.json({ok:false,error:'No se pudo consultar Mercado Pago.'},{status:503});}
}
