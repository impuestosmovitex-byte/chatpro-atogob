/** Staging-only payload builder. Does not make HTTP requests or create subscriptions.
 * Ref: Mercado Pago POST /preapproval with status=pending (no free trial).
 * It must only be invoked after environment verification and explicit payment enablement.
 */
export type MW1PreapprovalInput={
  intentId:string; payerEmail:string; monthlyAmountCop:number;
  planName:string; backUrl:string;
};
export function buildMW1PreapprovalPayload(input:MW1PreapprovalInput){
 const email=input.payerEmail.trim();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Correo del comprador inválido.');
 if(!Number.isSafeInteger(input.monthlyAmountCop)||input.monthlyAmountCop<=0)throw new Error('Precio inválido.');
 if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(input.intentId))throw new Error('Identificador inválido.');
 const url=new URL(input.backUrl);
 if(url.protocol!=='https:'||url.username||url.password)throw new Error('URL de retorno inválida.');
 return {
   reason:'MW1 CRM - '+input.planName.slice(0,45),
   external_reference:'mw1:'+input.intentId,
   payer_email:email,
   auto_recurring:{frequency:1,frequency_type:'months',transaction_amount:input.monthlyAmountCop,currency_id:'COP'},
   back_url:url.toString(),
   status:'pending',
 };
}

/** Validate provider response before storing ids or showing authorization links.
 * Never treat an init_point or a browser return as payment confirmation.
 */
export function parseMW1PreapprovalResponse(value:unknown){
 if(!value||typeof value!=='object')throw new Error('Respuesta de Mercado Pago inválida.');
 const data=value as Record<string,unknown>;
 const id=typeof data.id==='string'?data.id.trim():'';
 if(!/^[a-zA-Z0-9_-]{8,120}$/.test(id))throw new Error('Suscripción sin identificador válido.');
 const raw=typeof data.init_point==='string'?data.init_point:'';
 if(!raw)throw new Error('Mercado Pago no devolvió enlace de autorización.');
 let url:URL;
 try{url=new URL(raw)}catch{throw new Error('Enlace de autorización inválido.');}
 const host=url.hostname.toLowerCase();
 if(url.protocol!=='https:'||url.username||url.password||
   !(host==='mercadopago.com'||host.endsWith('.mercadopago.com')||
     host==='mercadopago.com.co'||host.endsWith('.mercadopago.com.co')||
     host==='mercadolibre.com'||host.endsWith('.mercadolibre.com')))
   throw new Error('El enlace no pertenece a Mercado Pago.');
 return {providerSubscriptionId:id,authorizationUrl:url.toString(),paymentVerified:false};
}
