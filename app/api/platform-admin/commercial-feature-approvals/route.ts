import {NextRequest,NextResponse} from 'next/server';
import {getInboxSession,INBOX_SESSION_COOKIE} from '../../../lib/inbox-auth';
export const dynamic='force-dynamic';
async function proxy(request:NextRequest,method:'GET'|'POST'){
 try{
  const session=await getInboxSession(request.cookies.get(INBOX_SESSION_COOKIE)?.value);
  if(!session?.userId||session.type!=='platform')
   return NextResponse.json({ok:false,error:'Sesión de Super Admin requerida.'},{status:401});
  const base=process.env.CHATPRO_API_URL?.trim().replace(/\/$/,'');
  const key=process.env.CHATPRO_INBOX_KEY?.trim();
  if(!base||!key)throw new Error('Configuración incompleta.');
  const target=new URL(base+'/platform-admin/commercial-feature-approvals');
  target.searchParams.set('user',session.userId);
  const response=await fetch(target,{method,
   headers:{'x-chatpro-inbox-key':key,...(method==='POST'?{'content-type':'application/json'}:{})},
   body:method==='POST'?JSON.stringify(await request.json()):undefined,
   cache:'no-store'});
  return new NextResponse(await response.text(),{status:response.status,
   headers:{'content-type':'application/json'}});
 }catch{
  return NextResponse.json({ok:false,error:'Error consultando aprobaciones.'},{status:500});
 }
}
export const GET=(request:NextRequest)=>proxy(request,'GET');
export const POST=(request:NextRequest)=>proxy(request,'POST');
