import {ForbiddenException} from '@nestjs/common';
import {AccessController} from './access.controller';
import {ManualContractAccessService} from './manual-contract-access.service';

describe('MW1 staging renewal lifecycle (isolated DB responses; zero real mutations)',()=>{
 const companyId='49c3a6a2-33f5-49f5-a887-10eed0703768';
 const starts='2026-11-16T05:05:00Z';
 const initialExpiry='2027-02-16T05:05:00Z';
 const renewedExpiry='2027-03-16T05:05:00Z';
 const previousMode=process.env.MW1_STAGING_MODE;
 afterEach(()=>{
  jest.useRealTimers();
  if(previousMode===undefined)delete process.env.MW1_STAGING_MODE;
  else process.env.MW1_STAGING_MODE=previousMode;
 });
 function makeFixture(){
  process.env.MW1_STAGING_MODE='true';
  let record:{status:string;starts_at:string;expires_at:string}|null={
   status:'active',starts_at:starts,expires_at:initialExpiry,
  };
  // No writes or inserts are exposed by this mock.
  const maybeSingle=jest.fn(async()=>({data:record?{...record}:null,error:null}));
  const getClient=()=>({from:(table:string)=>{
   if(table==='mw1_manual_company_contracts')
    return {select:()=>({eq:()=>({maybeSingle})})};
   if(table==='company_memberships')
    return {select:()=>({eq:()=>({eq:()=>Promise.resolve({count:0,error:null})})})};
   throw Error('Unexpected table: '+table);
  }});
  const service=new ManualContractAccessService({getClient} as any);
  return {service,maybeSingle,getClient,setRecord:(r:typeof record)=>{record=r;}};
 }
 it('active -> expired -> renewed restores operations without overwriting tenant records',async()=>{
  const fixture=makeFixture();
  const tenant={plan:'eco',users:5,customers:214,conversations:380};
  const baseline=JSON.stringify(tenant);
  jest.useFakeTimers().setSystemTime(new Date('2027-02-16T05:04:59Z'));
  await expect(fixture.service.assertCommercial(companyId)).resolves.toBeUndefined();
  await expect(fixture.service.assertLogin(companyId,'advisor')).resolves.toBeUndefined();
  jest.setSystemTime(new Date(initialExpiry));
  await expect(fixture.service.assertCommercial(companyId)).rejects.toMatchObject({
   response:{code:'MW1_MANUAL_CONTRACT_INACTIVE',state:'expired'},
  });
  await expect(fixture.service.assertLogin(companyId,'advisor')).rejects.toBeInstanceOf(ForbiddenException);
  await expect(fixture.service.assertLogin(companyId,'owner')).resolves.toBeUndefined();
  await expect(fixture.service.assertLogin(companyId,'admin')).resolves.toBeUndefined();
  // An approved renewal is represented by an updated DB row; no real RPC or payment.
  fixture.setRecord({status:'active',starts_at:starts,expires_at:renewedExpiry});
  await expect(fixture.service.assertCommercial(companyId)).resolves.toBeUndefined();
  await expect(fixture.service.assertLogin(companyId,'advisor')).resolves.toBeUndefined();
  expect(JSON.stringify(tenant)).toBe(baseline);
  expect(fixture.maybeSingle).toHaveBeenCalledTimes(8);
 });
 it('expired owner can bootstrap renewal page but commercial endpoints remain denied',async()=>{
  const fixture=makeFixture();
  jest.useFakeTimers().setSystemTime(new Date(initialExpiry));
  const controller=new AccessController({getClient:fixture.getClient} as any,{} as any,fixture.service);
  jest.spyOn(controller as any,'assertInternalKey').mockImplementation(()=>undefined);
  jest.spyOn(controller as any,'getCompany').mockResolvedValue({
   id:companyId,name:'MW1 Prueba Contratación',slug:'mw1-prueba-contratacion',
  });
  const bootstrap=await controller.bootstrapStatus('staging-test-key','mw1-prueba-contratacion');
  expect(bootstrap).toMatchObject({
   ok:true,setupRequired:true,
   subscription:{state:'expired',commercialAllowed:false},
  });
  await expect(fixture.service.assertCommercial(companyId)).rejects.toBeInstanceOf(ForbiddenException);
 });
 it('legacy tenants remain permitted without any manual contract record',async()=>{
  const f=makeFixture();
  f.setRecord(null);
  jest.useFakeTimers().setSystemTime(new Date(initialExpiry));
  await expect(f.service.assertCommercial('existing-operational-tenant')).resolves.toBeUndefined();
  await expect(f.service.assertLogin('existing-operational-tenant','advisor')).resolves.toBeUndefined();
 });
});
