import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {ForbiddenException,UnauthorizedException} from '@nestjs/common';
import {StagingInboxController} from './staging-inbox.controller';

type Row=Record<string,any>;
const COMPANY_A='company-alfa',COMPANY_B='company-beta';
const USER_A='user-alfa',USER_B='user-beta';
const keyPair=generateKeyPairSync('ed25519');
const original={
 staging:process.env.MW1_STAGING_MODE,key:process.env.CHATPRO_INBOX_KEY,
 pub:process.env.MW1_INTERNAL_ATTESTATION_PUBLIC_KEY,
 ack:process.env.MW1_INTERNAL_SINGLE_REPLICA_ACK,
 replicas:process.env.MW1_INTERNAL_REPLICA_COUNT,
};
function signed(path:'/inbox'|'/inbox/instagram-pilot'|'/inbox/:sessionId',userId=USER_A,
 companyId=COMPANY_A,slug='alfa'){
 const now=Math.floor(Date.now()/1000);
 const claim={v:1,kind:'user',userId,companyId,companySlug:slug,
  method:'GET',path,iat:now,exp:now+20,nonce:randomBytes(16).toString('hex'),
  bodyHash:createHash('sha256').update('null').digest('hex')};
 const payload=Buffer.from(JSON.stringify(claim)).toString('base64url');
 return payload+'.'+sign(null,Buffer.from(payload),keyPair.privateKey).toString('base64url');
}
function fixtures(overrides:Record<string,Row[]>={}){
 const rows:Record<string,Row[]>={
  companies:[{id:COMPANY_A,slug:'alfa',status:'active',name:'Alfa'},
    {id:COMPANY_B,slug:'beta',status:'active',name:'Beta'},
    {id:'pilot-company',slug:'piloto-mw1-prueba',status:'active',name:'Piloto'}],
  app_profiles:[{user_id:USER_A,active:true},{user_id:USER_B,active:true}],
  company_memberships:[{company_id:COMPANY_A,user_id:USER_A,active:true,role_id:'role-alfa'},
    {company_id:COMPANY_B,user_id:USER_B,active:true,role_id:'role-beta'}],
  app_roles:[{id:'role-alfa',key:'advisor',company_id:COMPANY_A},
    {id:'role-beta',key:'owner',company_id:COMPANY_B}],
  app_role_permissions:[{role_id:'role-alfa',permission_id:'p-view'},
    {role_id:'role-beta',permission_id:'p-view'}],
  app_permissions:[{id:'p-view',key:'inbox.view'}],
  conversation_sessions:[
    {id:'assigned',company_id:COMPANY_A,customer_phone:'3001111111',
      context:{kind:'assigned'},attention_status:'human',assigned_to_user_id:USER_A},
    {id:'shared',company_id:COMPANY_A,customer_phone:'3002222222',
      context:{kind:'shared'},attention_status:'waiting',assigned_to_user_id:'someone-else'},
    {id:'closed',company_id:COMPANY_A,customer_phone:'3003333333',
      context:{kind:'closed'},attention_status:'closed',assigned_to_user_id:null},
    {id:'beta',company_id:COMPANY_B,customer_phone:'3009999999',
      context:{kind:'secret-beta'},attention_status:'human',assigned_to_user_id:USER_B},
  ],
  mw1_instagram_staging_inbox:[],
  ...overrides,
 };
 const reads:Array<{table:string;filters:Array<[string,unknown]>}>=[];
 const db={from(table:string){
  const filters:Array<[string,unknown]>=[];
  const tracked={table,filters};reads.push(tracked);
  const matches=()=> (rows[table]??[]).filter(row=>
   filters.every(([k,v])=>(v&&typeof v==='object'&&'in' in v)
     ?(v as {in:unknown[]}).in.includes(row[k]):row[k]===v));
  const query:any={
   select:()=>query,eq:(key:string,value:unknown)=>{filters.push([key,value]);return query;},
   in:(key:string,values:unknown[])=>{filters.push([key,{in:values}]);return query;},
   order:()=>query,limit:()=>query,
   maybeSingle:async()=>({data:matches()[0]??null,error:null}),
   then:(resolve:(x:any)=>unknown,reject?:(x:any)=>unknown)=>
    Promise.resolve({data:matches(),error:null}).then(resolve,reject),
  };return query;
 }};
 const controller=new StagingInboxController({getClient:()=>db} as any);
 const list=(assertion=signed('/inbox'),user=USER_A,company=COMPANY_A,slug='alfa')=>
  controller.list('test-key',user,company,slug,assertion);
 const pilot=(assertion=signed('/inbox/instagram-pilot',USER_A,'pilot-company','piloto-mw1-prueba'),
  user=USER_A,company='pilot-company',slug='piloto-mw1-prueba')=>
  controller.instagramPilot('test-key',user,company,slug,assertion);
 return {controller,reads,list,pilot};
}
describe('SEG-003D staging inbox (shared inbox.view visibility, synthetic tenants)',()=>{
 beforeAll(()=>{
  process.env.MW1_STAGING_MODE='true';
  process.env.CHATPRO_INBOX_KEY='test-key';
  process.env.MW1_INTERNAL_ATTESTATION_PUBLIC_KEY=
   keyPair.publicKey.export({type:'spki',format:'pem'}).toString();
  process.env.MW1_INTERNAL_SINGLE_REPLICA_ACK='true';
  process.env.MW1_INTERNAL_REPLICA_COUNT='1';
 });
 afterAll(()=>{
  for(const [name,value] of [
   ['MW1_STAGING_MODE',original.staging],['CHATPRO_INBOX_KEY',original.key],
   ['MW1_INTERNAL_ATTESTATION_PUBLIC_KEY',original.pub],
   ['MW1_INTERNAL_SINGLE_REPLICA_ACK',original.ack],
   ['MW1_INTERNAL_REPLICA_COUNT',original.replicas],
  ] as const){
   if(value===undefined)delete process.env[name];else process.env[name]=value;
  }
 });
 it('preserves advisor inbox.view shared visibility for assigned, unassigned and closed sessions',async()=>{
  const {list,reads}=fixtures();
  const result=await list();
  expect(result.stagingReadOnly).toBe(true);
  expect(result.sessions.map(s=>s.id)).toEqual(['assigned','shared','closed']);
  expect(result.sessions.some(s=>s.id==='beta')).toBe(false);
  expect(reads.filter(x=>x.table==='conversation_sessions')[0].filters)
   .toContainEqual(['company_id',COMPANY_A]);
 });
 it('owner/admin stay eligible when they hold inbox.view; no special role-based narrowing',async()=>{
  for(const roleKey of ['owner','admin']){
   const {list}=fixtures({app_roles:[{id:'role-alfa',key:roleKey,company_id:COMPANY_A}]});
   expect((await list()).sessions).toHaveLength(3);
  }
 });
 it('denies advisor with no inbox.view before reading conversations',async()=>{
  const {list,reads}=fixtures({app_role_permissions:[]});
  await expect(list()).rejects.toBeInstanceOf(ForbiddenException);
  expect(reads.some(q=>q.table==='conversation_sessions')).toBe(false);
 });
 it('denies disabled user, revoked membership, and inactive company before sessions',async()=>{
  const scenarios=[
   {app_profiles:[{user_id:USER_A,active:false}]},
   {company_memberships:[{company_id:COMPANY_A,user_id:USER_A,active:false,role_id:'role-alfa'}]},
   {companies:[{id:COMPANY_A,slug:'alfa',status:'inactive'}]},
  ];
  for(const scenario of scenarios){
   const {list,reads}=fixtures(scenario);
   await expect(list()).rejects.toBeInstanceOf(ForbiddenException);
   expect(reads.some(x=>x.table==='conversation_sessions')).toBe(false);
  }
 });
 it('rejects cross-company id, role mismatches, and forged user headers',async()=>{
  const {list}=fixtures();
  await expect(list(signed('/inbox'),USER_A,COMPANY_B,'beta'))
   .rejects.toBeInstanceOf(UnauthorizedException);
  await expect(list(signed('/inbox',USER_B,COMPANY_A,'alfa')))
   .rejects.toBeInstanceOf(UnauthorizedException);
  const wrongRole=fixtures({app_roles:[{id:'role-alfa',key:'advisor',company_id:COMPANY_B}]});
  await expect(wrongRole.list()).rejects.toBeInstanceOf(ForbiddenException);
 });
 it('rejects unsigned, tampered-route and replayed requests',async()=>{
  const {list}=fixtures();
  await expect(list('')).rejects.toBeInstanceOf(UnauthorizedException);
  await expect(list(signed('/inbox/instagram-pilot')))
   .rejects.toBeInstanceOf(UnauthorizedException);
  const token=signed('/inbox');
  await list(token);
  await expect(list(token)).rejects.toBeInstanceOf(UnauthorizedException);
 });
 it('rejects access when replica count is not one',async()=>{
  const {list}=fixtures();
  process.env.MW1_INTERNAL_REPLICA_COUNT='2';
  await expect(list()).rejects.toBeInstanceOf(UnauthorizedException);
  process.env.MW1_INTERNAL_REPLICA_COUNT='1';
 });
 it('pilot diagnostics require signed pilot tenant, membership and inbox.view',async()=>{
  const members=[
   {company_id:'pilot-company',user_id:USER_A,role_id:'role-pilot',active:true},
  ];
  const data={
   company_memberships:members,
   app_roles:[{id:'role-pilot',key:'advisor',company_id:'pilot-company'}],
   app_role_permissions:[{role_id:'role-pilot',permission_id:'p-view'}],
   mw1_instagram_staging_inbox:[{
    company_id:'pilot-company',provider_message_id:'fake-msg',sender_id:'fake',
    message_text:'Mensaje sintético',received_at:'2026-11-13T00:00:00Z',
   }],
  };
  const {pilot}=fixtures(data);
  const response=await pilot();
  expect(response.readOnly).toBe(true);
  expect(response.messages).toHaveLength(1);
  await expect(pilot(signed('/inbox/instagram-pilot',USER_A,COMPANY_A,'alfa')))
   .rejects.toBeInstanceOf(UnauthorizedException);
  const denied=fixtures({...data,app_role_permissions:[]});
  await expect(denied.pilot()).rejects.toBeInstanceOf(ForbiddenException);
 });
 it('reads only tagged synthetic conversation detail for an authorized member',async()=>{
  const qa={qa_fixture:'SEG003D-FUNCIONAL-20261114',synthetic:true};
  const {controller,reads}=fixtures({conversation_sessions:[
    {id:'fixture-one',company_id:COMPANY_A,customer_phone:'000000000101',
      stage:'open',context:qa,attention_status:'human',assigned_to_user_id:USER_A},
    {id:'fixture-two',company_id:COMPANY_B,customer_phone:'000000000101',
      stage:'open',context:qa,attention_status:'human',assigned_to_user_id:USER_B},
  ]});
  const result=await controller.detail('test-key',USER_A,COMPANY_A,'alfa',signed('/inbox/:sessionId'),'fixture-one');
  expect(result).toMatchObject({ok:true,synthetic:true,stagingReadOnly:true,historyRestricted:true});
  expect(result.session.companyId).toBe(COMPANY_A);
  expect(result.messages).toEqual([]);
  expect(reads.filter(x=>x.table==='conversation_sessions').at(-1)?.filters)
    .toEqual(expect.arrayContaining([['company_id',COMPANY_A],['id','fixture-one']]));
  await expect(controller.detail('test-key',USER_A,COMPANY_A,'alfa',signed('/inbox/:sessionId'),'fixture-two'))
    .rejects.toBeInstanceOf(ForbiddenException);
 });
 it('blocks untagged conversation detail and revoked/unsigned actors',async()=>{
  const {controller,reads}=fixtures();
  await expect(controller.detail('test-key',USER_A,COMPANY_A,'alfa',signed('/inbox/:sessionId'),'assigned'))
    .rejects.toBeInstanceOf(ForbiddenException);
  await expect(controller.detail('test-key',USER_A,COMPANY_A,'alfa','','assigned'))
    .rejects.toBeInstanceOf(UnauthorizedException);
  const revoked=fixtures({company_memberships:[]});
  await expect(revoked.controller.detail('test-key',USER_A,COMPANY_A,'alfa',signed('/inbox/:sessionId'),'assigned'))
    .rejects.toBeInstanceOf(ForbiddenException);
  expect(revoked.reads.some(x=>x.table==='conversation_sessions')).toBe(false);
 });
 it('pilot requires active membership, refuses alternate slug and does not send',async()=>{
  const {pilot,reads}=fixtures();
  await expect(pilot()).rejects.toBeInstanceOf(ForbiddenException);
  expect(reads.some(q=>q.table==='mw1_instagram_staging_inbox')).toBe(false);
  const {controller}=fixtures();
  expect((controller as any).sendMessage).toBeUndefined();
  expect((controller as any).transferConversation).toBeUndefined();
 });
});
