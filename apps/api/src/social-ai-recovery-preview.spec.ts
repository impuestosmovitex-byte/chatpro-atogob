import {assessSocialAiRecovery,SocialAiRecoveryPreviewService,RecoveryMessage} from './social-ai-recovery-preview.service';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

const NOW=new Date('2026-11-17T02:44:00Z');
const CUTOFF=new Date('2026-11-16T22:00:00Z');
const companyId='test-company-one',sessionId='session-one';
const session={id:sessionId,company_id:companyId,channel:'instagram',
 attention_status:'ai',assigned_to_user_id:null,last_message_at:'2026-11-17T01:58:09Z'};
const incoming=(patch:Partial<RecoveryMessage>={}):RecoveryMessage=>({
 id:'inbound-001',company_id:companyId,session_id:sessionId,
 channel:'instagram',author_type:'customer',message_type:'text',
 message:'¿Cómo funcionan las entregas?',created_at:'2026-11-17T01:58:09Z',...patch,
});

describe('MW1 social AI recovery dry run',()=>{
 it('finds a valid unanswered in-window customer message once without generating a reply',()=>{
  const d=assessSocialAiRecovery(session,[incoming()],CUTOFF,NOW);
  expect(d).toMatchObject({eligible:true,reason:'ready',lastInboundId:'inbound-001',
   companyId,channel:'instagram',inboundTextParts:1,
   replayKey:'test-company-one:session-one:inbound-001'});
 });
 it('skips an already answered or advisor-taken conversation',()=>{
  const answer=incoming({id:'reply-002',author_type:'assistant',
    created_at:'2026-11-17T02:00:00Z'});
  expect(assessSocialAiRecovery(session,[incoming(),answer],CUTOFF,NOW).reason).toBe('already_handled');
  expect(assessSocialAiRecovery({...session,attention_status:'human'},[incoming()],CUTOFF,NOW).reason).toBe('not_ai');
  expect(assessSocialAiRecovery({...session,assigned_to_user_id:'advisor1'},[incoming()],CUTOFF,NOW).reason).toBe('assigned');
 });
 it('marks advisor intervention since the outage for manual review even after new customer text',()=>{
  const human=incoming({id:'advisor-007',author_type:'advisor',created_at:'2026-11-17T01:49:00Z'});
  expect(assessSocialAiRecovery(session,[human,incoming()],CUTOFF,NOW).reason).toBe('human_intervention');
 });
 it('rejects outside messaging window, images, other companies, and long histories',()=>{
  expect(assessSocialAiRecovery(session,[incoming({created_at:'2026-11-16T01:00:00Z'})],
   new Date('2026-11-15T23:00:00Z'),NOW).reason).toBe('outside_window');
  expect(assessSocialAiRecovery(session,[incoming({message_type:'image'})],CUTOFF,NOW).reason).toBe('media_needs_review');
  expect(assessSocialAiRecovery(session,[incoming({company_id:'different-tenant'})],CUTOFF,NOW).reason).toBe('company_mismatch');
  expect(assessSocialAiRecovery(session,Array.from({length:60},(_,i)=>
   incoming({id:'inbound-'+i})),CUTOFF,NOW).reason).toBe('history_truncated');
 });
 it('combines consecutive customer texts as one recovery and avoids media mixtures',()=>{
  const older=incoming({id:'inbound-000',message:'Primero el saludo',
   created_at:'2026-11-17T01:57:30Z'});
  const d=assessSocialAiRecovery(session,[older,incoming()],CUTOFF,NOW);
  expect(d).toMatchObject({eligible:true,inboundTextParts:2});
  expect(assessSocialAiRecovery(session,[older,incoming({message_type:'text'}),incoming({
   id:'inbound-image',message_type:'image',created_at:'2026-11-17T01:57:00Z',
  })],CUTOFF,NOW).eligible).toBe(false);
 });
 it('reads the current specific tenant instructions and checks only its active integration',async()=>{
  const tableReads:string[]=[];
  const makeQuery=(table:string)=>{
   const q:any={
    select:()=>q,eq:()=>q,gte:()=>q,order:()=>q,
    limit:async()=>({data:table==='social_conversation_sessions'?[session]:
     table==='social_conversations'?[incoming()]:[],error:null}),
   };
   return q;
  };
  const supabase={getClient:()=>({from:(table:string)=>{
   tableReads.push(table);return makeQuery(table);
  }})};
  const getCompanyProfileById=jest.fn(async (id:string)=>({
   id,slug:'tenant',name:'Tenant '+id,assistantName:'Asistente '+id,
   aiInstructions:'Reglas específicas y actuales de '+id,
   settings:{shipping_rules:{},commercial_flow:{},knowledge_base:{}},
  }));
  const getActiveIntegration=jest.fn(async (id:string,provider:string,channel:string)=>({
   companyId:id,integrationType:channel,status:'active',
  }));
  const service=new SocialAiRecoveryPreviewService(supabase as any,
   {getCompanyProfileById} as any,{getActiveIntegration} as any);
  const p=await service.preview(companyId,CUTOFF.toISOString(),NOW);
  expect(p.mode).toBe('READ_ONLY_NO_SEND');
  expect(p.ready).toBe(1);
  expect(p.companyAiConfiguration.instructionsConfigured).toBe(true);
  expect(p.companyAiConfiguration.configuredSections).toContain('shipping_rules');
  expect(getCompanyProfileById).toHaveBeenCalledWith(companyId);
  expect(getActiveIntegration).toHaveBeenCalledWith(companyId,'meta','instagram');
  expect(getActiveIntegration).toHaveBeenCalledWith(companyId,'meta','messenger');
  expect(tableReads).toEqual(['social_conversation_sessions','social_conversations']);
  expect(JSON.stringify(p)).not.toContain('Reglas específicas y actuales');
 });
 it('never sends with missing custom rules or an inactive integration',async()=>{
  const q=(table:string)=>{
   const chain:any={select:()=>chain,eq:()=>chain,gte:()=>chain,order:()=>chain,
    limit:async()=>({data:table==='social_conversation_sessions'?[session]:[incoming()],error:null})};
   return chain;
  };
  const s={getClient:()=>({from:q})};
  const profile={id:companyId,aiInstructions:'',settings:{}};
  const service=new SocialAiRecoveryPreviewService(s as any,
   {getCompanyProfileById:async()=>profile} as any,
   {getActiveIntegration:async()=>null} as any);
  const result=await service.preview(companyId,CUTOFF.toISOString(),NOW);
  expect(result.ready).toBe(0);
  expect(result.decisions[0].reason).toBe('company_instructions_missing');
 });
 it('has no writes, external sends, model calls, or payment operations in the read-only preview',()=>{
  const source=readFileSync(join(__dirname,'social-ai-recovery-preview.service.ts'),'utf8');
  expect(source).not.toMatch(/\.(?:insert|upsert|update|delete)\(/);
  expect(source).not.toMatch(/\.(?:sendInstagramText|sendMessengerText|replyToInstagram|replyToMessenger|reply)\(/);
  expect(source).not.toMatch(/fetch\(/);
  expect(source).toContain('company_settings.ai_instructions');
  expect(source).toContain('current company-specific profile');
 });
});
