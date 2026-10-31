import {PlatformAdminController} from './platform-admin.controller';
import {emptyPlanDraft} from './platform-plan-drafts';
import {SupabaseService} from './supabase.service';
import {AccessAuthService} from './access-auth.service';

describe('MW1 staging publishing and tenant authorization',()=>{
 const originalMode=process.env.MW1_STAGING_MODE;
 const originalKey=process.env.CHATPRO_INBOX_KEY;
 const key='staging-internal-test-key';
 const user='verified-test-admin';
 const companyA='d55817a3-d104-48e7-8efb-c7736e9c8aa4';
 const companyB='a358170a-0000-48e7-8efb-c7736e9c8aa4';
 let active:boolean;
 let writes:Array<{table:string;row:Record<string,unknown>}>;
 let accessed:string[];
 let controller:PlatformAdminController;
 let draft:Record<string,unknown>|null;
 class Query{
  private filters:Record<string,unknown>={};
  constructor(private table:string){accessed.push(table);}
  select(_columns:string){return this;}
  eq(field:string,value:unknown){this.filters[field]=value;return this;}
  gte(field:string,value:unknown){this.filters[field]=value;return this;}
  order(_field:string,_args?:unknown){return this;}
  limit(_n:number){
   if(this.table==='platform_published_plan_prices')
     return Promise.resolve({data:[],error:null});
   if(this.table==='platform_ai_usage_events')
     return Promise.resolve({data:[{input_tokens:20,output_tokens:5,cached_input_tokens:0,model:'test-model',estimated_cost_usd:null,recorded_at:new Date().toISOString()}].filter(()=>this.filters.company_id===companyA),error:null});
   if(this.table==='platform_ai_model_rates')return Promise.resolve({data:[],error:null});
   return Promise.resolve({data:[],error:null});
  }
  maybeSingle(){
   if(this.table==='platform_admins')
     return Promise.resolve({data:this.filters.user_id===user?{user_id:user,active}:null,error:null});
   if(this.table==='platform_commercial_plan_drafts')
     return Promise.resolve({data:draft,error:null});
   return Promise.resolve({data:null,error:null});
  }
  upsert(row:Record<string,unknown>){
   writes.push({table:this.table,row});
   return {
    select:(_columns:string)=>({single:async()=>({data:{plan_key:row.plan_key},error:null})}),
    then:(resolve:(value:{error:null})=>unknown)=>resolve({error:null}),
   };
  }
 }
 beforeEach(()=>{
  process.env.MW1_STAGING_MODE='true';process.env.CHATPRO_INBOX_KEY=key;
  active=false;writes=[];accessed=[];draft=null;
  const db={getClient:()=>({from:(table:string)=>new Query(table)})};
  controller=new PlatformAdminController(db as unknown as SupabaseService,{} as AccessAuthService);
 });
 afterAll(()=>{
  if(originalMode===undefined)delete process.env.MW1_STAGING_MODE;else process.env.MW1_STAGING_MODE=originalMode;
  if(originalKey===undefined)delete process.env.CHATPRO_INBOX_KEY;else process.env.CHATPRO_INBOX_KEY=originalKey;
 });
 const plan=()=>({...emptyPlanDraft('inicial'),priceCop:149000,maxUsers:2,maxWhatsappLines:1,
  whatsappEnabled:true,reviewStatus:'ready_for_review' as const,publicSummary:'Prueba comercial',publicFeatures:['CRM']});
 test('incorrect internal key cannot even check platform admin',async()=>{
  await expect(controller.getPlanDrafts('wrong',user)).rejects.toThrow('No autorizado');
  expect(accessed).toEqual([]);
  expect(writes).toHaveLength(0);
 });
 test('ordinary company user cannot read drafts, save, publish or access another tenant IA',async()=>{
  await expect(controller.getPlanDrafts(key,user)).rejects.toThrow(/Super Admin/);
  await expect(controller.savePlanDraft(key,user,plan())).rejects.toThrow(/Super Admin/);
  await expect(controller.publishPlanPrice(key,user,{planKey:'inicial'})).rejects.toThrow(/Super Admin/);
  await expect(controller.getAiUsage(key,user,companyB)).rejects.toThrow(/Super Admin/);
  expect(writes).toHaveLength(0);
  expect(accessed.every(t=>t==='platform_admins')).toBe(true);
 });
 test('public catalog requires internal key but does not reveal private drafts',async()=>{
  await expect(controller.getPublicPlanPrices('wrong')).rejects.toThrow('No autorizado');
  const catalog=await controller.getPublicPlanPrices(key);
  expect(catalog).toEqual({ok:true,plans:[]});
  expect(accessed).not.toContain('platform_commercial_plan_drafts');
 });
 test('publication refuses unreviewed plans and cannot modify entitlements',async()=>{
  active=true;draft={plan_key:'inicial',price_cop:149000,max_users:2,max_whatsapp_lines:1,
   extra_user_cop:null,extra_connection_cop:null,ai_monthly_budget_cop:null,
   public_summary:'Prueba comercial',public_features:['CRM'],
   whatsapp_enabled:true,review_status:'draft'};
  await expect(controller.publishPlanPrice(key,user,{planKey:'inicial'})).rejects.toThrow(/completo/);
  expect(writes).toHaveLength(0);
 });
 test('authorized admin saves and publishes only isolated commercial snapshots',async()=>{
  active=true;const saved=await controller.savePlanDraft(key,user,plan());
  expect(saved.ok).toBe(true);
  draft={plan_key:'inicial',price_cop:149000,max_users:2,max_whatsapp_lines:1,
   extra_user_cop:null,extra_connection_cop:null,ai_monthly_budget_cop:null,
   public_summary:'Prueba comercial',public_features:['CRM'],whatsapp_enabled:true,review_status:'ready_for_review'};
  const published=await controller.publishPlanPrice(key,user,{planKey:'inicial'});
  expect(published.ok).toBe(true);
  expect(writes.map(x=>x.table)).toEqual(['platform_commercial_plan_drafts','platform_published_plan_prices']);
  expect(writes[1].row).toMatchObject({plan_key:'inicial',price_cop:149000,max_users:2,public_features:['CRM']});
  expect(writes.some(x=>x.table==='company_entitlements'||x.table==='companies')).toBe(false);
 });
 test('admin usage report strictly filters requested company and does not pull other tenants',async()=>{
  active=true;
  const report=await controller.getAiUsage(key,user,companyA);
  expect(report).toMatchObject({ok:true,companyId:companyA,records:1,recordsMissingRates:1});
  expect(accessed).toContain('platform_ai_usage_events');
 });
});
