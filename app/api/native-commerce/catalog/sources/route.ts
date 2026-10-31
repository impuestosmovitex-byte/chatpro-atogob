import {NextRequest,NextResponse} from 'next/server';
import {proxyNativeCommerce} from '../../../../lib/native-commerce-proxy';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){
  if(process.env.MW1_STAGING_MODE!=='true')
    return NextResponse.json({ok:false,error:'Solo para MW1 de pruebas.'},{status:403});
  return proxyNativeCommerce(request,'catalog/sources');
}
