import {NextRequest,NextResponse} from 'next/server';
import {getInboxSession,INBOX_SESSION_COOKIE} from '../../../lib/inbox-auth';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){
  if(process.env.MW1_STAGING_MODE!=='true')
    return NextResponse.json({ok:false,error:'Disponible solo en la demo.'},{status:403});
  const session=await getInboxSession(request.cookies.get(INBOX_SESSION_COOKIE)?.value);
  if(!session?.userId||session.type!=='platform')
    return NextResponse.json({ok:false,error:'Debes iniciar sesión.'},{status:401});
  const key=process.env.CHATPRO_INBOX_KEY?.trim();
  const base=process.env.CHATPRO_API_URL?.trim();
  if(!key||!base)
    return NextResponse.json({ok:false,error:'Servicio no configurado.'},{status:503});
  try{
    const url=new URL('/platform-admin/demo-requests',base);
    url.searchParams.set('user',session.userId);
    const upstream=await fetch(url,{
      headers:{'x-chatpro-inbox-key':key},
      cache:'no-store',signal:AbortSignal.timeout(12000),
    });
    return new NextResponse(await upstream.text(),{
      status:upstream.status,
      headers:{'content-type':'application/json','Cache-Control':'no-store'},
    });
  }catch{
    return NextResponse.json({ok:false,error:'No se pudo consultar la bandeja comercial.'},{status:503});
  }
}

export async function POST(request:NextRequest){
  if(process.env.MW1_STAGING_MODE!=='true')
    return NextResponse.json({ok:false,error:'Solo staging.'},{status:403});
  const origin=request.headers.get('origin');
  if(origin!=='https://mw1-web-staging-staging.up.railway.app')
    return NextResponse.json({ok:false,error:'Origen no autorizado.'},{status:403});
  const session=await getInboxSession(request.cookies.get(INBOX_SESSION_COOKIE)?.value);
  if(!session?.userId||session.type!=='platform')
    return NextResponse.json({ok:false,error:'Requiere Super Admin de MW1.'},{status:401});
  const key=process.env.CHATPRO_INBOX_KEY?.trim();
  const base=process.env.CHATPRO_API_URL?.trim();
  if(!key||!base)
    return NextResponse.json({ok:false,error:'Servicio no configurado.'},{status:503});
  if(Number(request.headers.get('content-length')||0)>4096)
    return NextResponse.json({ok:false,error:'Solicitud demasiado grande.'},{status:413});
  const payload=await request.json().catch(()=>null);
  if(!payload||typeof payload!=='object'||Array.isArray(payload))
    return NextResponse.json({ok:false,error:'Datos inválidos.'},{status:400});
  try{
    const url=new URL('/platform-admin/demo-requests/follow-up',base);
    url.searchParams.set('user',session.userId);
    const upstream=await fetch(url,{method:'POST',
      headers:{'x-chatpro-inbox-key':key,'content-type':'application/json'},
      body:JSON.stringify(payload),cache:'no-store',signal:AbortSignal.timeout(12000),
    });
    return new NextResponse(await upstream.text(),{
      status:upstream.status,
      headers:{'content-type':'application/json','Cache-Control':'private, no-store'},
    });
  }catch{
    return NextResponse.json({ok:false,error:'No se pudo guardar el seguimiento.'},{status:503});
  }
}
