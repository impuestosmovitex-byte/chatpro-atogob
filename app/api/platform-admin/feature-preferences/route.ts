import { NextRequest, NextResponse } from 'next/server';
import {signInternalAttestation} from '../../../lib/internal-attestation';
import { getInboxSession, INBOX_SESSION_COOKIE } from '../../../lib/inbox-auth';
export const dynamic = 'force-dynamic';

async function proxy(request: NextRequest, method: 'GET'|'POST') {
  try {
    const session = await getInboxSession(request.cookies.get(INBOX_SESSION_COOKIE)?.value);
    if (!session?.userId || session.type !== 'platform')
      return NextResponse.json({ok:false,error:'Sesión de Super Admin requerida.'},{status:401});
    const base=process.env.CHATPRO_API_URL?.trim().replace(/\/$/,'');
    const key=process.env.CHATPRO_INBOX_KEY?.trim();
    if (!base || !key) throw new Error('Falta configuración del servidor.');
    const target=new URL(base+'/platform-admin/feature-preferences');
    target.searchParams.set('user',session.userId);
    if (method==='GET')
      target.searchParams.set('companyId',request.nextUrl.searchParams.get('companyId')??'');
    const body=method==='POST'?await request.json():undefined;
    const res=await fetch(target,{
      method,
      headers:{'x-chatpro-inbox-key':key,...(method==='POST'?{'content-type':'application/json'}:{}),
        'x-mw1-internal-assertion':signInternalAttestation({kind:'platform',userId:session.userId,companyId:'',companySlug:'',method,path:'/platform-admin/feature-preferences',body:method==='GET'?{companyId:target.searchParams.get('companyId')||''}:body})}, 
      body:method==='POST'?JSON.stringify(body):undefined,
      cache:'no-store',
    });
    return new NextResponse(await res.text(),{status:res.status,
      headers:{'content-type':res.headers.get('content-type')||'application/json'}});
  } catch {
    return NextResponse.json({ok:false,error:'No se pudo gestionar la configuración.'},{status:500});
  }
}
export const GET=(request:NextRequest)=>proxy(request,'GET');
export const POST=(request:NextRequest)=>proxy(request,'POST');
