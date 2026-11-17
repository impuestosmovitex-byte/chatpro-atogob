import { Injectable } from '@nestjs/common';
import { CompanyIntegrationService } from './company-integration.service';
import { MetaSocialAiService } from './meta-social-ai.service';
import { SupabaseService } from './supabase.service';
import {
  assessSocialAiRecovery,
  RecoveryMessage,
  SocialAiRecoveryPreviewService,
} from './social-ai-recovery-preview.service';

type Channel = 'instagram' | 'messenger';
type RetryState =
  | 'not_eligible' | 'already_reserved' | 'submitted'
  | 'suppressed' | 'cancelled' | 'needs_review';
type RetryResult = {
  companyId: string;
  sessionId: string;
  state: RetryState;
  // Never return generated reply text, integration tokens, or prompts.
  attemptId: string | null;
  providerAccepted: boolean;
};
type SessionRow = {
  id: string;
  company_id: string;
  channel: Channel;
  attention_status: string;
  assigned_to_user_id: string | null;
  last_message_at: string;
  external_customer_id: string;
};

class ObsoleteRecoveryAttempt extends Error {
  constructor() { super('La conversación cambió antes del envío.'); }
}

/**
 * Intentionally NO controller, cron or automatic job. Executor remains disabled
 * unless its dedicated server-side feature flag and approval reference are
 * configured following a separate authorization. No live env is changed here.
 *
 * Readiness -> durable atomic reservation -> tenant-specific existing AI engine
 * -> fresh SQL checkpoint just before Meta -> audited result. A network
 * timeout/uncertain send is NEVER retried automatically.
 *
 * The normal ChatAgentService is the one called from MetaSocialAiService, and
 * it loads the tenant's CURRENT company_settings.ai_instructions, settings,
 * catalog tools, policies and commercial session on every response.
 */
@Injectable()
export class SocialAiRecoveryExecutorService {
  constructor(
    private readonly preview: SocialAiRecoveryPreviewService,
    private readonly integrations: CompanyIntegrationService,
    private readonly db: SupabaseService,
    private readonly socialAi: MetaSocialAiService,
  ) {}

