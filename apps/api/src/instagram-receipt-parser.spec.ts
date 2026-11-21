import { parseInstagramReceipts, receiptWatermarkIso } from './instagram-receipt-parser';

describe('Instagram receipt parser', () => {
 const account='ig-business',customer='ig-customer';
 it('extracts exact read mid (does not invent delivery)',()=>{
  const r=parseInstagramReceipts({entry:[{id:account,messaging:[{sender:{id:customer},recipient:{id:account},read:{mid:'mid-1'}}]}]});
  expect(r).toEqual([{accountId:account,customerId:customer,kind:'read',mids:['mid-1'],watermark:null}]);
 });
 it('extracts delivery mids',()=>{
  const r=parseInstagramReceipts({entry:[{id:account,messaging:[{sender:{id:customer},recipient:{id:account},delivery:{mids:['m1','m2','m1']}}]}]});
  expect(r).toHaveLength(1);expect(r[0].mids).toEqual(['m1','m2']);expect(r[0].kind).toBe('delivered');
 });
 it('handles read event under Instagram changes field',()=>{
  const r=parseInstagramReceipts({entry:[{id:account,changes:[{field:'messaging_seen',value:{sender:{id:customer},recipient:{id:account},mid:'mid-2'}}]}]});
  expect(r[0].kind).toBe('read');expect(r[0].mids).toEqual(['mid-2']);
 });
 it('ignores inbound message, echo, and arbitrary customer responses',()=>{
  expect(parseInstagramReceipts({entry:[{id:account,messaging:[{sender:{id:customer},recipient:{id:account},message:{mid:'abc',text:'Gracias'}}]}]}])).toEqual([]);
  expect(parseInstagramReceipts({entry:[{id:account,messaging:[{sender:{id:account},recipient:{id:customer},read:{mid:'abc'}}]}]}])).toEqual([]);
  expect(parseInstagramReceipts({entry:[{id:account,messaging:[{sender:{id:customer},recipient:{id:'other-business'},read:{mid:'abc'}}]}]}])).toEqual([]);
 });
 it('parses 10 and 13 digit timestamps but rejects bad/future values',()=>{
  expect(receiptWatermarkIso(1763730000)).toBe('2025-11-21T10:20:00.000Z');
  expect(receiptWatermarkIso(1763730000000)).toBe('2025-11-21T10:20:00.000Z');
  expect(receiptWatermarkIso('oops')).toBeNull();
  expect(receiptWatermarkIso(Date.now()+86_400_000)).toBeNull();
 });
});
