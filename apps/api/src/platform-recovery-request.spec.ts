import {PlatformAdminController} from './platform-admin.controller';
import {SupabaseService} from './supabase.service';
import {AccessAuthService} from './access-auth.service';

describe('MW1 lost password: unverified email/phone only requests assisted recovery',()=>{
 const oldKey=process.env.CHATPRO_INBOX_KEY,oldStaging=process.env.MW1_STAGING_MODE;
 const key='test-internal-key',ownerId='00e6861f-4939-4cec-ac82-4b1e2c99ed25';
 let writes:Array<{table:string;row:Record<string,unknown>}>=[];
 let count=0;
 let companyExists=true;
 let profileExists=true;
 const client={
  from:(table:string)=>({
   select:(_s:string,_options?:unknown)=>{
    const chain={
     eq:(_k:string,_v:unknown)=>chain,
     gte:async()=>({count,error:null}),
     maybeSingle:async()=>({
      data:table==='companies'?(companyExists?{id:'company-id'}:null)
       :table==='app_profiles'?(profileExists?{user_id:ownerId,active:true}:null)
       :table==='company_memberships'?{active:true}:null,
      error:null,
     }),
    };
    return chain;
   },
   insert:async(row:Record<string,unknown>)=>{
    writes.push({table,row});return {error:null};
   },
  })
 };
 const controller=new PlatformAdminController({getClient:()=>client} as unknown as SupabaseService,new AccessAuthService());
 const payload={companySlug:'piloto-mw1-prueba',identifier:'PILOTOMW1001',
  method:'email',contact:'owner@example.com',visitorDigest:'a'.repeat(64)};
 beforeEach(()=>{
  process.env.CHATPRO_INBOX_KEY=key;process.env.MW1_STAGING_MODE='true';
  writes=[];count=0;companyExists=true;profileExists=true;
 });
 afterAll(()=>{
  if(oldKey===undefined)delete process.env.CHATPRO_INBOX_KEY;else process.env.CHATPRO_INBOX_KEY=oldKey;
  if(oldStaging===undefined)delete process.env.MW1_STAGING_MODE;
  else process.env.MW1_STAGING_MODE=oldStaging;
 });
 it('stores contact request without issuing password changes or activating a user',async()=>{
  const result=await controller.requestAccountRecovery(key,payload);
  expect(result.ok).toBe(true);
  expect(writes).toEqual([{table:'platform_access_recovery_requests',row:
   expect.objectContaining({login_identifier:'PILOTOMW1001',contact_method:'email',
    contact_value:'owner@example.com',company_slug:'piloto-mw1-prueba'})}]);
  expect(JSON.stringify(writes)).not.toContain('password_hash');
 });
 it('does not disclose whether the company or user exists',async()=>{
  companyExists=false;
  const hidden=await controller.requestAccountRecovery(key,payload);
  companyExists=true;profileExists=false;
  const missing=await controller.requestAccountRecovery(key,payload);
  expect(hidden).toEqual(missing);
  expect(writes).toEqual([]);
 });
 it('throttles repeated requests with no write',async()=>{
  count=3;
  const result=await controller.requestAccountRecovery(key,payload);
  expect(result.ok).toBe(true);expect(writes).toHaveLength(0);
 });
 it('requires internal key and staging, cannot mutate production accounts',async()=>{
  await expect(controller.requestAccountRecovery('bad',payload)).rejects.toThrow();
  process.env.MW1_STAGING_MODE='false';
  await expect(controller.requestAccountRecovery(key,payload)).rejects.toThrow(/staging/);
  expect(writes).toEqual([]);
 });
 it('validates email and mobile input, without ever trusting phone for ownership',async()=>{
  await expect(controller.requestAccountRecovery(key,{...payload,method:'phone',contact:'not-a-number'}))
    .rejects.toThrow(/datos de recuperación/);
  await expect(controller.requestAccountRecovery(key,{...payload,method:'email',contact:'bad-email'}))
    .rejects.toThrow(/datos de recuperación/);
  const response=await controller.requestAccountRecovery(key,{...payload,method:'phone',contact:'+573001234567'});
  expect(response.ok).toBe(true);
  expect(writes[0].row.contact_method).toBe('phone');
 });
});
