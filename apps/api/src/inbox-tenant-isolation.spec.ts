import {InboxController} from './inbox.controller';
import {ConversationMemoryService} from './conversation-memory.service';
import {SupabaseService} from './supabase.service';
import {WhatsappMessagingService} from './whatsapp-messaging.service';
import {ChatAgentService} from './chat-agent.service';
import {MetaSocialInboxService} from './meta-social-inbox.service';
import {MetaSocialMessagingService} from './meta-social-messaging.service';

describe('Staging cross-company inbox authorization',()=>{
 const oldKey=process.env.CHATPRO_INBOX_KEY;
 const internalKey='local-isolation-fixture';
 const companyA={id:'company-a-id',slug:'company-a',name:'Demo A'};
 const companyB={id:'company-b-id',slug:'company-b',name:'Demo B'};
 let queried:string[]=[];
 const perms={
  from:(table:string)=>{
   queried.push(table);
   if(table==='company_memberships'){
    return {select:()=>({eq:(field:string,company:string)=>({
     eq:(_userField:string,user:string)=>({
      maybeSingle:async()=>({data:
       (company===companyA.id&&user==='user-a')||(company===companyB.id&&user==='user-b')
        ?{role_id:'role-owner',active:true}:null,error:null})
     })
    })})};
   }
   if(table==='app_role_permissions'){
    return {select:()=>({eq:()=>Promise.resolve({data:[{permission_id:'permission-inbox-view'}],error:null})})};
   }
   if(table==='app_permissions'){
    return {select:()=>({in:()=>Promise.resolve({data:[{key:'inbox.view'}],error:null})})};
   }
   throw new Error('Unexpected access '+table);
  }
 };
 const getProfile=async(slug:string)=>slug==='company-a'?companyA:companyB;
 const memory={
  getCompanyProfile:getProfile,
  listInboxSessions:async()=>({sessions:[],pendingTotal:0}),
  getInboxConversation:async(slug:string,_id:string)=>({
   company:await getProfile(slug),
   session:{id:'session-b',attentionStatus:'ai'},
   messages:[{body:'SENSITIVE_CUSTOMER_B'}],
   contact:null,
  }),
 };
 const social={listSessions:async()=>[],getConversation:async()=>null};
 const controller=new InboxController(
  memory as unknown as ConversationMemoryService,
  {getClient:()=>perms} as unknown as SupabaseService,
  {} as WhatsappMessagingService,{} as ChatAgentService,
  social as unknown as MetaSocialInboxService,
  {} as MetaSocialMessagingService,
 );
 beforeEach(()=>{process.env.CHATPRO_INBOX_KEY=internalKey;queried=[];});
 afterAll(()=>{if(oldKey===undefined)delete process.env.CHATPRO_INBOX_KEY;
  else process.env.CHATPRO_INBOX_KEY=oldKey;});
 it('rejects user A attempting to list company B with a forged company parameter',async()=>{
  await expect(controller.list(internalKey,'user','user-a','Advisor A',companyA.id,'owner',
   companyB.slug,'all','20','0','','')).rejects.toThrow();
  expect(queried).toContain('company_memberships');
  expect(queried).not.toContain('app_role_permissions');
 });
 it('rejects user A attempting to read company B conversation by identifier',async()=>{
  await expect(controller.getConversation(internalKey,'user','user-a','Advisor A',
    companyA.id,'owner',companyB.slug,'','','','session-b')).rejects.toThrow();
  expect(queried).toContain('company_memberships');
 });
 it('does not let platform administrator session impersonate a tenant owner',async()=>{
  await expect(controller.list(internalKey,'platform','admin','Admin',companyA.id,
   'owner',companyA.slug,'all','20','0','','')).rejects.toThrow();
 });
 it('does not let a revoked user read their own company inbox',async()=>{
  await expect(controller.list(internalKey,'user','revoked-user','Advisor',companyA.id,
   'owner',companyA.slug,'all','20','0','','')).rejects.toThrow();
 });
 it('requires internal authentication before reading any company',async()=>{
  await expect(controller.list('invalid','user','user-a','Advisor A',companyA.id,
   'owner',companyA.slug,'all','20','0','','')).rejects.toThrow();
  expect(queried).toEqual([]);
 });
});
