import {NextRequest,NextResponse} from 'next/server';
import {getInboxSession,INBOX_SESSION_COOKIE} from '../../../lib/inbox-auth';

export const dynamic='force-dynamic';
async function forward(request:NextRequest,method:'GET'|'POST'){
  if(process.env.MW1_STAGING_MODE!=='true')
    return NextResponse.json({ok:false,error:'Solo disponible en MW1 de pruebas.'},{status:403});
  const session=await getInboxSession(request.cookies.get(INBOX_SESSION_COOKIE)?.value);
  if(!session?.userId||session.type!=='user')
    return NextResponse.json({ok:false,error:'Sesión requerida.'},{status:401});
  const key=process.env.CHATPRO_INBOX_KEY?.trim();
  const base=process.env.CHATPRO_API_URL?.trim();
  if(!key||!base)
    return NextResponse.json({ok:false,error:'Servicio no configurado.'},{status:503});
  if(method==='POST'&&Number(request.headers.get('content-length')||0)>4000)
    return NextResponse.json({ok:false,error:'Solicitud demasiado larga.'},{status:413});
  let body:unknown=undefined;
  if(method==='POST'){
    body=await request.json().catch(()=>null);
    if(!body||typeof body!=='object'||Array.isArray(body))
      return NextResponse.json({ok:false,error:'Datos inválidos.'},{status:400});
  }
  try{
    const endpoint=new URL('/platform-admin/plans/drafts',base);
    endpoint.searchParams.set('user',session.userId);
    const response=await fetch(endpoint,{
      method,headers:{'x-chatpro-inbox-key':key,
        ...(method==='POST'?{'content-type':'application/json'}:{})},
      ...(method==='POST'?{body:JSON.stringify(body)}:{}),
      cache:'no-store',signal:AbortSignal.timeout(12000),
    });
    return new NextResponse(await response.text(),{
      status:response.status,
      headers:{'content-type':'application/json','Cache-Control':'no-store'},
    });
  }catch{
    return NextResponse.json({ok:false,error:'No se pudo consultar o guardar el plan.'},{status:503});
  }
}
export async function GET(request:NextRequest){return forward(request,'GET');}
export async function POST(request:NextRequest){return forward(request,'POST');}
