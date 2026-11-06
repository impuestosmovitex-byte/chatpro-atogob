import { NextRequest, NextResponse } from 'next/server';
import { proxyNativeCommerce } from '../../../../../lib/native-commerce-proxy';

export const dynamic='force-dynamic';

export async function PATCH(request:NextRequest,ctx:{params:Promise<{productId:string}>}) {
  if(process.env.MW1_STAGING_MODE!=='true'){
    return NextResponse.json({ok:false,error:'Disponible solo en MW1 de pruebas.'},{status:403});
  }
  const {productId}=await ctx.params;
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productId)){
    return NextResponse.json({ok:false,error:'Producto inválido.'},{status:400});
  }
  const contentLength=Number(request.headers.get('content-length')||0);
  if(contentLength>12000){
    return NextResponse.json({ok:false,error:'Ficha demasiado larga.'},{status:413});
  }
  const body=await request.json().catch(()=>null);
  if(!body||typeof body!=='object'||Array.isArray(body)){
    return NextResponse.json({ok:false,error:'Ficha inválida.'},{status:400});
  }
  return proxyNativeCommerce(request,'products/'+productId+'/facts','PATCH',body);
}
