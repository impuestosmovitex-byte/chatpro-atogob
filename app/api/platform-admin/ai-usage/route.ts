import {NextRequest,NextResponse} from 'next/server';
import {getInboxSession,INBOX_SESSION_COOKIE} from '../../../lib/inbox-auth';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){
 if(process.env.MW1_STAGING_MODE!=='true')return NextResponse.json({ok:false,error:'Solo staging.'},{status:403});
 const session=await getInboxSession(request.cookies.get(INBOX_SESSION_COOKIE)?.value);
 if(!session?.userId||session.type!=='platform')return NextResponse.json({ok:false,error:'Sesión requerida.'},{status:401});
 const companyId=request.nextUrl.searchParams.get('companyId')??'';
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(companyId))
  return NextResponse.json({ok:false,error:'Empresa inválida.'},{status:400});
 const key=process.env.CHATPRO_INBOX_KEY?.trim(),base=process.env.CHATPRO_API_URL?.trim();
 if(!key||!base)return NextResponse.json({ok:false,error:'Servicio no disponible.'},{status:503});
 try{
  const url=new URL('/platform-admin/ai-usage',base);
  url.searchParams.set('user',session.userId);url.searchParams.set('companyId',companyId);
  const response=await fetch(url,{headers:{'x-chatpro-inbox-key':key},cache:'no-store',signal:AbortSignal.timeout(12000)});
  return new NextResponse(await response.text(),{status:response.status,headers:{'content-type':'application/json','Cache-Control':'no-store'}});
 }catch{return NextResponse.json({ok:false,error:'Reporte no disponible.'},{status:503});}
}
