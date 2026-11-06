import {PlatformAdminController} from './platform-admin.controller';
import {SupabaseService} from './supabase.service';
import {AccessAuthService} from './access-auth.service';

describe('staging per-company financial ledger is platform-only and observe-only',()=>{
 const oldKey=process.env.CHATPRO_INBOX_KEY;
 const oldMode=process.env.MW1_STAGING_MODE;
 let active=true;const writes:Array<{table:string;data:Record<string,unknown>}>=[];let tables:string[]=[];
 const sample={periodMonth:'2026-10-01',companySource:'operational',companySlug:'atogob',
  billedCop:null,receivedCop:null,openaiCop:null,supportCop:null,onboardingCop:null,
  otherDirectCop:null,allocationWeight:1,includeInAllocation:true,evidenceNote:'Sin factura todavía'};
 const db={
  getClient:()=>({from:(table:string)=>{
   tables.push(table);
   if(table==='platform_admins')return {select:()=>({eq:()=>({maybeSingle:async()=>({data:{active},error:null})})})};
   if(table==='platform_external_tenant_registry'||table==='companies')return{
    select:()=>({
     eq:(column:string,slug:string)=>({maybeSingle:async()=>({data:column==='company_slug'&&slug==='atogob'?{company_slug:'atogob'}:null,error:null})}),
     order:()=>({limit:async()=>({data:[],error:null})}),
    })
   };
   if(table==='platform_finance_company_monthly')return{
    select:()=>({eq:()=>({limit:async()=>({data:[],error:null})})}),
    upsert:async(data:Record<string,unknown>)=>{writes.push({table,data});return {error:null};},
   };
   if(table==='platform_finance_monthly_actuals')return{
    select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:null})})})
   };
   throw new Error('Unexpected '+table);
  }})
 };
 const controller=new PlatformAdminController(db as unknown as SupabaseService,{} as AccessAuthService);
 beforeEach(()=>{
  tables=[];writes.length=0;active=true;
  process.env.CHATPRO_INBOX_KEY='only-staging-test-key';
  process.env.MW1_STAGING_MODE='true';
 });
 afterAll(()=>{
  if(oldKey===undefined)delete process.env.CHATPRO_INBOX_KEY;else process.env.CHATPRO_INBOX_KEY=oldKey;
  if(oldMode===undefined)delete process.env.MW1_STAGING_MODE;else process.env.MW1_STAGING_MODE=oldMode;
 });
 test('non-admin cannot read or write company finance',async()=>{
  active=false;
  await expect(controller.getCompanyFinance('only-staging-test-key','user','2026-10-01')).rejects.toThrow(/Super Admin/);
  await expect(controller.saveCompanyFinance('only-staging-test-key','user',sample)).rejects.toThrow(/Super Admin/);
  expect(writes).toHaveLength(0);
  expect(tables).toEqual(['platform_admins','platform_admins']);
 });
 test('valid entry writes only private staging financial table and preserves missing cost',async()=>{
  const result=await controller.saveCompanyFinance('only-staging-test-key','admin',sample);
  expect(result.ok).toBe(true);
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({table:'platform_finance_company_monthly',
    data:{company_source:'operational',company_slug:'atogob',
     billed_cop:null,received_cop:null,openai_cop:null,include_in_allocation:true}});
  expect(tables).not.toContain('company_entitlements');
  expect(tables).not.toContain('conversations');
  expect(tables).not.toContain('company_integrations');
 });
 test('cannot invent a company or overwrite plan entitlements',async()=>{
  await expect(controller.saveCompanyFinance('only-staging-test-key','admin',
   {...sample,companySlug:'not-registered'})).rejects.toThrow(/directorio/);
  await expect(controller.saveCompanyFinance('only-staging-test-key','admin',
   {...sample,planKey:'pro'})).rejects.toThrow(/no permitido/);
  expect(writes).toHaveLength(0);
 });
 test('staging-only route rejects production mode',async()=>{
  process.env.MW1_STAGING_MODE='false';
  await expect(controller.saveCompanyFinance('only-staging-test-key','admin',sample)).rejects.toThrow(/staging/);
  expect(writes).toHaveLength(0);
 });
 test('empty monthly result returns options and unknown shared amounts',async()=>{
  const response=await controller.getCompanyFinance('only-staging-test-key','admin','2026-10-01');
  expect(response).toMatchObject({ok:true,periodMonth:'2026-10-01',records:[],sharedActual:null});
 });
});
