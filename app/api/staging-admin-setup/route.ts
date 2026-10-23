import {NextRequest,NextResponse} from 'next/server';
export const dynamic='force-dynamic';
const json=(data:unknown,status:number)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request:NextRequest){
 if(process.env.MW1_STAGING_MODE!=='true')
  return json({ok:false,error:'Disponible únicamente en MW1 staging.'},403);
 // Reverse proxies may expose an internal request URL different from the
 // public browser origin. Allow only the explicitly approved staging domain.
 const stagingOrigin='https://mw1-web-staging-staging.up.railway.app';
 if(request.headers.get('origin')!==stagingOrigin ||
    (request.headers.get('sec-fetch-site') && request.headers.get('sec-fetch-site')!=='same-origin'))
  return json({ok:false,error:'Solicitud no autorizada.'},403);
 if(Number(request.headers.get('content-length')||0)>1024)
  return json({ok:false,error:'Solicitud inválida.'},413);
 const data=await request.json().catch(()=>null);
 if(!data||typeof data!=='object'||Array.isArray(data))
  return json({ok:false,error:'Solicitud inválida.'},400);
 const body=data as Record<string,unknown>;
 if(typeof body.token!=='string'||!/^[0-9a-f]{64}$/.test(body.token)||
  typeof body.password!=='string'||body.password.length<14||body.password.length>128)
  return json({ok:false,error:'Enlace o contraseña inválida.'},400);
 const key=process.env.CHATPRO_INBOX_KEY?.trim(),base=process.env.CHATPRO_API_URL?.trim();
 if(!key||!base)return json({ok:false,error:'Servicio no configurado.'},503);
 try{
  const response=await fetch(new URL('/platform-admin/staging-admin-activate',base),{
   method:'POST',headers:{'x-chatpro-inbox-key':key,'content-type':'application/json'},
   body:JSON.stringify({token:body.token,password:body.password}),
   cache:'no-store',signal:AbortSignal.timeout(15000),
  });
  const result=await response.json().catch(()=>({ok:false,error:'Error activando el usuario.'}));
  return json(result,response.status);
 }catch{return json({ok:false,error:'No fue posible activar el usuario.'},503);}
}
