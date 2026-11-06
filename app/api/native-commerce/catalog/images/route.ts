import { NextRequest, NextResponse } from 'next/server';
import { proxyNativeCommerce } from '../../../../lib/native-commerce-proxy';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest) {
  if(process.env.MW1_STAGING_MODE!=='true')return NextResponse.json({ok:false},{status:403});
  return proxyNativeCommerce(req,'catalog/images');
}
export async function POST(req:NextRequest) {
  if(process.env.MW1_STAGING_MODE!=='true')return NextResponse.json({ok:false},{status:403});
  if(Number(req.headers.get('content-length')||0)>760000)return NextResponse.json({ok:false,error:'Archivo demasiado grande.'},{status:413});
  const body=await req.json().catch(()=>null);
  if(!body||typeof body!=='object'||Array.isArray(body))return NextResponse.json({ok:false,error:'Imagen inválida.'},{status:400});
  return proxyNativeCommerce(req,'catalog/images','POST',body);
}
