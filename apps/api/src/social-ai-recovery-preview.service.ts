import { Injectable } from '@nestjs/common';
import { SupabaseService } from './supabase.service';
import { ConversationMemoryService } from './conversation-memory.service';
import { CompanyIntegrationService } from './company-integration.service';

/**
 * READ-ONLY recovery audit.  NO Meta sends, AI completions, inserts, updates,
 * replays or synthetic webhook calls.  Production is never called by this
 * class automatically.  An outbound executor requires separate approval,
 * a persisted idempotent reservation and a fresh last-message check.
 *
 * Per-company AI instructions are loaded from ConversationMemoryService:
 * company_settings.ai_instructions and company_settings.settings. A future
 * send must use the existing MetaSocialAiService.replyToInstagram/Messenger
 * pathway, which calls ChatAgentService.reply with that live company profile,
 * product tools, current policies and the original commercial session.
 */
export type RecoveryChannel = 'instagram' | 'messenger';
type RecoverySession = {
  id: string;
  company_id: string;
  channel: string;
  attention_status: string;
  assigned_to_user_id: string | null;
  last_message_at: string;
};
export type RecoveryMessage = {
  id: string;
  company_id: string;
  session_id: string;
  channel: string;
  author_type: string;
  message_type: string;
  message: string | null;
  created_at: string;
};
export type RecoveryReason =
  | 'ready' | 'outside_window' | 'already_handled'
  | 'human_intervention' | 'not_ai' | 'assigned'
  | 'unsupported_channel' | 'media_needs_review'
  | 'missing_text' | 'history_truncated' | 'company_mismatch'
  | 'integration_inactive' | 'company_instructions_missing';
export type RecoveryDecision = {
  sessionId: string;
  companyId: string;
  channel: string;
  reason: RecoveryReason;
  eligible: boolean;
  lastInboundId: string | null;
  lastInboundAt: string | null;
  inboundTextParts: number;
  // Preview intentionally contains no customer message text or credentials.
  replayKey: string | null;
};
const DURATION_23_HOURS = 23 * 60 * 60 * 1000;
const MAX_MESSAGE_SCAN = 60;

export function assessSocialAiRecovery(
  session: RecoverySession,
  messages: RecoveryMessage[],
  cutoff: Date,
  now: Date,
): RecoveryDecision {
  const sorted = [...messages].sort((a,b) =>
    Date.parse(b.created_at)-Date.parse(a.created_at) || b.id.localeCompare(a.id));
  const last = sorted[0];
  const reject = (reason: RecoveryReason): RecoveryDecision => ({
    sessionId: session.id, companyId: session.company_id,
    channel: session.channel, reason, eligible:false,
    lastInboundId: last?.author_type === 'customer' ? last.id : null,
    lastInboundAt: last?.author_type === 'customer' ? last.created_at : null,
    inboundTextParts:0, replayKey:null,
  });
  if (!['instagram','messenger'].includes(session.channel)) return reject('unsupported_channel');
  if (session.attention_status !== 'ai') return reject('not_ai');
  if (session.assigned_to_user_id) return reject('assigned');
  if (messages.length >= MAX_MESSAGE_SCAN) return reject('history_truncated');
  if (sorted.some(m => m.company_id !== session.company_id ||
                       m.session_id !== session.id || m.channel !== session.channel))
    return reject('company_mismatch');
  if (!last || last.author_type !== 'customer') return reject('already_handled');
  const lastTime = Date.parse(last.created_at);
  if (!Number.isFinite(lastTime) || lastTime < cutoff.getTime() ||
      lastTime > now.getTime() || now.getTime()-lastTime >= DURATION_23_HOURS)
    return reject('outside_window');
  // Never re-message a conversation where a human/AI response was already
  // attempted/recorded after the outage began, even if the customer wrote again.
  if (sorted.some(m => Date.parse(m.created_at)>=cutoff.getTime()
       && (m.author_type === 'advisor' || m.author_type === 'assistant')))
    return reject('human_intervention');
  const consecutive: RecoveryMessage[] = [];
  for (const message of sorted) {
    if (message.author_type !== 'customer') break;
    if (!['text','postback'].includes(message.message_type) ||
        !message.message?.trim())
      return reject('media_needs_review');
    consecutive.push(message);
  }
  if (!consecutive.length || consecutive.length>12)
    return reject('missing_text');
  const replayKey = `${session.company_id}:${session.id}:${last.id}`;
  return {
    sessionId:session.id,companyId:session.company_id,channel:session.channel,
    reason:'ready',eligible:true,lastInboundId:last.id,
    lastInboundAt:last.created_at,inboundTextParts:consecutive.length,replayKey,
  };
}

