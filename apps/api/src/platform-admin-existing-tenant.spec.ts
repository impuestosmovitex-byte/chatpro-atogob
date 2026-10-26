import {PlatformAdminController} from './platform-admin.controller';
import {AccessAuthService} from './access-auth.service';
import {SupabaseService} from './supabase.service';

describe('MW1 existing operational tenant guard',()=>{
 const prevKey=process.env.CHATPRO_INBOX_KEY;
 const prevMode=process.env.MW1_STAGING_MODE;
 const key='isolated-staging-test-key';
 let accessed:string[];
 let createdUsers:number;
 let controller:PlatformAdminController;

 beforeEach(()=>{
  process.env.CHATPRO_INBOX_KEY=key;
  process.env.MW1_STAGING_MODE='true';
  accessed=[];
  createdUsers=0;
  const client={
   from:(table:string)=>({
    select:(_columns:string)=>({
     eq:(_field:string,_value:unknown)=>({
      maybeSingle:async()=>({
       data:table==='platform_admins'?{user_id:'operator',active:true}:
        table==='platform_external_tenant_registry'?{company_slug:'atogob'}:null,
       error:null,
      }),
     }),
    }),
    insert:(_data:unknown)=>{accessed.push('WRITE:'+table);throw new Error('Unexpected write');},
   }),
   auth:{admin:{createUser:async()=>{createdUsers++;throw new Error('Unexpected auth write');}}},
  };
  const originalFrom=client.from;
  client.from=(table:string)=>{accessed.push(table);return originalFrom(table);};
  controller=new PlatformAdminController({getClient:()=>client} as unknown as SupabaseService,new AccessAuthService());
 });
 afterAll(()=>{
  if(prevKey===undefined)delete process.env.CHATPRO_INBOX_KEY;else process.env.CHATPRO_INBOX_KEY=prevKey;
  if(prevMode===undefined)delete process.env.MW1_STAGING_MODE;else process.env.MW1_STAGING_MODE=prevMode;
 });
 test('an operational customer slug cannot be recreated in staging, with zero writes',async()=>{
  const data={name:'ATO GOB duplicate',slug:'atogob',ownerFullName:'Test Owner',ownerIdentifier:'999887766',ownerPassword:'Secure-password-2026',planKey:'inicial',maxUsers:2,maxWhatsappLines:1};
  await expect(controller.createCompany(key,'operator',data)).rejects.toThrow(/ya existe en MW1 operativo/);
  expect(accessed).toContain('platform_external_tenant_registry');
  expect(accessed.some(t=>t.startsWith('WRITE:'))).toBe(false);
  expect(createdUsers).toBe(0);
 });
});
