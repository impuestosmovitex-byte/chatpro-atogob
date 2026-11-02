import {NextRequest,NextResponse} from 'next/server';
import {getInboxSession,INBOX_SESSION_COOKIE} from '../../../lib/inbox-auth';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){
 try{
  const session=await getInboxSession(request.cookies.get(INBOX_SESSION_COOKIE)?.value);
  if(!session?.userId||session.type!=='platform')
   return NextResponse.json({ok:false,error:'Super Admin requerido.'},{status:401});
  const base=process.env.CHATPRO_API_URL?.trim().replace(/\/$/,'');
  const key=process.env.CHATPRO_INBOX_KEY?.trim();
  if(!base||!key)throw new Error('Configuración incompleta.');
  const url=new URL(base+'/platform-admin/company-plan-assignment-readiness');
  url.searchParams.set('user',session.userId);
  url.searchParams.set('companyId',request.nextUrl.searchParams.get('companyId')||'');
  const response=await fetch(url,{cache:'no-store',headers:{'x-chatpro-inbox-key':key}});
  return new NextResponse(await response.text(),{status:response.status,
   headers:{'content-type':'application/json'}});
 }catch{return NextResponse.json({ok:false,error:'No se pudo consultar preparación.'},{status:500});}
}
