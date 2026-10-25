import {createHmac} from 'node:crypto';
import {verifyMW1WebhookSignature} from './mw1-mp-webhook-signature';

describe('Mercado Pago webhook signature',()=>{
 const secret='test-secret-not-a-production-key',requestId='request-123',dataId='123456';
 const timestamp=1792962000,nowMs=timestamp*1000;
 const sign=(id:string,ts:string,rid=requestId)=>createHmac('sha256',secret)
  .update(`id:${id.toLowerCase()};request-id:${rid};ts:${ts};`).digest('hex');
 test('accepts a correctly signed webhook',()=>{
  expect(verifyMW1WebhookSignature({signature:`ts=${timestamp},v1=${sign(dataId,String(timestamp))}`,
   requestId,dataId,secret,nowMs})).toBe(true);
 });
 test('rejects tampered id, changed request id, expired and missing signature',()=>{
  const signature=`ts=${timestamp},v1=${sign(dataId,String(timestamp))}`;
  expect(verifyMW1WebhookSignature({signature,requestId,dataId:'123457',secret,nowMs})).toBe(false);
  expect(verifyMW1WebhookSignature({signature,requestId:'other',dataId,secret,nowMs})).toBe(false);
  expect(verifyMW1WebhookSignature({signature,requestId,dataId,secret,nowMs:nowMs+300001})).toBe(false);
  expect(verifyMW1WebhookSignature({signature:'',requestId,dataId,secret,nowMs})).toBe(false);
 });
 test('normalizes case only for the data id',()=>{
  const id='ABCdef';const signature=`ts=${timestamp},v1=${sign(id,String(timestamp))}`;
  expect(verifyMW1WebhookSignature({signature,requestId,dataId:id,secret,nowMs})).toBe(true);
 });
});
