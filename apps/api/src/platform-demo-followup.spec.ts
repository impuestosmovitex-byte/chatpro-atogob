import {PlatformAdminController} from './platform-admin.controller';
import {SupabaseService} from './supabase.service';
import {AccessAuthService} from './access-auth.service';

describe('MW1 sales lead follow-up: staging platform-only; no trial activation',()=>{
 const oldKey=process.env.CHATPRO_INBOX_KEY;
 const oldStaging=process.env.MW1_STAGING_MODE;
 const id='efbb0d08-71ae-4f78-a8a9-e83774ebc316';
 const key='internal-test-secret';
 const actor='admin-test';
 let active=true, rowPresent=true;
 let writes:Array<{table:string;row:Record<string,unknown>}>=[],tables:string[]=[];
 const db={getClient:()=>({
  from:(table:string)=>{
   tables.push(table);
   if(table==='platform_admins')return {
    select:()=>({eq:()=>({maybeSingle:async()=>({data:{active},error:null})})}),
   };
   if(table==='platform_demo_requests')return{
    update:(row:Record<string,unknown>)=>{
     writes.push({table,row});
     return {eq:()=>({select:()=>({maybeSingle:async()=>({
      data:rowPresent?{
       id,status:row.status,internal_note:row.internal_note,
       next_followup_on:row.next_followup_on,updated_at:row.updated_at,
      }:null,error:null,
     })})})};
    },
   };
   throw new Error('Unexpected tenant table accessed: '+table);
  }
 })};
 const controller=new PlatformAdminController(db as unknown as SupabaseService,{} as AccessAuthService);
 const payload={id,status:'contacted',internalNote:'Llamar para revisar la conexión WhatsApp',
  followUpOn:'2026-10-28'};
 beforeEach(()=>{
  process.env.CHATPRO_INBOX_KEY=key;process.env.MW1_STAGING_MODE='true';
  active=true;rowPresent=true;tables=[];writes=[];
 });
 afterAll(()=>{
  if(oldKey===undefined)delete process.env.CHATPRO_INBOX_KEY;else process.env.CHATPRO_INBOX_KEY=oldKey;
  if(oldStaging===undefined)delete process.env.MW1_STAGING_MODE;else process.env.MW1_STAGING_MODE=oldStaging;
 });
 it('rejects regular company users before reading or writing lead records',async()=>{
  active=false;
  await expect(controller.updateDemoRequestFollowUp(key,actor,payload)).rejects.toThrow(/Super Admin/);
  expect(tables).toEqual(['platform_admins']);expect(writes).toHaveLength(0);
 });
 it('rejects incorrect internal key before any database access',async()=>{
  await expect(controller.updateDemoRequestFollowUp('invalid',actor,payload)).rejects.toThrow('No autorizado.');
  expect(tables).toEqual([]);
 });
 it('persists only lead follow-up columns, never creates a company or starts a trial',async()=>{
  const res=await controller.updateDemoRequestFollowUp(key,actor,payload);
  expect(res).toMatchObject({ok:true,status:'contacted',followUpOn:'2026-10-28'});
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({table:'platform_demo_requests',row:{
   status:'contacted',internal_note:'Llamar para revisar la conexión WhatsApp',
   next_followup_on:'2026-10-28',
  }});
  expect(tables).toEqual(['platform_admins','platform_demo_requests']);
  for(const dangerous of ['company_id','trial_activated_at','plan_key','price_cop','active','owner_password']){
   expect(writes[0].row).not.toHaveProperty(dangerous);
  }
 });
 it('rejects forged activation and new fields',async()=>{
  await expect(controller.updateDemoRequestFollowUp(key,actor,{
   ...payload,trialActivatedAt:'2026-10-23T18:00:00Z',
  })).rejects.toThrow(/no permitido/);
  await expect(controller.updateDemoRequestFollowUp(key,actor,{
   ...payload,status:'activated',
  })).rejects.toThrow(/Estado/);
  expect(writes).toHaveLength(0);
 });
 it('rejects malformed dates, invalid lead IDs and oversized notes',async()=>{
  await expect(controller.updateDemoRequestFollowUp(key,actor,{
   ...payload,followUpOn:'2026-02-31',
  })).rejects.toThrow(/Fecha/);
  await expect(controller.updateDemoRequestFollowUp(key,actor,{
   ...payload,id:'other-tenant',
  })).rejects.toThrow(/Identificador/);
  await expect(controller.updateDemoRequestFollowUp(key,actor,{
   ...payload,internalNote:'x'.repeat(1001),
  })).rejects.toThrow(/Nota/);
  expect(writes).toHaveLength(0);
 });
 it('does not permit writing follow-up data outside staging',async()=>{
  process.env.MW1_STAGING_MODE='false';
  await expect(controller.updateDemoRequestFollowUp(key,actor,payload)).rejects.toThrow(/staging/);
  expect(writes).toHaveLength(0);
 });
 it('reports nonexistent lead rather than silently succeeding',async()=>{
  rowPresent=false;
  await expect(controller.updateDemoRequestFollowUp(key,actor,payload)).rejects.toThrow(/No se pudo actualizar/);
 });
});
