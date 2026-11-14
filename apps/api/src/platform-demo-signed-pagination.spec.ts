import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {PlatformAdminController} from './platform-admin.controller';
import {SupabaseService} from './supabase.service';
import {AccessAuthService} from './access-auth.service';

describe('MW1 commercial paged leads retain signed Super Admin authorization',()=>{
 const pair=generateKeyPairSync('ed25519');
 const user='synthetic-platform-admin',key='synthetic-private-api-key';
 const previous={
   k:process.env.CHATPRO_INBOX_KEY,s:process.env.MW1_STAGING_MODE,
   pub:process.env.MW1_INTERNAL_ATTESTATION_PUBLIC_KEY,
   ack:process.env.MW1_INTERNAL_SINGLE_REPLICA_ACK,
   replicas:process.env.MW1_INTERNAL_REPLICA_COUNT,
 };
 let active=true;let reads:string[]=[];let ranges:Array<[number,number]>=[];
 const data=Array.from({length:51},(_,n)=>({
   id:'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),
   company_name:'Negocio ficticio '+n,contact_name:'Persona prueba '+n,
   contact_email:'ejemplo'+n+'@example.org',contact_phone:'+5700000000',
   source:'web_demo',plan_interest:'sin_definir',status:'new',created_at:'2026-11-14T00:00:00Z',
 }));
 const client={from:(table:string)=>{
   reads.push(table);
   if(table==='platform_admins')return{
     select:()=>({eq:()=>({maybeSingle:async()=>({data:{active},error:null})})}),
   };
   if(table==='platform_demo_requests')return{
     select:()=>({order:()=>({order:()=>({range:async(a:number,b:number)=>{
       ranges.push([a,b]);return {data:data.slice(a,b+1),error:null};
     }})})}),
   };
   throw new Error('Unexpected table '+table);
 }};
 const controller=new PlatformAdminController({getClient:()=>client} as unknown as SupabaseService,{} as AccessAuthService);
 let n=0;
 function token(){
   const now=Math.floor(Date.now()/1000);
   const claims={
     v:1,kind:'platform',userId:user,companyId:'',companySlug:'',
     method:'GET',path:'/platform-admin/demo-requests',
     iat:now,exp:now+18,nonce:(++n).toString(16).padStart(32,'0'),
     bodyHash:createHash('sha256').update('null').digest('hex'),
   };
   const message=Buffer.from(JSON.stringify(claims)).toString('base64url');
   return message+'.'+sign(null,Buffer.from(message),pair.privateKey).toString('base64url');
 }
 beforeEach(()=>{
   process.env.CHATPRO_INBOX_KEY=key;process.env.MW1_STAGING_MODE='true';
   process.env.MW1_INTERNAL_ATTESTATION_PUBLIC_KEY=pair.publicKey.export({type:'spki',format:'pem'}).toString();
   process.env.MW1_INTERNAL_SINGLE_REPLICA_ACK='true';
   process.env.MW1_INTERNAL_REPLICA_COUNT='1';
   reads=[];ranges=[];active=true;
 });
 afterAll(()=>{
   const entries:[string,string|undefined][]=[
     ['CHATPRO_INBOX_KEY',previous.k],['MW1_STAGING_MODE',previous.s],
     ['MW1_INTERNAL_ATTESTATION_PUBLIC_KEY',previous.pub],
     ['MW1_INTERNAL_SINGLE_REPLICA_ACK',previous.ack],
     ['MW1_INTERNAL_REPLICA_COUNT',previous.replicas],
   ];
   for(const [k,v] of entries){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 });
 it('reads exactly 50 leads at a time using correctly signed platform request',async()=>{
   const first=await controller.listDemoRequests(key,token(),user,'0');
   expect(first.requests).toHaveLength(50);expect(first.hasMore).toBe(true);
   const second=await controller.listDemoRequests(key,token(),user,'1');
   expect(second.requests).toHaveLength(1);expect(second.hasMore).toBe(false);
   expect(ranges).toEqual([[0,50],[50,100]]);
   expect(reads).toEqual(['platform_admins','platform_demo_requests','platform_admins','platform_demo_requests']);
 });
 it('rejects missing signature and regular user without reading leads',async()=>{
   await expect(controller.listDemoRequests(key,'',user,'0')).rejects.toThrow(/autenticación/);
   expect(reads).toEqual([]);
   active=false;
   await expect(controller.listDemoRequests(key,token(),user,'0')).rejects.toThrow(/Super Admin/);
   expect(reads).toEqual(['platform_admins']);
 });
 it('rejects invalid page, preserving signed admin check',async()=>{
   await expect(controller.listDemoRequests(key,token(),user,'-1')).rejects.toThrow(/Página/);
   expect(reads).toEqual(['platform_admins']);
 });
});