@Injectable()
export class SocialAiRecoveryPreviewService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly memory: ConversationMemoryService,
    private readonly integrations: CompanyIntegrationService,
  ) {}

  async preview(companyId: string, cutoffInput: string, now = new Date()) {
    if (!companyId?.trim()) throw new Error('Empresa requerida.');
    const cutoff=new Date(cutoffInput);
    if (!Number.isFinite(cutoff.getTime()) || cutoff.getTime() > now.getTime())
      throw new Error('Fecha inicial inválida.');
    // Read the CURRENT company-specific profile and configuration.
    // Never copy ATOGOB's rules to another tenant, or store prompt text here.
    const profile=await this.memory.getCompanyProfileById(companyId);
    if (profile.id !== companyId) throw new Error('Aislamiento de empresa inválido.');
    const instructionConfigured=Boolean(profile.aiInstructions?.trim());
    const sections=Object.keys(profile.settings || {}).sort();
    const {data:sessions,error}=await this.supabase.getClient()
      .from('social_conversation_sessions')
      .select('id,company_id,channel,attention_status,assigned_to_user_id,last_message_at')
      .eq('company_id',companyId).eq('attention_status','ai')
      .gte('last_message_at',cutoff.toISOString())
      .order('last_message_at',{ascending:false}).limit(100);
    if(error)throw new Error('No se pudo revisar las conversaciones pendientes.');
    const activeChannels=new Set<RecoveryChannel>();
    for(const channel of ['instagram','messenger'] as const){
      const active=await this.integrations.getActiveIntegration(companyId,'meta',channel);
      if(active && active.companyId===companyId)activeChannels.add(channel);
    }
    const decisions:RecoveryDecision[]=[];
    for(const session of (sessions || []) as RecoverySession[]){
      if (session.company_id !== companyId) throw new Error('Sesión de otra empresa.');
      const {data:messages,error:messageError}=await this.supabase.getClient()
        .from('social_conversations')
        .select('id,company_id,session_id,channel,author_type,message_type,message,created_at')
        .eq('company_id',companyId).eq('session_id',session.id)
        .order('created_at',{ascending:false}).limit(MAX_MESSAGE_SCAN);
      if(messageError)throw new Error('No se pudo verificar el historial de la sesión.');
      let decision=assessSocialAiRecovery(session,(messages || []) as RecoveryMessage[],cutoff,now);
      if(decision.eligible && !instructionConfigured)
        decision={...decision,eligible:false,reason:'company_instructions_missing',replayKey:null};
      if(decision.eligible && !activeChannels.has(session.channel as RecoveryChannel))
        decision={...decision,eligible:false,reason:'integration_inactive',replayKey:null};
      decisions.push(decision);
    }
    return {
      mode:'READ_ONLY_NO_SEND' as const,
      companyId,cutoff:cutoff.toISOString(),now:now.toISOString(),
      companyAiConfiguration:{instructionsConfigured:instructionConfigured,
        instructionLength:profile.aiInstructions?.length||0,configuredSections:sections},
      reviewed:decisions.length,ready:decisions.filter(x=>x.eligible).length,
      decisions,
    };
  }
}
