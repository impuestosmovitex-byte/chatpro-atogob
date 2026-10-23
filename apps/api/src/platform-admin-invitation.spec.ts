import {PlatformAdminController} from './platform-admin.controller';
import {AccessAuthService} from './access-auth.service';
import {SupabaseService} from './supabase.service';

describe('staging first-superadmin invitation security',()=>{
 const prevKey=process.env.CHATPRO_INBOX_KEY,prevStaging=process.env.MW1_STAGING_MODE;
 const key='only-staging-internal-key';
 let controller:PlatformAdminController;
 let used=false,hasAdmin=false,created=0,writes:string[]=[];
 const rawToken='a'.repeat(64);
 const makeClient=()=>({
  from:(table:string)=>({
   select:(_cols:string,_opts?:unknown)=>({
    eq:(_field:string,_value:unknown)=>{
     if(table==='platform_admins')return Promise.resolve({count:hasAdmin?1:0,error:null});
     return {
      eq:(_f:string,_v:unknown)=>({maybeSingle:async()=>({data:{id:'0e160710-6dc4-48ea-88e7-954f463388d8',slug:'mw1-demo-mercado'},error:null})}),
      is:(_f:string,_v:unknown)=>({maybeSingle:async()=>({data:{id:'ee23ecf1-6c44-494b-a23d-03f096f019fb'},error:null})}),
      maybeSingle:async()=>({data:null,error:null}),
     };
    },
   }),
   update:(_row:unknown)=>({eq:(_f:string,_v:unknown)=>({is:(_f2:string,_v2:unknown)=>({gt:(_f3:string,_v3:unknown)=>({
    select:(_col:string)=>({maybeSingle:async()=>used?{data:null,error:null}:(used=true,{data:{id:'7d117ca1-8fe3-4c74-b39b-cd1666238a57',login_identifier:'1018453680',company_slug:'mw1-demo-mercado'},error:null})})
   })})})}),
   insert:async(_row:unknown)=>{writes.push(table);if(table==='platform_admins')hasAdmin=true;return {error:null}},
   delete:()=>({eq:async()=>({error:null})}),
  }),
  auth:{admin:{
   createUser:async()=>{created++;return {data:{user:{id:'479e7b8c-6392-47c0-a93e-e9664c73cd02'}},error:null}},
   deleteUser:async()=>({error:null}),
  }},
 });
 beforeEach(()=>{
  process.env.MW1_STAGING_MODE='true';
  process.env.CHATPRO_INBOX_KEY=key;
  used=false;hasAdmin=false;created=0;writes=[];
  controller=new PlatformAdminController({getClient:makeClient} as unknown as SupabaseService,new AccessAuthService());
 });
 afterAll(()=>{
  if(prevStaging===undefined)delete process.env.MW1_STAGING_MODE;else process.env.MW1_STAGING_MODE=prevStaging;
  if(prevKey===undefined)delete process.env.CHATPRO_INBOX_KEY;else process.env.CHATPRO_INBOX_KEY=prevKey;
 });
 test('rejects wrong internal key and short password before touching DB',async()=>{
  await expect(controller.activateStagingSuperadmin('wrong',{token:rawToken,password:'long-enough-password'})).rejects.toThrow();
  await expect(controller.activateStagingSuperadmin(key,{token:rawToken,password:'123'})).rejects.toThrow();
  expect(created).toBe(0);expect(used).toBe(false);
 });
 test('rejects production activation',async()=>{
  process.env.MW1_STAGING_MODE='false';
  await expect(controller.activateStagingSuperadmin(key,{token:rawToken,password:'not-a-weak-password'})).rejects.toThrow(/staging/);
  expect(created).toBe(0);
 });
 test('one-time token creates password-protected profile, demo membership and platform grant',async()=>{
  const outcome=await controller.activateStagingSuperadmin(key,{token:rawToken,password:'not-a-weak-password'});
  expect(outcome).toMatchObject({ok:true,loginIdentifier:'1018453680'});
  expect(writes).toEqual(['app_profiles','company_memberships','platform_admins']);
  expect(created).toBe(1);
  await expect(controller.activateStagingSuperadmin(key,{token:rawToken,password:'another-strong-password'})).rejects.toThrow();
  expect(created).toBe(1);
 });
});
