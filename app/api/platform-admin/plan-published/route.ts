import {NextRequest,NextResponse} from 'next/server';
import {getInboxSession,INBOX_SESSION_COOKIE} from '../../../lib/inbox-auth';

export const dynamic='force-dynamic';

export async function GET(request:NextRequest){
 if(process.env.MW1_STAGING_MODE!=='true')
  return NextResponse.json({ok:false,error:'Disponible únicamente en staging.'},{status:403});
 const session=await getInboxSession(request.cookies.get(INBOX_SESSION_COOKIE)?.value);
 if(session?.type!=='platform'||!session.userId)
  return NextResponse.json({ok:false,error:'Se requiere una sesión de superadministrador.'},{status:401});
 const apiBase=process.env.CHATPRO_API_URL?.trim();
 const inboxKey=process.env.CHATPRO_INBOX_KEY?.trim();
 if(!apiBase||!inboxKey)
  return NextResponse.json({ok:false,error:'Servicio no configurado.'},{status:503});
 try{
  // The public snapshot contains commercial data only. Authorization is
  // enforced here: tenant sessions cannot inspect the admin preview endpoint.
  const response=await fetch(new URL('/platform-admin/plans/public',apiBase),{
   headers:{'x-chatpro-inbox-key':inboxKey},
   cache:'no-store',signal:AbortSignal.timeout(12000),
  });
  if(!response.ok)
   return NextResponse.json({ok:false,error:'No se pudieron consultar los precios publicados.'},{status:response.status});
  const body=await response.json() as {ok?:boolean;plans?:unknown[]};
  return NextResponse.json({ok:true,plans:Array.isArray(body.plans)?body.plans:[]},{
   headers:{'Cache-Control':'private, no-store'},
  });
 }catch{
  return NextResponse.json({ok:false,error:'No fue posible verificar la publicación.'},{status:503});
 }
}
