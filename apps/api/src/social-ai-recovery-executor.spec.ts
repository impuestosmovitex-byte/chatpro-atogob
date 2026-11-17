import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {SocialAiRecoveryExecutorService} from './social-ai-recovery-executor.service';

const ID='11111111-1111-4111-8111-111111111111';
const COMPANY='22222222-2222-4222-8222-222222222222';
const SESSION='33333333-3333-4333-8333-333333333333';
const CUTOFF='2026-11-16T22:00:00Z';
const NOW='2026-11-17T02:58:00Z';
const APPROVAL='EXPLICIT-APPROVAL-FROM-OPERATOR';
const input={
 companyId:COMPANY,sessionId:SESSION,
 lastInboundId:'99',cutoff:CUTOFF,approvalReference:APPROVAL,
};
const previousEnabled=process.env.MW1_SOCIAL_AI_RECOVERY_ENABLED;
const previousApproval=process.env.MW1_SOCIAL_AI_RECOVERY_APPROVAL_REF;

describe('MW1 controlled recovery executor (NO real API, Meta or client sends)',()=>{
 beforeEach(()=>{
  jest.useFakeTimers().setSystemTime(new Date(NOW));
  process.env.MW1_SOCIAL_AI_RECOVERY_ENABLED='true';
  process.env.MW1_SOCIAL_AI_RECOVERY_APPROVAL_REF=APPROVAL;
 });
 afterEach(()=>{
  jest.useRealTimers();
  if(previousEnabled===undefined)delete process.env.MW1_SOCIAL_AI_RECOVERY_ENABLED;
  else process.env.MW1_SOCIAL_AI_RECOVERY_ENABLED=previousEnabled;
  if(previousApproval===undefined)delete process.env.MW1_SOCIAL_AI_RECOVERY_APPROVAL_REF;
  else process.env.MW1_SOCIAL_AI_RECOVERY_APPROVAL_REF=previousApproval;
 });
 function makeHarness(){
  const latest={
   id:'99',company_id:COMPANY,session_id:SESSION,channel:'instagram',
   author_type:'customer',message_type:'text',
   message:'¿Cómo funcionan los envíos?',created_at:'2026-11-17T01:58:00Z',
  };
  let history:any[]=[latest];
  const calls:{name:string,args:any}[]=[];
  let allowBegin=true, allowReserve=true;
  let botMode:'send'|'fail_after_begin'|'fail_before_begin'|'suppress'='send';
  const preview={preview:jest.fn(async()=>({
   mode:'READ_ONLY_NO_SEND',
   companyAiConfiguration:{instructionsConfigured:true,instructionLength:8577,
    configuredSections:['shipping_rules','knowledge_base','commercial_flow']},
   decisions:[{sessionId:SESSION,lastInboundId:'99',eligible:true,channel:'instagram'}],
  }))};
  const integration={
   companyId:COMPANY,integrationType:'instagram',status:'active',externalId:'account-from-tenant',
   credentialsEncrypted:'encrypted-value',config:{setup_source:'instagram_login',api_version:'v25.0'},
  };
  const integrations={getActiveIntegration:jest.fn(async()=>integration)};
  const query=(table:string)=>{
   const q:any={
    select:()=>q,eq:()=>q,order:()=>q,
    maybeSingle:async()=>({data:{
     id:SESSION,company_id:COMPANY,channel:'instagram',
     attention_status:'ai',assigned_to_user_id:null,
     last_message_at:latest.created_at,external_customer_id:'customer-from-tenant',
    },error:null}),
    limit:async()=>({data:history,error:null}),
   };
   return q;
  };
  const rpc=jest.fn(async(name:string,args:any)=>{
   calls.push({name,args});
   if(name==='mw1_reserve_social_ai_recovery')
    return {data:allowReserve?ID:null,error:null};
   if(name==='mw1_begin_social_ai_recovery_send')
    return {data:allowBegin,error:null};
   if(name==='mw1_finish_social_ai_recovery')
    return {data:true,error:null};
   throw Error('Unexpected RPC: '+name);
  });
  const db={getClient:()=>({from:query,rpc})};
  const ai={
   replyToInstagram:jest.fn(async(args:any)=>{
    if(botMode==='fail_before_begin')throw Error('model billing issue');
    if(botMode==='suppress')return;
    await args.beforeRecoverySend();
    if(botMode==='fail_after_begin')throw Error('ambiguous Meta network timeout');
    args.onRecoverySubmitted('meta-sent-ack');
   }),
   replyToMessenger:jest.fn(async()=>{throw Error('unexpected Messenger send');}),
  };
  const service=new SocialAiRecoveryExecutorService(
    preview as any,integrations as any,db as any,ai as any);
  return {service,preview,integrations,db,rpc,ai,calls,
   setHistory:(messages:any[])=>{history=messages;},
   setBegin:(value:boolean)=>{allowBegin=value;},
   setReserve:(value:boolean)=>{allowReserve=value;},
   setBotMode:(v:typeof botMode)=>{botMode=v;},
  };
 }
 it('requires BOTH the explicit approval ref and opt-in environment flag',async()=>{
  const h=makeHarness();
  delete process.env.MW1_SOCIAL_AI_RECOVERY_ENABLED;
  await expect(h.service.executeApproved(input)).rejects.toThrow('deshabilitado');
  process.env.MW1_SOCIAL_AI_RECOVERY_ENABLED='true';
  await expect(h.service.executeApproved({...input,approvalReference:'unauthorized'}))
   .rejects.toThrow('deshabilitado');
  expect(h.preview.preview).not.toHaveBeenCalled();
  expect(h.ai.replyToInstagram).not.toHaveBeenCalled();
  expect(h.rpc).not.toHaveBeenCalled();
 });
 it('uses the CURRENT tenant profile via normal AI path and never alters AI rules',async()=>{
  const h=makeHarness();
  const result=await h.service.executeApproved(input);
  expect(result).toMatchObject({companyId:COMPANY,sessionId:SESSION,
   attemptId:ID,state:'submitted',providerAccepted:true});
  expect(h.preview.preview).toHaveBeenCalledWith(COMPANY,CUTOFF,expect.any(Date));
  expect(h.integrations.getActiveIntegration)
   .toHaveBeenCalledWith(COMPANY,'meta','instagram');
  expect(h.ai.replyToInstagram).toHaveBeenCalledTimes(1);
  expect(h.ai.replyToInstagram).toHaveBeenCalledWith(expect.objectContaining({
   companyId:COMPANY,sessionId:SESSION,instagramId:'account-from-tenant',
   recipientId:'customer-from-tenant',customerMessage:'¿Cómo funcionan los envíos?',
   credentialsEncrypted:'encrypted-value',
  }));
  expect(h.calls.map(x=>x.name)).toEqual([
   'mw1_reserve_social_ai_recovery',
   'mw1_begin_social_ai_recovery_send',
   'mw1_finish_social_ai_recovery',
  ]);
  expect(h.calls[2].args).toMatchObject({
   p_state:'submitted',p_provider_message_id:'meta-sent-ack',p_failure_code:null,
  });
 });
 it('suppresses any second send when the session already has a durable claim',async()=>{
  const h=makeHarness();
  h.setReserve(false);
  expect(await h.service.executeApproved(input)).toMatchObject({
   state:'already_reserved',providerAccepted:false,attemptId:null,
  });
  expect(h.ai.replyToInstagram).not.toHaveBeenCalled();
  expect(h.calls.map(x=>x.name)).toEqual(['mw1_reserve_social_ai_recovery']);
 });
 it('cancels when the customer or human changed the conversation during generation',async()=>{
  const h=makeHarness();
  h.setBegin(false);
  expect(await h.service.executeApproved(input)).toMatchObject({
   state:'cancelled',providerAccepted:false,
  });
  expect(h.calls[2].args.p_state).toBe('cancelled');
  expect(h.calls[2].args.p_failure_code).toBe('SESSION_CHANGED_BEFORE_SEND');
 });
 it('marks an ambiguous Meta timeout NEEDS_REVIEW, never retries automatically',async()=>{
  const h=makeHarness();
  h.setBotMode('fail_after_begin');
  expect(await h.service.executeApproved(input)).toMatchObject({
   state:'needs_review',providerAccepted:false,
  });
  expect(h.calls[2].args).toMatchObject({
   p_state:'needs_review',p_failure_code:'UNCONFIRMED_EXTERNAL_DELIVERY',
  });
  expect(h.ai.replyToInstagram).toHaveBeenCalledTimes(1);
 });
 it('does not retry automatically when the language model fails before sending',async()=>{
  const h=makeHarness();
  h.setBotMode('fail_before_begin');
  expect(await h.service.executeApproved(input)).toMatchObject({
   state:'needs_review',providerAccepted:false,
  });
  expect(h.calls.map(x=>x.name)).toEqual([
   'mw1_reserve_social_ai_recovery','mw1_finish_social_ai_recovery',
  ]);
  expect(h.calls[1].args.p_failure_code).toBe('MODEL_OR_PRE_SEND_FAILURE');
 });
 it('does not force a prohibited or suppressed external response',async()=>{
  const h=makeHarness();
  h.setBotMode('suppress');
  expect(await h.service.executeApproved(input)).toMatchObject({
   state:'suppressed',providerAccepted:false,
  });
  expect(h.calls.map(x=>x.name)).toEqual([
   'mw1_reserve_social_ai_recovery','mw1_finish_social_ai_recovery',
  ]);
  expect(h.calls[1].args.p_state).toBe('suppressed');
 });
 it('skips if history changed or an attached image prevents safe text-only replay',async()=>{
  const h=makeHarness();
  h.setHistory([
   {id:'99',company_id:COMPANY,session_id:SESSION,
    channel:'instagram',author_type:'customer',message_type:'image',
    message:'Imagen recibida.',created_at:'2026-11-17T01:58:00Z'},
  ]);
  expect(await h.service.executeApproved(input)).toMatchObject({state:'not_eligible'});
  expect(h.rpc).not.toHaveBeenCalled();
  expect(h.ai.replyToInstagram).not.toHaveBeenCalled();
 });
 it('records in a service-role-only DB table rather than relying on process memory',()=>{
  const migration=readFileSync(join(__dirname,'../../../supabase/migrations/202611160003_mw1_social_ai_recovery_attempts_draft.sql'),'utf8');
  expect(migration).toContain('unique (company_id,session_id)');
  expect(migration).toContain('enable row level security');
  expect(migration).toContain('from public,anon,authenticated');
  expect(migration).toContain('to service_role');
  expect(migration).toContain('security invoker');
  expect(migration).toContain('for update');
  expect(migration).toContain("now()-interval '23 hours'");
  expect(migration).toContain('on conflict (company_id,session_id) do nothing');
  expect(migration).not.toMatch(/create (?:trigger|event trigger)/i);
  const app=readFileSync(join(__dirname,'app.module.ts'),'utf8');
  expect(app).toContain('SocialAiRecoveryExecutorService,');
  const executor=readFileSync(join(__dirname,'social-ai-recovery-executor.service.ts'),'utf8');
  expect(executor).not.toMatch(/@Controller\(|@Cron\(|@Interval\(/);
  expect(executor).toContain('MW1_SOCIAL_AI_RECOVERY_ENABLED');
  expect(executor).toContain('MW1_SOCIAL_AI_RECOVERY_APPROVAL_REF');
  const social=readFileSync(join(__dirname,'meta-social-ai.service.ts'),'utf8');
  expect(social).toContain('getCompanyProfileById(');
  expect(social).toContain('chatAgentService.reply(');
  expect(social).toContain('await input.beforeRecoverySend?.()');
  expect(social).toContain('input.onRecoverySubmitted?.(providerMessageId)');
 });
});
