import {createHmac, timingSafeEqual} from 'node:crypto';

/** Mercado Pago v1 webhook signature validator. Use raw header values,
 * validate the event's provider resource ID with a server-side API GET later.
 * A valid signature alone NEVER marks an order paid.
 */
export function verifyMercadoPagoWebhookSignature(input:{
 signatureHeader:unknown;requestId:unknown;dataId:unknown;
 secret:string;nowMs?:number;maxAgeMs?:number;
}):boolean{
 const {signatureHeader,requestId,dataId,secret}=input;
 if(typeof signatureHeader!=='string'||signatureHeader.length>512||
    typeof requestId!=='string'||requestId.length<1||requestId.length>200||
    typeof dataId!=='string'||!/^[0-9]{1,40}$/.test(dataId)||
    typeof secret!=='string'||secret.length<24)return false;
 const parts=signatureHeader.split(',');
 const values:Record<string,string>={};
 for(const item of parts){
   const trimmed=item.trim();const index=trimmed.indexOf('=');
   if(index<1)return false;
   const name=trimmed.slice(0,index),value=trimmed.slice(index+1);
   if(!['ts','v1'].includes(name)||values[name]||!value)return false;
   values[name]=value;
 }
 if(parts.length!==2||!/^\d{10,16}$/.test(values.ts||'')||
    !/^[0-9a-f]{64}$/i.test(values.v1||''))return false;
 const ms=Number(values.ts)*1000;
 const now=input.nowMs??Date.now(),maxAge=input.maxAgeMs??300000;
 if(!Number.isSafeInteger(ms)||Math.abs(now-ms)>maxAge||maxAge>900000)return false;
 const manifest=`id:${dataId.toLowerCase()};request-id:${requestId};ts:${values.ts};`;
 const expected=createHmac('sha256',secret).update(manifest).digest();
 const provided=Buffer.from(values.v1,'hex');
 return provided.length===expected.length&&timingSafeEqual(provided,expected);
}
