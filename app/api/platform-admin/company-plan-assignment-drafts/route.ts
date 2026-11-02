import {NextRequest,NextResponse} from 'next/server';
import {getInboxSession,INBOX_SESSION_COOKIE} from '../../../lib/inbox-auth';
export const dynamic='force-dynamic';
async function proxy(req:NextRequest,method:'GET'|'POST'){
 try{
  const session=await getInboxSession(req.cookies.get(INBOX_SESSION_COOKIE)?.value);
  if(!session?.userId||session.type!=='platform')
   return NextResponse.json({ok:false,error:'Super Admin requerido'},{status:401});
  const base=process.env.CHATPRO_API_URL?.trim().replace(/\/$/,'');
  const key=process.env.CHATPRO_INBOX_KEY?.trim();
  if(!base||!key)throw new Error('Configuración incompleta.');
  const url=new URL(base+'/platform-admin/company-plan-assignment-drafts');
  url.searchParams.set('user',session.userId);
  const res=await fetch(url,{method,cache:'no-store',
   headers:{'x-chatpro-inbox-key':key,...(method==='POST'?{'content-type':'application/json'}:{})},
   body:method==='POST'?JSON.stringify(await req.json()):undefined});
  return new NextResponse(await res.text(),{status:res.status,headers:{'content-type':'application/json'}});
 }catch{return NextResponse.json({ok:false,error:'No se pudo procesar el borrador.'},{status:500});}
}
export const GET=(req:NextRequest)=>proxy(req,'GET');
export const POST=(req:NextRequest)=>proxy(req,'POST');
