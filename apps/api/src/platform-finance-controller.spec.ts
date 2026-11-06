import {PlatformAdminController} from './platform-admin.controller';
import {SupabaseService} from './supabase.service';
import {AccessAuthService} from './access-auth.service';

describe('MW1 staging finance security and persistence',()=>{
 const originalKey=process.env.CHATPRO_INBOX_KEY;
 const originalMode=process.env.MW1_STAGING_MODE;
 let active:boolean;
 let tables:string[];
 let writes:Array<{table:string;payload:Record<string,unknown>}>;
 const example={
  counts:[0,0,10],prices:[149000,259000,599000],railway:150000,supabase:100000,
  otherFixed:30000,supportPerCompany:25000,openAiPerCompany:30000,fxRate:4000,
  usdOpenAi:false,technicianMonthly:250000,administrationMonthly:150000,
  marketingMonthly:200000,toolsMonthly:15000,newCustomers:1,
  onboardingCostPerCustomer:70000,onboardingFeePerCustomer:0,
  paymentProcessingPercent:2.5,targetMarginPercent:30,
 };
 const actual={
  periodMonth:'2026-10-01',evidenceNote:'Datos comprobados',
  receivedCop:null,railwayCop:110000,supabaseCop:null,openaiCop:null,
  technicalSupportCop:null,personnelCop:null,marketingCop:null,otherCop:null,
 };
 let ctrl:PlatformAdminController;
 beforeEach(()=>{
  process.env.CHATPRO_INBOX_KEY='only-test-staging-key';
  process.env.MW1_STAGING_MODE='true';active=true;tables=[];writes=[];
  const db={
   getClient:()=>({
    from:(table:string)=>{
     tables.push(table);
     if(table==='platform_admins')return {
      select:()=>({eq:()=>({maybeSingle:async()=>({data:{active},error:null})})}),
     };
     if(['platform_finance_scenarios','platform_finance_monthly_actuals'].includes(table))return{
      select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:null})})}),
      upsert:async(payload:Record<string,unknown>)=>{writes.push({table,payload});return {error:null};},
     };
     throw new Error('Unexpected table '+table);
    },
   })
  };
  ctrl=new PlatformAdminController(db as unknown as SupabaseService,{} as AccessAuthService);
 });
 afterAll(()=>{
  if(originalKey===undefined)delete process.env.CHATPRO_INBOX_KEY;else process.env.CHATPRO_INBOX_KEY=originalKey;
  if(originalMode===undefined)delete process.env.MW1_STAGING_MODE;else process.env.MW1_STAGING_MODE=originalMode;
 });
 test('rejects regular users before reading private financial data',async()=>{
  active=false;
  await expect(ctrl.getFinance('only-test-staging-key','test-user','2026-10-01')).rejects.toThrow(/Super Admin/);
  await expect(ctrl.saveFinanceScenario('only-test-staging-key','test-user',example)).rejects.toThrow(/Super Admin/);
  await expect(ctrl.saveFinanceActual('only-test-staging-key','test-user',actual)).rejects.toThrow(/Super Admin/);
  expect(tables).toEqual(['platform_admins','platform_admins','platform_admins']);
  expect(writes).toHaveLength(0);
 });
 test('rejects incorrect internal key and disables finance outside staging',async()=>{
  await expect(ctrl.saveFinanceScenario('invalid','test-user',example)).rejects.toThrow();
  expect(tables).toHaveLength(0);
  process.env.MW1_STAGING_MODE='false';
  await expect(ctrl.saveFinanceScenario('only-test-staging-key','test-user',example)).rejects.toThrow(/pruebas/);
  expect(writes).toHaveLength(0);
 });
 test('saves a scenario and nullable actuals, never touches tenant entitlements',async()=>{
  await expect(ctrl.saveFinanceScenario('only-test-staging-key','test-user',example)).resolves.toMatchObject({ok:true});
  await expect(ctrl.saveFinanceActual('only-test-staging-key','test-user',actual)).resolves.toMatchObject({ok:true});
  expect(writes.map(x=>x.table)).toEqual(['platform_finance_scenarios','platform_finance_monthly_actuals']);
  expect(writes[0].payload).toMatchObject({scenario_key:'current',assumptions:example});
  expect(writes[1].payload).toMatchObject({period_month:'2026-10-01',received_cop:null,railway_cop:110000});
  expect(tables).not.toContain('company_entitlements');
  expect(tables).not.toContain('platform_ai_usage_events');
 });
 test('invalid amounts and malformed month cannot be saved',async()=>{
  await expect(ctrl.saveFinanceScenario('only-test-staging-key','test-user',{...example,technicianMonthly:-1})).rejects.toThrow();
  await expect(ctrl.saveFinanceActual('only-test-staging-key','test-user',{...actual,periodMonth:'2026-10-23'})).rejects.toThrow();
  expect(writes).toHaveLength(0);
 });
 test('loads empty workbook as null rather than inventing paid revenue',async()=>{
  const result=await ctrl.getFinance('only-test-staging-key','test-user','2026-10-01');
  expect(result).toMatchObject({ok:true,scenario:null,actual:null});
 });
});
