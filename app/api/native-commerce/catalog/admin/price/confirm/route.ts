import {NextRequest,NextResponse} from 'next/server';
import {proxyNativeCommerce} from '../../../../../lib/native-commerce-proxy';

export const dynamic='force-dynamic';
export async function POST(request:NextRequest){
  if(process.env.MW1_STAGING_MODE!=='true')
    return NextResponse.json({ok:false,error:'Disponible solo en la demo de MW1.'},{status:403});
  if(Number(request.headers.get('content-length')||0)>4000)
    return NextResponse.json({ok:false,error:'Solicitud demasiado larga.'},{status:413});
  const body=await request.json().catch(()=>null);
  if(!body||typeof body!=='object'||Array.isArray(body))
    return NextResponse.json({ok:false,error:'Solicitud inválida.'},{status:400});
  return proxyNativeCommerce(request,'catalog/admin/price/confirm','POST',body);
}
