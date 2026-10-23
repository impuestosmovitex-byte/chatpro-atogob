import {NextRequest,NextResponse} from 'next/server';
import {getInboxSession,INBOX_SESSION_COOKIE} from '../../../lib/inbox-auth';
export const dynamic='force-dynamic';
export async function POST(request:NextRequest){
 if(process.env.MW1_STAGING_MODE!=='true')return NextResponse.json({ok:false,error:'Solo staging.'},{status:403});
 const session=await getInboxSession(request.cookies.get(INBOX_SESSION_COOKIE)?.value);
 if(!session?.userId||session.type!=='platform')return NextResponse.json({ok:false,error:'Sesión requerida.'},{status:401});
 const key=process.env.CHATPRO_INBOX_KEY?.trim(),base=process.env.CHATPRO_API_URL?.trim();
 if(!key||!base)return NextResponse.json({ok:false,error:'Servicio no disponible.'},{status:503});
 const payload=await request.json().catch(()=>null);
 if(!payload||typeof payload.planKey!=='string'||!['inicial','pro','empresa'].includes(payload.planKey))
  return NextResponse.json({ok:false,error:'Plan inválido.'},{status:400});
 try{
  const url=new URL('/platform-admin/plans/publish',base);
  url.searchParams.set('user',session.userId);
  const response=await fetch(url,{method:'POST',headers:{'x-chatpro-inbox-key':key,'content-type':'application/json'},body:JSON.stringify({planKey:payload.planKey}),cache:'no-store',signal:AbortSignal.timeout(12000)});
  return new NextResponse(await response.text(),{status:response.status,headers:{'content-type':'application/json','Cache-Control':'no-store'}});
 }catch{return NextResponse.json({ok:false,error:'No fue posible publicar.'},{status:503});}
}
