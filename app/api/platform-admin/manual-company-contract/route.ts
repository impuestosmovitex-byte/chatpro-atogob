import {NextRequest,NextResponse} from 'next/server';
import {signInternalAttestation} from '../../../lib/internal-attestation';
import {getInboxSession,INBOX_SESSION_COOKIE} from '../../../lib/inbox-auth';
export const dynamic='force-dynamic';
async function proxy(req:NextRequest,method:'GET'|'POST'){
 try{
  const session=await getInboxSession(req.cookies.get(INBOX_SESSION_COOKIE)?.value);
  if(!session?.userId||session.type!=='platform')
   return NextResponse.json({ok:false,error:'Super Admin requerido'},{status:401});
  const base=process.env.CHATPRO_API_URL?.trim().replace(/\/$/,'');
  const key=process.env.CHATPRO_INBOX_KEY?.trim();
  if(!base||!key)return NextResponse.json({ok:false,error:'Configuración incompleta'},{status:503});
  const path='/platform-admin/manual-company-contract';
  const url=new URL(base+path);
  url.searchParams.set('user',session.userId);
  if(method==='GET'){
   const companyId=req.nextUrl.searchParams.get('companyId')||'';
   if(!/^[0-9a-f-]{36}$/i.test(companyId))
    return NextResponse.json({ok:false,error:'Empresa inválida'},{status:400});
   url.searchParams.set('companyId',companyId);
  }
  const body=method==='POST'?await req.json():undefined;
  const assertion=signInternalAttestation({kind:'platform',userId:session.userId,
    companyId:'',companySlug:'',method,path,body});
  const res=await fetch(url,{method,cache:'no-store',
   headers:{'x-chatpro-inbox-key':key,
    'x-mw1-internal-assertion':assertion,
    ...(method==='POST'?{'content-type':'application/json'}:{})},
   body:method==='POST'?JSON.stringify(body):undefined});
  return new NextResponse(await res.text(),{status:res.status,
   headers:{'content-type':'application/json'}});
 }catch{
  return NextResponse.json({ok:false,error:'No se pudo completar el contrato manual.'},{status:500});
 }
}
export const GET=(req:NextRequest)=>proxy(req,'GET');
export const POST=(req:NextRequest)=>proxy(req,'POST');
