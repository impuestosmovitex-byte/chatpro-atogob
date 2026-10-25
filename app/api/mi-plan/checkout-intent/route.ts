import {NextRequest,NextResponse} from 'next/server';
import {getInboxSession,INBOX_SESSION_COOKIE} from '../../../lib/inbox-auth';
export const dynamic='force-dynamic';
export async function POST(request:NextRequest){
 const session=await getInboxSession(request.cookies.get(INBOX_SESSION_COOKIE)?.value);
 if(process.env.MW1_STAGING_MODE!=='true')return NextResponse.json({ok:false,error:'Solo staging.'},{status:403});
 if(session?.type!=='user'||session.roleKey!=='owner'||!session.userId||!session.companyId||!session.companySlug)
  return NextResponse.json({ok:false,error:'Solo el propietario puede preparar una contratación.'},{status:403});
 const base=process.env.CHATPRO_API_URL?.trim(),key=process.env.CHATPRO_INBOX_KEY?.trim();
 if(!base||!key)return NextResponse.json({ok:false,error:'Servicio no configurado.'},{status:503});
 try{
  const url=new URL('/staging-my-plan/checkout-intent',base);url.searchParams.set('company',session.companySlug);
  const response=await fetch(url,{method:'POST',cache:'no-store',headers:{'x-chatpro-inbox-key':key,'x-chatpro-user-id':session.userId,'x-chatpro-company-id':session.companyId},signal:AbortSignal.timeout(12000)});
  return new NextResponse(await response.text(),{status:response.status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store'}});
 }catch{return NextResponse.json({ok:false,error:'No se pudo preparar la contratación.'},{status:503});}
}