  async executeApproved(input: {
    companyId: string;
    sessionId: string;
    lastInboundId: string;
    cutoff: string;
    approvalReference: string;
  }): Promise<RetryResult> {
    const configuredApproval=process.env.MW1_SOCIAL_AI_RECOVERY_APPROVAL_REF?.trim();
    if (process.env.MW1_SOCIAL_AI_RECOVERY_ENABLED !== 'true' ||
        !configuredApproval || input.approvalReference !== configuredApproval) {
      throw new Error('Reintento deshabilitado: falta autorización operativa.');
    }
    // Runtime checkpoint 1: no already answered, human-taken, media or old DM.
    const now=new Date();
    const audit=await this.preview.preview(input.companyId,input.cutoff,now);
    const candidate=audit.decisions.find(x=>x.sessionId===input.sessionId);
    if (!candidate?.eligible || String(candidate.lastInboundId)!==input.lastInboundId) {
      return this.result(input,'not_eligible');
    }
    const channel=candidate.channel as Channel;
    const integration=await this.integrations.getActiveIntegration(
      input.companyId,'meta',channel,
    );
    if (!integration || integration.companyId !== input.companyId ||
        integration.integrationType!==channel || integration.status!=='active')
      return this.result(input,'not_eligible');

    const client=this.db.getClient();
    const {data:session,error:sessionError}=await client
      .from('social_conversation_sessions')
      .select('id,company_id,channel,attention_status,assigned_to_user_id,last_message_at,external_customer_id')
      .eq('id',input.sessionId).eq('company_id',input.companyId).maybeSingle();
    if(sessionError)throw new Error('Error al revalidar la sesión de recuperación.');
    const row=session as SessionRow|null;
    if(!row || row.company_id!==input.companyId || row.channel!==channel ||
       !row.external_customer_id) return this.result(input,'not_eligible');

    const {data:messages,error:messagesError}=await client
      .from('social_conversations')
      .select('id,company_id,session_id,channel,author_type,message_type,message,created_at')
      .eq('company_id',input.companyId).eq('session_id',input.sessionId)
      .order('created_at',{ascending:false}).limit(60);
    if(messagesError)throw new Error('No se pudo verificar el historial actualizado.');
    const history=(messages||[]) as RecoveryMessage[];
    const renewed=assessSocialAiRecovery(row,history,new Date(input.cutoff),new Date());
    if(!renewed.eligible || String(renewed.lastInboundId)!==input.lastInboundId)
      return this.result(input,'not_eligible');
    const missed=history.filter(x=>x.author_type==='customer' &&
      Date.parse(x.created_at)>=Date.parse(input.cutoff));
    if(missed.length<1 || missed.length>12 ||
       missed.some(x=>!['text','postback'].includes(x.message_type) ||
       !x.message?.trim()))return this.result(input,'not_eligible');
    // One response for the whole burst, using the *original* messages, with
    // current business instructions supplied by the standard AI engine.
    const grouped=missed
      .sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at))
      .map(x=>x.message!.trim()).join('\n').slice(0,8000);
    if(!grouped.trim())return this.result(input,'not_eligible');

    // Runtime checkpoint 2: atomic server-side one-time reservation. SQL
    // validates the latest inbound, no takeover, live instructions/integration.
    const {data:attemptId,error:reserveError}=await client.rpc(
      'mw1_reserve_social_ai_recovery',{
        p_company_id:input.companyId,
        p_session_id:input.sessionId,
        p_last_inbound_id:input.lastInboundId,
        p_cutoff:new Date(input.cutoff).toISOString(),
      });
    if(reserveError)throw new Error('No se pudo registrar el intento único.');
    if(typeof attemptId!=='string' || !attemptId)
      return this.result(input,'already_reserved');

    let begun=false;
    let submitted=false;
    let providerMessageId:string|null=null;
    const beforeRecoverySend=async()=>{
      // Runtime checkpoint 3: runs AFTER the model's response was composed,
      // right before Meta. No human response/new inbound or expired 23h window.
      const {data,error}=await client.rpc('mw1_begin_social_ai_recovery_send',{
        p_attempt_id:attemptId,
      });
      if(error || data!==true)throw new ObsoleteRecoveryAttempt();
      begun=true;
    };
    const onRecoverySubmitted=(id:string|null)=>{
      submitted=true; providerMessageId=id;
    };
    let state:'submitted'|'suppressed'|'cancelled'|'needs_review';
    let failureCode:string|null=null;
    try {
      if(channel==='instagram'){
        await this.socialAi.replyToInstagram({
          companyId:input.companyId,
          instagramId:integration.externalId,
          sessionId:input.sessionId,
          recipientId:row.external_customer_id,
          customerMessage:grouped,
          credentialsEncrypted:integration.credentialsEncrypted,
          setupSource:typeof integration.config.setup_source==='string'
            ?integration.config.setup_source:'',
          apiVersion:typeof integration.config.api_version==='string'
            ?integration.config.api_version:'',
          beforeRecoverySend,onRecoverySubmitted,
        });
      }else{
        await this.socialAi.replyToMessenger({
          companyId:input.companyId,
          pageId:integration.externalId,
          sessionId:input.sessionId,
          recipientId:row.external_customer_id,
          customerMessage:grouped,
          credentialsEncrypted:integration.credentialsEncrypted,
          beforeRecoverySend,onRecoverySubmitted,
        });
      }
      state=submitted && begun ? 'submitted'
        : begun ? 'needs_review' : 'suppressed';
      if(state==='needs_review')failureCode='AI_RETURNED_AFTER_BEGIN_WITHOUT_ACK';
    }catch(error){
      if(error instanceof ObsoleteRecoveryAttempt && !begun){
        state='cancelled'; failureCode='SESSION_CHANGED_BEFORE_SEND';
      }else{
        // Could have reached Meta. NEVER auto-retry even if HTTP failed.
        state='needs_review';failureCode=begun
          ? 'UNCONFIRMED_EXTERNAL_DELIVERY' : 'MODEL_OR_PRE_SEND_FAILURE';
      }
    }
    const {data:finished,error:finishError}=await client.rpc(
      'mw1_finish_social_ai_recovery',{
        p_attempt_id:attemptId,
        p_state:state,
        p_provider_message_id:providerMessageId,
        p_failure_code:failureCode,
      });
    if(finishError || finished!==true)
      throw new Error('Resultado incierto: revisar manualmente el registro único de reintento.');
    return {
      ...this.result(input,state),attemptId,
      providerAccepted:submitted && begun,
    };
  }

  private result(
    input:{companyId:string;sessionId:string},
    state:RetryState,
  ):RetryResult{
    return {
      companyId:input.companyId,sessionId:input.sessionId,
      state,attemptId:null,providerAccepted:false,
    };
  }
}
