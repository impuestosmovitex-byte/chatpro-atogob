import {NextRequest,NextResponse} from 'next/server';
import {signInternalAttestation} from '../../../lib/internal-attestation';
import {getInboxSession,INBOX_SESSION_COOKIE} from '../../../lib/inbox-auth';
export const dynamic='force-dynamic';
export async function POST(request:NextRequest){
 try{
  const session=await getInboxSession(request.cookies.get(INBOX_SESSION_COOKIE)?.value);
  if(!session?.userId||session.type!=='platform')
   return NextResponse.json({ok:false,error:'Super Admin requerido.'},{status:401});
  const base=process.env.CHATPRO_API_URL?.trim().replace(/\/$/,'');
  const key=process.env.CHATPRO_INBOX_KEY?.trim();
  if(!base||!key)throw new Error('Configuración incompleta.');
  const url=new URL(base+'/platform-admin/company-plan-activation-request');
  url.searchParams.set('user',session.userId);
  const body=await request.json();
  const response=await fetch(url,{method:'POST',cache:'no-store',
    headers:{'x-chatpro-inbox-key':key,'content-type':'application/json',
      'x-mw1-internal-assertion':signInternalAttestation({kind:'platform',userId:session.userId,companyId:'',companySlug:'',method:'POST',path:'/platform-admin/company-plan-activation-request',body})},
    body:JSON.stringify(body)});
  return new NextResponse(await response.text(),{status:response.status,
    headers:{'content-type':'application/json'}});
 }catch{
  return NextResponse.json({ok:false,error:'No se pudo registrar la solicitud.'},{status:500});
 }
}
