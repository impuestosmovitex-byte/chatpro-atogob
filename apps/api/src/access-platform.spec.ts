import {AccessController} from './access.controller';
import {AccessAuthService} from './access-auth.service';
import {SupabaseService} from './supabase.service';

describe('MW1 companyless platform authentication',()=>{
 const prevKey=process.env.CHATPRO_INBOX_KEY,prevMode=process.env.MW1_STAGING_MODE;
 const userId='eabf7eda-e0bf-4278-bd9b-d86ab680188f';
 let active=true;
 const auth=new AccessAuthService();
 const password='testing-a-platform-password-2026';
 const passwordHash=auth.hash(password);
 const client={
  from:(table:string)=>({
   select:(_cols:string)=>({
    eq:(_field:string,_value:string)=>({
     maybeSingle:async()=>{
      if(table==='app_profiles')return {data:{user_id:userId,full_name:'Administrador MW1',active:true,password_hash:passwordHash},error:null};
      if(table==='platform_admins')return {data:{user_id:userId,active},error:null};
      return {data:null,error:null};
     }
    })
   })
  })
 };
 const controller=new AccessController({getClient:()=>client} as unknown as SupabaseService,auth);
 beforeEach(()=>{active=true;process.env.MW1_STAGING_MODE='true';process.env.CHATPRO_INBOX_KEY='test-inbox-key';});
 afterAll(()=>{
  if(prevKey===undefined)delete process.env.CHATPRO_INBOX_KEY;else process.env.CHATPRO_INBOX_KEY=prevKey;
  if(prevMode===undefined)delete process.env.MW1_STAGING_MODE;else process.env.MW1_STAGING_MODE=prevMode;
 });
 it('authenticates global admin without selecting or returning any company',async()=>{
  const result=await controller.platformLogin('test-inbox-key',{identifier:'1018453680',password});
  expect(result).toMatchObject({ok:true,session:{type:'platform',userId,roleKey:'platform_admin',companyId:'',companySlug:'',companyName:''}});
  expect(JSON.stringify(result)).not.toContain('mw1-demo-mercado');
 });
 it('rejects inactive platform privilege, wrong password and incorrect internal key',async()=>{
  active=false;
  await expect(controller.platformLogin('test-inbox-key',{identifier:'1018453680',password})).rejects.toThrow();
  active=true;
  await expect(controller.platformLogin('test-inbox-key',{identifier:'1018453680',password:'wrong-password'})).rejects.toThrow();
  await expect(controller.platformLogin('wrong-key',{identifier:'1018453680',password})).rejects.toThrow();
 });
 it('cannot use platform login outside staging',async()=>{
  process.env.MW1_STAGING_MODE='false';
  await expect(controller.platformLogin('test-inbox-key',{identifier:'1018453680',password})).rejects.toThrow(/staging/);
 });
});
