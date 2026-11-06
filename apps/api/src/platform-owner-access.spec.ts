import {PlatformAdminController} from './platform-admin.controller';
import {SupabaseService} from './supabase.service';
import {AccessAuthService} from './access-auth.service';

describe('MW1 credential recovery by platform superadmin (staging)',()=>{
 const oldMode=process.env.MW1_STAGING_MODE,oldKey=process.env.CHATPRO_INBOX_KEY;
 const companyId='a9dd1548-c0af-4d78-8e8f-2a082d6f7bc8';
 const ownerId='b555c4c0-a8ea-4ca9-bf5b-6a88d5ec08d2';
 const actor='5cd7a9f4-a614-4145-922b-94a8e17cb6ec';
 const key='internal-test-only', writes:Array<{table:string;value:Record<string,unknown>}>=[];
 let actorActive=true, ownerRole='owner', membershipCompany=companyId;
 let blockAuth=false, identifier='PILOTO';
 const client={
  from:(table:string)=>({
   select:(_fields:string)=>{
    const constraints:Record<string,unknown>={};
    const query={
     eq:(column:string,value:unknown)=>{constraints[column]=value;return query;},
     maybeSingle:async()=>{
      let data:Record<string,unknown>|null=null;
      if(table==='platform_admins')data=constraints.user_id===actor&&actorActive?{active:true}:null;
      if(table==='companies')data=constraints.id===companyId?{id:companyId}:null;
      if(table==='company_memberships')data=constraints.company_id===membershipCompany&&
        constraints.user_id===ownerId?{active:true,role_id:'role-id'}:null;
      if(table==='app_roles')data={key:ownerRole,company_id:null};
      if(table==='app_profiles'){
       if(constraints.user_id===ownerId)
        data={user_id:ownerId,login_identifier:identifier,contact_email:null,active:true};
       else data=null;
      }
      return {data,error:null};
     }
    };
    return query;
   },
   update:(value:Record<string,unknown>)=>({
    eq:async (_column:string,_id:string)=>{
     writes.push({table,value});return {error:null};
    }
   }),
   insert:async(value:Record<string,unknown>)=>{writes.push({table,value});return {error:null};},
  }),
  auth:{admin:{updateUserById:async (_id:string,value:Record<string,unknown>)=>{
   writes.push({table:'auth.users',value});
   return {error:blockAuth?{message:'Auth update denied'}:null};
  }}},
 };
 const controller=new PlatformAdminController({getClient:()=>client} as unknown as SupabaseService,new AccessAuthService());
 const base={companyId,userId:ownerId};
 beforeEach(()=>{
  process.env.MW1_STAGING_MODE='true';process.env.CHATPRO_INBOX_KEY=key;
  writes.length=0;actorActive=true;ownerRole='owner';membershipCompany=companyId;
  blockAuth=false;identifier='PILOTO';
 });
 afterAll(()=>{
  if(oldMode===undefined)delete process.env.MW1_STAGING_MODE;else process.env.MW1_STAGING_MODE=oldMode;
  if(oldKey===undefined)delete process.env.CHATPRO_INBOX_KEY;else process.env.CHATPRO_INBOX_KEY=oldKey;
 });
 it('requires a platform admin and the internal server key',async()=>{
  actorActive=false;
  await expect(controller.manageCompanyOwnerAccess(key,actor,{...base,identifier:'NEWONE'})).rejects.toThrow(/Super Admin/);
  expect(writes).toHaveLength(0);
  await expect(controller.manageCompanyOwnerAccess('wrong',actor,{...base,identifier:'NEWONE'})).rejects.toThrow();
  expect(writes).toHaveLength(0);
 });
 it('does not let an admin reset a non-owner account',async()=>{
  ownerRole='advisor';
  await expect(controller.manageCompanyOwnerAccess(key,actor,{...base,password:'NewPilotPass12345'}))
    .rejects.toThrow(/no es propietario/);
  expect(writes).toHaveLength(0);
 });
 it('changes only code, password and contacts and writes an audit entry without secrets',async()=>{
  const response=await controller.manageCompanyOwnerAccess(key,actor,{
   ...base,identifier:'NUEVOCODIGO',password:'NewPilotPass12345',
   contactEmail:'owner@example.com',contactPhone:'+573001112233',
  });
  expect(response).toMatchObject({ok:true,identifier:'NUEVOCODIGO',passwordChanged:true});
  expect(writes.filter(x=>x.table==='auth.users')).toHaveLength(1);
  const profileWrites=writes.find(x=>x.table==='app_profiles');
  expect(profileWrites?.value).toMatchObject({
   login_identifier:'NUEVOCODIGO',contact_email:'owner@example.com',
   recovery_phone:'+573001112233',recovery_email_verified_at:null,
  });
  expect(profileWrites?.value.password_hash).toMatch(/^scrypt-v1:/);
  const audit=writes.find(x=>x.table==='platform_access_audit');
  expect(audit?.value).toMatchObject({company_id:companyId,actor_user_id:actor,
   target_user_id:ownerId,changed_password:true,changed_identifier:true});
  for(const table of ['company_entitlements','company_integrations','company_memberships']){
   expect(writes.find(x=>x.table===table)).toBeUndefined();
  }
  expect(JSON.stringify(audit?.value)).not.toContain('NewPilotPass12345');
 });
 it('refuses changing privileges or resetting a user by passing arbitrary fields',async()=>{
  await expect(controller.manageCompanyOwnerAccess(key,actor,{
   ...base,password:'NewPilotPass12345',role:'platform_admin',
  })).rejects.toThrow(/Campo no permitido/);
  await expect(controller.manageCompanyOwnerAccess(key,actor,{
   ...base,password:'abc',
  })).rejects.toThrow(/12 a 128/);
  expect(writes).toHaveLength(0);
 });
 it('requires staging and leaves operational clients alone',async()=>{
  process.env.MW1_STAGING_MODE='false';
  await expect(controller.manageCompanyOwnerAccess(key,actor,{...base,identifier:'NEWONE'}))
   .rejects.toThrow(/staging/);
  expect(writes).toHaveLength(0);
 });
 it('does not replace profile hash if Supabase Auth declines update',async()=>{
  blockAuth=true;
  await expect(controller.manageCompanyOwnerAccess(key,actor,{...base,password:'NewPilotPass12345'}))
   .rejects.toThrow(/contraseña de acceso/);
  expect(writes.filter(x=>x.table==='app_profiles')).toHaveLength(0);
 });
});
