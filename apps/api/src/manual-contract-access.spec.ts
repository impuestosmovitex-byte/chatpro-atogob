import {ForbiddenException,ServiceUnavailableException} from '@nestjs/common';
import {ManualContractAccessService,evaluateManualContractWindow} from './manual-contract-access.service';

const now=new Date('2026-12-16T05:05:00Z');
const active={status:'active',starts_at:'2026-11-16T05:05:00Z',expires_at:'2026-12-16T05:05:00Z'};
const previous=process.env.MW1_STAGING_MODE;

describe('MW1 staging manual contract expiration',()=>{
 afterEach(()=>{if(previous===undefined)delete process.env.MW1_STAGING_MODE;else process.env.MW1_STAGING_MODE=previous;});
 it('keeps legacy operational companies without a manual contract unaltered',()=>{
  expect(evaluateManualContractWindow(null,now)).toMatchObject({state:'legacy',commercialAllowed:true});
 });
 it('enforces the exact expiration boundary and before-start denial',()=>{
  expect(evaluateManualContractWindow(active,new Date(now.getTime()-1))).toMatchObject({state:'active',commercialAllowed:true});
  expect(evaluateManualContractWindow(active,now)).toMatchObject({state:'expired',commercialAllowed:false});
  expect(evaluateManualContractWindow(active,new Date('2026-11-16T05:04:59Z')).state).toBe('not_started');
 });
 it('fails closed for non-active, invalid, malformed manual contracts',()=>{
  expect(evaluateManualContractWindow({...active,status:'suspended'},now).state).toBe('suspended');
  expect(evaluateManualContractWindow({...active,expires_at:'not-a-date'},now).commercialAllowed).toBe(false);
  expect(evaluateManualContractWindow({...active,expires_at:active.starts_at},now).commercialAllowed).toBe(false);
 });
 it('checks a fresh database row for each request even with an existing session',async()=>{
  process.env.MW1_STAGING_MODE='true';
  let row:{status:string;starts_at:string;expires_at:string}|null={...active,expires_at:'2027-02-16T05:05:00Z'};
  const maybeSingle=jest.fn(async()=>({data:row,error:null}));
  const db={from:jest.fn(()=>({select:()=>({eq:()=>({maybeSingle})})}))};
  const service=new ManualContractAccessService({getClient:()=>db} as any);
  await expect(service.assertCommercial('company-test')).resolves.toBeUndefined();
  row={...active,expires_at:'2020-01-01T00:00:00Z'};
  await expect(service.assertCommercial('company-test')).rejects.toBeInstanceOf(ForbiddenException);
  expect(maybeSingle).toHaveBeenCalledTimes(2);
 });
 it('lets owners/admins authenticate to request renewal but blocks advisors',async()=>{
  process.env.MW1_STAGING_MODE='true';
  const service=new ManualContractAccessService({
   getClient:()=>({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({
    data:{...active,expires_at:'2020-01-01T00:00:00Z'},error:null,
   })})})})}),
  } as any);
  await expect(service.assertLogin('company-test','owner')).resolves.toBeUndefined();
  await expect(service.assertLogin('company-test','admin')).resolves.toBeUndefined();
  await expect(service.assertLogin('company-test','advisor')).rejects.toBeInstanceOf(ForbiddenException);
  await expect(service.assertCommercial('company-test')).rejects.toBeInstanceOf(ForbiddenException);
 });
 it('fails closed when the manual-contract lookup is unavailable in staging',async()=>{
  process.env.MW1_STAGING_MODE='true';
  const service=new ManualContractAccessService({
   getClient:()=>({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({
    data:null,error:{message:'DB unavailable'},
   })})})})}),
  } as any);
  await expect(service.assertCommercial('company-test')).rejects.toBeInstanceOf(ServiceUnavailableException);
 });
 it('does not change existing production paths when disabled',async()=>{
  process.env.MW1_STAGING_MODE='false';
  const service=new ManualContractAccessService({getClient:()=>{throw new Error('must not touch DB');}} as any);
  await expect(service.assertCommercial('legacy-company')).resolves.toBeUndefined();
 });
});
