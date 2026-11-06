import {NextRequest,NextResponse} from 'next/server';
import {getInboxSession,INBOX_SESSION_COOKIE} from '../../../lib/inbox-auth';
export const dynamic='force-dynamic';
export async function POST(req:NextRequest){
 const session=await getInboxSession(req.cookies.get(INBOX_SESSION_COOKIE)?.value);
 if(!session?.userId||session.type!=='platform')
  return NextResponse.json({ok:false,error:'Acceso restringido'},{status:401});
 const base=process.env.CHATPRO_API_URL?.trim();
 const secret=process.env.CHATPRO_INBOX_KEY?.trim();
 if(!base||!secret)return NextResponse.json({ok:false,error:'Configuración incompleta'},{status:503});
 const url=new URL(base.replace(/\/$/,'')+'/platform-admin/company-plan-activation-review');
 url.searchParams.set('user',session.userId);
 const result=await fetch(url,{method:'POST',cache:'no-store',
  headers:{'x-chatpro-inbox-key':secret,'content-type':'application/json'},
  body:JSON.stringify(await req.json())});
 return new NextResponse(await result.text(),{status:result.status,headers:{'content-type':'application/json'}});
}
