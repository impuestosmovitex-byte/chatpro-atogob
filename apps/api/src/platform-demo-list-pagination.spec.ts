import {PlatformAdminController} from './platform-admin.controller';
import {SupabaseService} from './supabase.service';
import {AccessAuthService} from './access-auth.service';

describe('MW1 commercial leads pagination — platform only',()=>{
 const prevKey=process.env.CHATPRO_INBOX_KEY;
 const prevMode=process.env.MW1_STAGING_MODE;
 const actor='admin-fixture';
 const key='test-commercial-key';
 let active=true;
 let fromCalled:string[]=[];
 let ranges:Array<[number,number]>=[];
 const records=Array.from({length:51},(_,i)=>({
   id:'00000000-0000-4000-8000-'+String(i).padStart(12,'0'),
   company_name:'Empresa prueba '+i,contact_name:'Ejemplo '+i,
   contact_email:'example'+i+'@example.org',contact_phone:'+5700000000',
   whatsapp_setup:null,trial_requested_days:null,trial_activated_at:null,
   requested_users:null,requested_connections:null,source:'web_demo',
   plan_interest:'sin_definir',status:'new',internal_note:'',next_followup_on:null,
   created_at:'2026-11-14T10:00:00Z',
 }));
 const db={getClient:()=>({
   from:(table:string)=>{
     fromCalled.push(table);
     if(table==='platform_admins')return{
       select:()=>({eq:()=>({maybeSingle:async()=>({data:{active},error:null})})}),
     };
     if(table==='platform_demo_requests')return{
       select:()=>({
         order:()=>({
           order:()=>({
             range:async(start:number,end:number)=>{
               ranges.push([start,end]);
               return {data:records.slice(start,end+1),error:null};
             },
           }),
         }),
       }),
     };
     throw new Error('Unexpected table '+table);
   },
 })};
 const ctrl=new PlatformAdminController(db as unknown as SupabaseService,{} as AccessAuthService);
 beforeEach(()=>{
   process.env.CHATPRO_INBOX_KEY=key;process.env.MW1_STAGING_MODE='true';
   active=true;fromCalled=[];ranges=[];
 });
 afterAll(()=>{
   if(prevKey===undefined)delete process.env.CHATPRO_INBOX_KEY;
   else process.env.CHATPRO_INBOX_KEY=prevKey;
   if(prevMode===undefined)delete process.env.MW1_STAGING_MODE;
   else process.env.MW1_STAGING_MODE=prevMode;
 });
 it('returns 50 then next page from existing table',async()=>{
   const first=await ctrl.listDemoRequests(key,actor,'0');
   expect(first.requests).toHaveLength(50);
   expect(first.hasMore).toBe(true);
   const second=await ctrl.listDemoRequests(key,actor,'1');
   expect(second.requests).toHaveLength(1);
   expect(second.hasMore).toBe(false);
   expect(ranges).toEqual([[0,50],[50,100]]);
   expect(fromCalled).not.toContain('companies');
 });
 it('rejects invalid page before reading leads',async()=>{
   await expect(ctrl.listDemoRequests(key,actor,'-1')).rejects.toThrow(/Página/);
   await expect(ctrl.listDemoRequests(key,actor,'1000')).rejects.toThrow(/Página/);
   expect(fromCalled).toEqual(['platform_admins','platform_admins']);
 });
 it('rejects non-admin identity and wrong internal secret',async()=>{
   active=false;
   await expect(ctrl.listDemoRequests(key,actor,'0')).rejects.toThrow(/Super Admin/);
   expect(fromCalled).toEqual(['platform_admins']);
   fromCalled=[];
   await expect(ctrl.listDemoRequests('invalid',actor,'0')).rejects.toThrow(/No autorizado/);
   expect(fromCalled).toHaveLength(0);
 });
 it('does not expose prospect data outside staging',async()=>{
   process.env.MW1_STAGING_MODE='false';
   await expect(ctrl.listDemoRequests(key,actor,'0')).rejects.toThrow(/pruebas/);
   expect(fromCalled).toEqual(['platform_admins']);
 });
});
