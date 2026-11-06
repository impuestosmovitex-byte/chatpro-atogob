import { NextRequest, NextResponse } from 'next/server';
import { getInboxSession, INBOX_SESSION_COOKIE } from '../../lib/inbox-auth';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const session = await getInboxSession(request.cookies.get(INBOX_SESSION_COOKIE)?.value);
  if (!session || session.type !== 'user' || !session.userId ||
      !['owner','admin'].includes(session.roleKey))
    return NextResponse.json({ok:false,error:'Acceso no autorizado.'},{status:403});
  if (process.env.MW1_STAGING_MODE !== 'true')
    return NextResponse.json({ok:false,error:'Vista de plan piloto no disponible.'},{status:404});
  const apiBase=process.env.CHATPRO_API_URL?.trim();
  const inboxKey=process.env.CHATPRO_INBOX_KEY?.trim();
  if(!apiBase||!inboxKey) return NextResponse.json({ok:false,error:'Configuración no disponible.'},{status:503});
  const target=new URL('/staging-my-plan',apiBase);
  target.searchParams.set('company',session.companySlug);
  try {
    const response=await fetch(target,{cache:'no-store',headers:{
      'x-chatpro-inbox-key':inboxKey,'x-chatpro-user-id':session.userId,
      'x-chatpro-company-id':session.companyId
    }});
    return new NextResponse(await response.text(),{status:response.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  } catch {
    return NextResponse.json({ok:false,error:'No se pudo consultar el plan.'},{status:502});
  }
}

export async function POST(request:NextRequest){
 const session=await getInboxSession(request.cookies.get(INBOX_SESSION_COOKIE)?.value);
 if(!session||session.type!=='user'||!session.userId||session.roleKey!=='owner')
   return NextResponse.json({ok:false,error:'Solo el propietario puede solicitar cambios.'},{status:403});
 if(process.env.MW1_STAGING_MODE!=='true')
   return NextResponse.json({ok:false,error:'No disponible.'},{status:404});
 const apiBase=process.env.CHATPRO_API_URL?.trim();
 const inboxKey=process.env.CHATPRO_INBOX_KEY?.trim();
 if(!apiBase||!inboxKey)return NextResponse.json({ok:false,error:'Configuración no disponible.'},{status:503});
 const target=new URL('/staging-my-plan/request',apiBase);
 target.searchParams.set('company',session.companySlug);
 try{
   const payload=await request.json();
   const result=await fetch(target,{method:'POST',cache:'no-store',headers:{
     'content-type':'application/json','x-chatpro-inbox-key':inboxKey,
     'x-chatpro-user-id':session.userId,'x-chatpro-company-id':session.companyId
   },body:JSON.stringify(payload)});
   return new NextResponse(await result.text(),{status:result.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 }catch{return NextResponse.json({ok:false,error:'No se pudo registrar la solicitud.'},{status:502})}
}
