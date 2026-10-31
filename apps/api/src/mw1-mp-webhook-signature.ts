import {createHmac,timingSafeEqual} from 'node:crypto';

/** Verify Mercado Pago's signature using only the signed URL data.id. No side effects. */
export function verifyMW1WebhookSignature(input:{signature:string;requestId:string;dataId:string;secret:string;nowMs?:number}):boolean{
 const entries=Object.fromEntries(input.signature.split(',').map(x=>x.trim().split('=',2)));
 const ts=entries.ts??'',v1=entries.v1??'';
 if(!/^\d{10,13}$/.test(ts)||! /^[a-f0-9]{64}$/i.test(v1)||
    !input.requestId||!input.dataId||!input.secret)return false;
 const time=ts.length===10?Number(ts)*1000:Number(ts);
 if(!Number.isFinite(time)||Math.abs((input.nowMs??Date.now())-time)>300000)return false;
 const manifest=`id:${input.dataId.toLowerCase()};request-id:${input.requestId};ts:${ts};`;
 const digest=createHmac('sha256',input.secret).update(manifest).digest();
 const supplied=Buffer.from(v1,'hex');
 return supplied.length===digest.length&&timingSafeEqual(supplied,digest);
}
