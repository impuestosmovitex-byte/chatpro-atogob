import { NextRequest, NextResponse } from 'next/server';
import { proxyNativeCommerce } from '../../../../../lib/native-commerce-proxy';

export const dynamic='force-dynamic';
export async function GET(request:NextRequest,context:{params:Promise<{orderId:string}>}){
  const {orderId}=await context.params;
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)){
    return NextResponse.json({ok:false,error:'Pedido no válido.'},{status:400});
  }
  return proxyNativeCommerce(request,`orders/${orderId}/payment-attempts`);
}
