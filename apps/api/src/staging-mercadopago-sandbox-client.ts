import {validatedMercadoPagoCheckoutUrl} from './staging-mercadopago-checkout';
import {buildMerchantOrderDraft, type MerchantOrderInput} from './staging-mercadopago-order-draft';

/** Server-only adapter. Never call with browser credentials or enable in production
 * without a tenant-scoped merchant connection and verified webhook reconciliation.
 */
export async function createMercadoPagoSandboxOrder(
  input:MerchantOrderInput,
  merchantAccessToken:string,
  options:{merchantConnectionVerified:boolean;sandboxOnly:boolean},
):Promise<{providerOrderId:string;checkoutUrl:string}>{
  if(!options.merchantConnectionVerified||!options.sandboxOnly||
     process.env.MW1_STAGING_MODE!=='true'||
     process.env.MW1_MP_SANDBOX_ORDERS_ENABLED!=='true') {
    throw new Error('Checkout de pruebas no habilitado.');
  }
  if(typeof merchantAccessToken!=='string'||!/^TEST-[A-Za-z0-9_-]{20,}$/.test(merchantAccessToken)) {
    throw new Error('Credencial de pruebas inválida.');
  }
  const {idempotencyKey,body}=buildMerchantOrderDraft(input);
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),8000);
  try{
    const response=await fetch('https://api.mercadopago.com/v1/orders',{
      method:'POST',
      signal:controller.signal,
      headers:{
        'Authorization':`Bearer ${merchantAccessToken}`,
        'X-Idempotency-Key':idempotencyKey,
        'Content-Type':'application/json',
        'Accept':'application/json',
      },
      body:JSON.stringify(body),
      redirect:'error',
    });
    if(response.status!==201)throw new Error('Mercado Pago no confirmó la creación de la orden.');
    const data=await response.json() as Record<string,unknown>;
    const checkoutUrl=validatedMercadoPagoCheckoutUrl(data.checkout_url,true);
    if(typeof data.id!=='string'||data.id.length<8||data.id.length>120||
       data.external_reference!==body.external_reference||
       data.currency!==input.currency||
       Number(data.total_amount)!==input.amountMinor/100||!checkoutUrl){
      throw new Error('Respuesta de Mercado Pago no coincide con el intento.');
    }
    return {providerOrderId:data.id,checkoutUrl};
  }finally{
    clearTimeout(timeout);
  }
}
