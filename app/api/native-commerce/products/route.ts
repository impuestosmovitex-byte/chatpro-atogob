import { NextRequest } from 'next/server';
import { proxyNativeCommerce } from '../../../lib/native-commerce-proxy';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  return proxyNativeCommerce(request, 'products');
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    const { NextResponse } = await import('next/server');
    return NextResponse.json({ ok: false, error: 'Producto no válido.' }, { status: 400 });
  }
  return proxyNativeCommerce(request, 'products', 'POST', body);
}
