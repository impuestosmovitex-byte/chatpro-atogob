import { NextRequest, NextResponse } from 'next/server';
import { proxyNativeCommerce } from '../../../lib/native-commerce-proxy';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  return proxyNativeCommerce(request, 'orders');
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ok:false,error:'Datos de pedido no válidos.'},{status:400});
  }
  return proxyNativeCommerce(request,'orders','POST',body);
}
