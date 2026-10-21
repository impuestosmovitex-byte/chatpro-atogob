import { NextRequest } from 'next/server';
import { proxyNativeCommerce } from '../../../lib/native-commerce-proxy';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  return proxyNativeCommerce(request, 'products');
}
