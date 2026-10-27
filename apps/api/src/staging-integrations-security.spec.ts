import {StagingIntegrationsController} from './staging-integrations.controller';
import {SupabaseService} from './supabase.service';

describe('staging integration catalog and isolation',()=>{
 const key='test-staging-key';
 const previousKey=process.env.CHATPRO_INBOX_KEY;
 const companyId='pilot-company-id',ownerId='pilot-owner-id';
 const rows:Record<string,Record<string,unknown>>={
  companies:{id:companyId,name:'Piloto MW1 Prueba',slug:'piloto-mw1-prueba',status:'active'},
  company_memberships:{company_id:companyId,user_id:ownerId,active:true,role_id:'owner-role'},
  app_roles:{id:'owner-role',key:'owner',company_id:null},
 };
 let controller:StagingIntegrationsController;
 let reads:string[];
 beforeEach(()=>{
  process.env.CHATPRO_INBOX_KEY=key;
  reads=[];
  const db={from:(table:string)=>{
   reads.push(table);
   const filters:Record<string,unknown>={};
   const query={
    select:(_columns:string)=>query,
    eq:(field:string,value:unknown)=>{filters[field]=value;return query;},
    maybeSingle:async()=>{
     const row=rows[table];
     const matches=row&&Object.entries(filters).every(([k,v])=>row[k]===v);
     return {data:matches?row:null,error:null};
    },
   };
   return query;
  }};
  controller=new StagingIntegrationsController({getClient:()=>db} as unknown as SupabaseService);
 });
 afterAll(()=>{if(previousKey===undefined)delete process.env.CHATPRO_INBOX_KEY;else process.env.CHATPRO_INBOX_KEY=previousKey;});
 test('owner sees catalog without credentials or live-connection claims',async()=>{
  const result=await controller.list(key,ownerId,companyId,'piloto-mw1-prueba');
  expect(result.ok).toBe(true);
  expect(result.stagingReadOnly).toBe(true);
  expect(result.connectionEnabled).toBe(false);
  expect(result.integrations.map(x=>x.key)).toEqual(['whatsapp','shopify','instagram','messenger','meta-ads']);
  expect(result.integrations.every(x=>x.status==='disconnected'&&!x.connectionReady)).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(/accessToken|credentials_encrypted|api_secret/);
  expect(reads).toEqual(['companies','company_memberships','app_roles']);
 });
 test('rejects other tenant without reading integration records',async()=>{
  await expect(controller.list(key,ownerId,'another-company','piloto-mw1-prueba')).rejects.toThrow();
  expect(reads).toEqual(['companies']);
 });
 test('rejects wrong internal key before querying database',async()=>{
  await expect(controller.list('wrong',ownerId,companyId,'piloto-mw1-prueba')).rejects.toThrow();
  expect(reads).toEqual([]);
 });
});
