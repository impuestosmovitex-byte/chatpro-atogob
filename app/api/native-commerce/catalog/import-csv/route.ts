import { NextRequest, NextResponse } from 'next/server';
import { proxyNativeCommerce } from '../../../../lib/native-commerce-proxy';

export const dynamic='force-dynamic';

export async function POST(request:NextRequest) {
  const contentLength=Number(request.headers.get('content-length')||0);
  if(contentLength>150000) {
    return NextResponse.json({ok:false,error:'El lote es demasiado grande. Importa hasta 100 productos.'},{status:413});
  }
  const body=await request.json().catch(()=>null);
  if(!body||typeof body!=='object'||Array.isArray(body)) {
    return NextResponse.json({ok:false,error:'El archivo no tiene datos válidos.'},{status:400});
  }
  return proxyNativeCommerce(request,'catalog/import-csv','POST',body);
}
