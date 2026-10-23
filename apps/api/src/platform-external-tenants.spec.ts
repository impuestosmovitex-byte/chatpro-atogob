import {PlatformAdminController} from './platform-admin.controller';
import {SupabaseService} from './supabase.service';
import {AccessAuthService} from './access-auth.service';

describe('staging operational directory boundaries',()=>{
 const oldKey=process.env.CHATPRO_INBOX_KEY;
 const oldMode=process.env.MW1_STAGING_MODE;
 const accessed:string[]=[];
 let authorized=true;
 const db={
  getClient:()=>({
   from:(table:string)=>{
    accessed.push(table);
    if(table==='platform_admins')return {
     select:()=>({eq:()=>({maybeSingle:async()=>({data:{active:authorized},error:null})})})
    };
    if(table==='companies')return {
     select:()=>({order:async()=>({data:[],error:null})})
    };
    if(table==='platform_external_tenant_registry')return{
     select:()=>({order:()=>({limit:async()=>({data:[
      {company_name:'Atogob Group',company_slug:'atogob',billing_status:'not_configured',environment_label:'Operación MW1 existente',verified_at:'2026-10-23T00:00:00Z',commercial_plan_suggestion:'eco',commercial_mode:'observe_only',active_users_count:2,active_integration_records:1,messages_30d:94,ai_response_records_30d:26,last_message_at:'2026-10-20T17:28:39Z',activity_observed_at:'2026-10-23T17:31:33Z',ai_cost_status:'not_measured',recommended_plan_reason:'Sin cambiar permisos',commercial_plan_suggestion:'pro',commercial_mode:'observe_only',active_users_count:3,active_integration_records:4,messages_30d:11508,ai_response_records_30d:3102,last_message_at:'2026-10-23T17:25:42Z',activity_observed_at:'2026-10-23T17:31:33Z',ai_cost_status:'not_measured',recommended_plan_reason:'Sin cambiar permisos'},
      {company_name:'Emprende con Maogo',company_slug:'emprende-con-maogo',billing_status:'not_configured',environment_label:'Operación MW1 existente',verified_at:'2026-10-23T00:00:00Z'}
     ],error:null})})})
    };
    throw new Error('Unexpected table accessed: '+table);
   }
  }),
 };
 const ctrl=new PlatformAdminController(db as unknown as SupabaseService,{} as AccessAuthService);
 beforeEach(()=>{
  accessed.length=0;authorized=true;
  process.env.CHATPRO_INBOX_KEY='test-internal-staging-key';
  process.env.MW1_STAGING_MODE='true';
 });
 afterAll(()=>{
  if(oldKey===undefined)delete process.env.CHATPRO_INBOX_KEY;else process.env.CHATPRO_INBOX_KEY=oldKey;
  if(oldMode===undefined)delete process.env.MW1_STAGING_MODE;else process.env.MW1_STAGING_MODE=oldMode;
 });
 it('presents operational references separately from local demo tenants',async()=>{
  const response=await ctrl.listCompanies('test-internal-staging-key','a2c484ef-408c-4c7c-8c38-6db7097d0adb');
  expect(response.companies).toHaveLength(0);
  expect(response.linkedCompanies).toMatchObject([
    {name:'Atogob Group',slug:'atogob',billingStatus:'not_configured',recommendedPlan:'pro',commercialMode:'observe_only',messages30d:11508,aiCostStatus:'not_measured'},
    {name:'Emprende con Maogo',slug:'emprende-con-maogo',billingStatus:'not_configured',recommendedPlan:'eco',commercialMode:'observe_only',messages30d:94,aiCostStatus:'not_measured'},
  ]);
  expect(accessed).toEqual(['platform_admins','companies','platform_external_tenant_registry']);
 });
 it('does not expose references to a regular company user',async()=>{
  authorized=false;
  await expect(ctrl.listCompanies('test-internal-staging-key','a2c484ef-408c-4c7c-8c38-6db7097d0adb')).rejects.toThrow(/Super Admin/);
  expect(accessed).toEqual(['platform_admins']);
 });
 it('never includes operational tenant references outside staging',async()=>{
  process.env.MW1_STAGING_MODE='false';
  const response=await ctrl.listCompanies('test-internal-staging-key','a2c484ef-408c-4c7c-8c38-6db7097d0adb');
  expect(response.linkedCompanies).toEqual([]);
  expect(accessed).not.toContain('platform_external_tenant_registry');
 });
});
