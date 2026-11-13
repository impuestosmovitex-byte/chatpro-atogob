import {NextRequest,NextResponse} from 'next/server';
import {signInternalAttestation} from '../../../lib/internal-attestation';
import {getInboxSession,INBOX_SESSION_COOKIE} from '../../../lib/inbox-auth';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){
 const session=await getInboxSession(req.cookies.get(INBOX_SESSION_COOKIE)?.value);
 if(!session?.userId||session.type!=='platform')
  return NextResponse.json({ok:false,error:'Acceso restringido'},{status:401});
 const base=process.env.CHATPRO_API_URL?.trim();
 const secret=process.env.CHATPRO_INBOX_KEY?.trim();
 if(!base||!secret)
  return NextResponse.json({ok:false,error:'Configuración incompleta'},{status:503});
 const url=new URL(base.replace(/\/$/,'')+'/platform-admin/company-plan-activation-history');
 url.searchParams.set('user',session.userId);
 url.searchParams.set('companyId',req.nextUrl.searchParams.get('companyId')||'');
 const result=await fetch(url,{cache:'no-store',headers:{'x-chatpro-inbox-key':secret,'x-mw1-internal-assertion':signInternalAttestation({kind:'platform',userId:session.userId,companyId:'',companySlug:'',method:'GET',path:'/platform-admin/company-plan-activation-history',body:{companyId:url.searchParams.get('companyId')||''}})}});
 return new NextResponse(await result.text(),{status:result.status,headers:{'content-type':'application/json'}});
}
