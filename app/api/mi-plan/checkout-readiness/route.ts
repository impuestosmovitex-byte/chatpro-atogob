import {NextRequest,NextResponse} from 'next/server';
import {getInboxSession,INBOX_SESSION_COOKIE} from '../../../lib/inbox-auth';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){
 const session=await getInboxSession(request.cookies.get(INBOX_SESSION_COOKIE)?.value);
 if(process.env.MW1_STAGING_MODE!=='true')return NextResponse.json({ok:false,error:'Solo staging.'},{status:403});
 if(session?.type!=='user'||session.roleKey!=='owner'||!session.userId||!session.companyId||!session.companySlug)
  return NextResponse.json({ok:false,error:'Solo el propietario puede consultar la contratación.'},{status:403});
 const base=process.env.CHATPRO_API_URL?.trim(),key=process.env.CHATPRO_INBOX_KEY?.trim();
 if(!base||!key)return NextResponse.json({ok:false,error:'Servicio no configurado.'},{status:503});
 try{
  const url=new URL('/staging-my-plan/checkout-readiness',base);
  url.searchParams.set('company',session.companySlug);
  const result=await fetch(url,{cache:'no-store',headers:{'x-chatpro-inbox-key':key,'x-chatpro-user-id':session.userId,'x-chatpro-company-id':session.companyId},signal:AbortSignal.timeout(12000)});
  return new NextResponse(await result.text(),{status:result.status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store'}});
 }catch{return NextResponse.json({ok:false,error:'No se pudo comprobar la contratación.'},{status:503});}
}
