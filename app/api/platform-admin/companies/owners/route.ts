import {NextRequest,NextResponse} from 'next/server';
import {getInboxSession,INBOX_SESSION_COOKIE} from '../../../../lib/inbox-auth';

export const dynamic='force-dynamic';
async function authorize(request:NextRequest){
 if(process.env.MW1_STAGING_MODE!=='true')return null;
 const session=await getInboxSession(request.cookies.get(INBOX_SESSION_COOKIE)?.value);
 return session?.type==='platform'&&session.userId?session.userId:null;
}
function apiConfig(){
 const base=process.env.CHATPRO_API_URL?.trim().replace(/\/$/,'');
 const key=process.env.CHATPRO_INBOX_KEY?.trim();
 if(!base||!key)throw new Error('Servicio no configurado');
 return {base,key};
}
async function forward(request:NextRequest,method:'GET'|'POST'){
 const user=await authorize(request);
 if(!user)return NextResponse.json({ok:false,error:'Requiere superadministrador MW1 en staging.'},{status:401});
 // Browsers submit writes only from our own staging hostname.
 if(method==='POST'&&request.headers.get('origin')!=='https://mw1-web-staging-staging.up.railway.app')
  return NextResponse.json({ok:false,error:'Origen no autorizado.'},{status:403});
 if(method==='POST'&&Number(request.headers.get('content-length')||0)>4096)
  return NextResponse.json({ok:false,error:'Solicitud demasiado grande.'},{status:413});
 try{
  const {base,key}=apiConfig();
  const endpoint=new URL('/platform-admin/companies/'+(method==='GET'?'owners':'owner-access'),base);
  endpoint.searchParams.set('user',user);
  const body=method==='POST'?await request.json().catch(()=>null):null;
  if(method==='POST'&&(!body||typeof body!=='object'||Array.isArray(body)))
   return NextResponse.json({ok:false,error:'Solicitud inválida.'},{status:400});
  const upstream=await fetch(endpoint,{
   method,headers:{'x-chatpro-inbox-key':key,...(method==='POST'?{'content-type':'application/json'}:{})},
   ...(method==='POST'?{body:JSON.stringify(body)}:{}),
   cache:'no-store',signal:AbortSignal.timeout(15000),
  });
  return new NextResponse(await upstream.text(),{status:upstream.status,headers:{
   'content-type':'application/json','Cache-Control':'private, no-store',
  }});
 }catch{
  return NextResponse.json({ok:false,error:'No se pudo administrar el acceso.'},{status:503});
 }
}
export async function GET(request:NextRequest){return forward(request,'GET');}
export async function POST(request:NextRequest){return forward(request,'POST');}
