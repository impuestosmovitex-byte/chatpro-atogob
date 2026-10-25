import {NextRequest,NextResponse} from 'next/server';
import {getInboxSession,INBOX_SESSION_COOKIE} from '../../../lib/inbox-auth';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){
 if(process.env.MW1_STAGING_MODE!=='true')return NextResponse.json({ok:false,error:'Solo staging.'},{status:403});
 const session=await getInboxSession(request.cookies.get(INBOX_SESSION_COOKIE)?.value);
 if(session?.type!=='platform'||!session.userId)return NextResponse.json({ok:false,error:'Solo superadministrador.'},{status:403});
 const base=process.env.CHATPRO_API_URL?.trim(),key=process.env.CHATPRO_INBOX_KEY?.trim();
 if(!base||!key)return NextResponse.json({ok:false,error:'Servicio no configurado.'},{status:503});
 const event=request.nextUrl.searchParams.get('event');
 const subscription=request.nextUrl.searchParams.get('subscription');
 if(event&&subscription)return NextResponse.json({ok:false,error:'Consulta ambigua.'},{status:400});
 if(subscription&&!/^[0-9a-f-]{36}$/i.test(subscription))return NextResponse.json({ok:false,error:'Suscripción inválida.'},{status:400});
 if(event&&!/^[0-9a-f-]{36}$/i.test(event))return NextResponse.json({ok:false,error:'Evento inválido.'},{status:400});
 try{
  const target=new URL(subscription?'/staging-mercadopago/activation-readiness':event?'/staging-mercadopago/reconciliation-check':'/staging-mercadopago/reconciliation-preview',base);
  target.searchParams.set('user',session.userId);
  if(event)target.searchParams.set('event',event);
  if(subscription)target.searchParams.set('subscription',subscription);
  const result=await fetch(target,{headers:{'x-chatpro-inbox-key':key},cache:'no-store',signal:AbortSignal.timeout(14000)});
  return new NextResponse(await result.text(),{status:result.status,headers:{'Content-Type':'application/json','Cache-Control':'private,no-store'}});
 }catch{return NextResponse.json({ok:false,error:'No se pudo consultar la conciliación.'},{status:503});}
}
