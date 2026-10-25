import {Controller,Headers,Post,Query,ServiceUnavailableException,UnauthorizedException,Body} from '@nestjs/common';
import {createHmac,timingSafeEqual} from 'node:crypto';

/**
 * Staging-only receiver. Validates provider signature and explicitly does NOT
 * activate subscriptions, write financial records or execute charges.
 */
@Controller('staging-mercadopago')
export class StagingMercadoPagoWebhookController {
 @Post('webhook')
 receive(
  @Headers('x-signature') signature='',
  @Headers('x-request-id') requestId='',
  @Query('data.id') queryDataId='',
  @Body() body:unknown,
 ){
  if(process.env.MW1_STAGING_MODE!=='true')throw new UnauthorizedException();
  const secret=process.env.MW1_MP_WEBHOOK_SECRET?.trim();
  if(!secret)throw new ServiceUnavailableException('Webhook de pruebas no configurado.');
  const entries=Object.fromEntries(signature.split(',').map(p=>p.trim().split('=',2)));
  const ts=entries.ts||'',v1=entries.v1||'';
  if(!/^\d{10,13}$/.test(ts)||! /^[a-f0-9]{64}$/i.test(v1)||!requestId||!queryDataId)
    throw new UnauthorizedException('Firma incompleta.');
  const timestampMs=ts.length===10?Number(ts)*1000:Number(ts);
  if(!Number.isFinite(timestampMs)||Math.abs(Date.now()-timestampMs)>5*60*1000)
    throw new UnauthorizedException('Firma vencida.');
  // Mercado Pago webhook signature manifest. Use the URL data.id, not the untrusted body id.
  const id=String(queryDataId).toLowerCase();
  const manifest=`id:${id};request-id:${requestId};ts:${ts};`;
  const digest=createHmac('sha256',secret).update(manifest).digest();
  const supplied=Buffer.from(v1,'hex');
  if(supplied.length!==digest.length||!timingSafeEqual(supplied,digest))
    throw new UnauthorizedException('Firma inválida.');
  const type=(body&&typeof body==='object'&&'type' in body)?String((body as {type:unknown}).type):'';
  if(!['subscription_preapproval','subscription_authorized_payment','payment'].includes(type))
    return {ok:true,ignored:true};
  // Deliberately no database mutation until provider GET reconciliation and
  // duplicate-payment idempotency have been implemented and verified.
  return {ok:true,received:true,processed:false};
 }
}
