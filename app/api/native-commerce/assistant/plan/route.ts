import { NextRequest, NextResponse } from 'next/server';
import { proxyNativeCommerce } from '../../../../lib/native-commerce-proxy';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (process.env.MW1_STAGING_MODE !== 'true') {
    return NextResponse.json({ok:false,error:'Simulador habilitado solo en MW1 de pruebas.'},{status:403});
  }
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 6000) {
    return NextResponse.json({ok:false,error:'Solicitud demasiado larga.'},{status:413});
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ok:false,error:'Mensaje inválido.'},{status:400});
  }
  return proxyNativeCommerce(request,'assistant/plan','POST',body);
}
