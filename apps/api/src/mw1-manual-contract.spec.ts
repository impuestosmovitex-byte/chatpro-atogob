import {validateManualContract} from './mw1-manual-contract';
const now=new Date('2026-11-14T18:00:00Z');
const base={
 companyId:'11111111-1111-4111-8111-111111111111',tier:'eco',paymentReference:'MW1-TEST-0001',
 amountCop:259000,verifiedAt:'2026-11-14T17:00:00Z',
 startsAt:'2026-11-14T18:00:00Z',expiresAt:'2026-12-14T18:00:00Z',
 additionalUsers:0,reason:'Pago revisado en ambiente ficticio',
 confirmation:'CONFIRMO PAGO VERIFICADO Y ACTIVACION',
};
describe('manual MW1 contract safeguards',()=>{
 it('validates a test contract',()=>expect(validateManualContract(base,now).tier).toBe('eco'));
 it.each([
  {amountCop:0},{additionalUsers:-1},{confirmation:'SI'},
  {expiresAt:'2026-11-01T18:00:00Z'},
  {verifiedAt:'2026-12-01T18:00:00Z'},
  {paymentReference:'bad'},{secret:'invalid'},
 ])('rejects invalid input %p',(patch)=>expect(()=>validateManualContract({...base,...patch},now)).toThrow());
});
