import {NextRequest,NextResponse} from 'next/server';
import {createHmac} from 'node:crypto';

export const dynamic='force-dynamic';
const json=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{
  'Cache-Control':'no-store',
}});
export async function POST(request:NextRequest){
  if(process.env.MW1_STAGING_MODE!=='true')
    return json({ok:false,error:'Las solicitudes se habilitarán después de las pruebas.'},403);
  if(request.headers.get('origin')!==new URL(request.url).origin)
    return json({ok:false,error:'Solicitud no autorizada.'},403);
  const key=process.env.CHATPRO_INBOX_KEY?.trim();
  const api=process.env.CHATPRO_API_URL?.trim().replace(/\/$/,'');
  if(!key||!api)return json({ok:false,error:'El registro temporalmente no está disponible.'},503);
  const length=Number(request.headers.get('content-length')||0);
  if(length>3000)return json({ok:false,error:'Solicitud demasiado extensa.'},413);
  const body=await request.json().catch(()=>null);
  if(!body||typeof body!=='object'||Array.isArray(body))
    return json({ok:false,error:'Solicitud inválida.'},400);
  const requestData=body as Record<string,unknown>;
  // Quietly discard spam submissions filled by robots.
  if(requestData.website) return json({ok:true,message:'Solicitud recibida.'});
  const ip=(request.headers.get('x-forwarded-for')||'').split(',')[0].trim()
    .slice(0,80)||'without-ip';
  const digest=createHmac('sha256',key).update(ip).digest('hex');
  const payload={
    companyName:requestData.companyName,
    contactName:requestData.contactName,
    contactEmail:requestData.contactEmail,
    planInterest:requestData.planInterest,
    consent:requestData.consent,
    visitorDigest:digest,
  };
  try{
    const controller=new URL('/marketing/demo-requests',api);
    const response=await fetch(controller,{
      method:'POST',
      headers:{'content-type':'application/json','x-chatpro-inbox-key':key},
      body:JSON.stringify(payload),cache:'no-store',signal:AbortSignal.timeout(12000),
    });
    if(!response.ok)return json({ok:false,error:
      response.status===400?'Verifica los datos de la solicitud.':'No fue posible registrar la solicitud.'},
      response.status===400?400:503);
    return json({ok:true,message:'Solicitud registrada. Un asesor podrá contactarte.'});
  }catch{
    return json({ok:false,error:'El registro temporalmente no está disponible.'},503);
  }
}
