import { Injectable } from '@nestjs/common';
import {
  ConversationMemoryService,
  type AttentionStatus,
  type ConversationSession,
} from './conversation-memory.service';
import { SupabaseService } from './supabase.service';

type JsonObject = Record<string, unknown>;
type SocialChannel = 'instagram' | 'messenger';

type SessionPatch = {
  stage?: string;
  context?: JsonObject;
};

type HandoffInput = {
  reason?: string;
  summary?: string;
};

@Injectable()
export class AgentSessionRuntimeService {
  constructor(
    private readonly conversationMemoryService: ConversationMemoryService,
    private readonly supabaseService: SupabaseService,
  ) {}

  async getSessionById(
    sessionId: string,
  ): Promise<ConversationSession> {
    const socialRow =
      await this.getSocialSessionRow(sessionId);

    if (socialRow) {
      return this.toSocialSession(socialRow);
    }

    return this.conversationMemoryService.getSessionById(
      sessionId,
    );
  }

  async updateSession(
    sessionId: string,
    patch: SessionPatch,
  ): Promise<ConversationSession> {
    const socialRow =
      await this.getSocialSessionRow(sessionId);

    if (!socialRow) {
      return this.conversationMemoryService.updateSession(
        sessionId,
        patch,
      );
    }

    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (patch.stage !== undefined) {
      update.agent_stage =
        patch.stage.trim() || 'active';
    }

    if (patch.context !== undefined) {
      update.agent_context = patch.context;
    }

    const { error } = await this.supabaseService
      .getClient()
      .from('social_conversation_sessions')
      .update(update)
      .eq('id', sessionId)
      .eq('company_id', String(socialRow.company_id));

    if (error) {
      throw new Error(
        `No se pudo actualizar el estado comercial social: ${error.message}`,
      );
    }

    return this.getSessionById(sessionId);
  }

  async requestHumanAttention(
    sessionId: string,
    handoff: HandoffInput = {},
  ): Promise<ConversationSession> {
    const socialRow =
      await this.getSocialSessionRow(sessionId);

    if (!socialRow) {
      return this.conversationMemoryService.requestHumanAttention(
        sessionId,
        handoff,
      );
    }

    const session =
      this.toSocialSession(socialRow);

    const now = new Date().toISOString();

    const reason =
      typeof handoff.reason === 'string' &&
      handoff.reason.trim()
        ? handoff.reason.trim().slice(0, 500)
        : 'Requiere atención de un asesor.';

    const summary =
      typeof handoff.summary === 'string' &&
      handoff.summary.trim()
        ? handoff.summary.trim().slice(0, 1800)
        : 'Revisa el último mensaje del cliente y continúa la atención.';

    const nextContext: JsonObject = {
      ...session.context,
      handoff: {
        reason,
        summary,
        created_at: now,
        status: 'pending',
      },
    };

    const { error } = await this.supabaseService
      .getClient()
      .from('social_conversation_sessions')
      .update({
        agent_context: nextContext,
        attention_status: 'waiting',
        assigned_to_user_id: null,
        assigned_to_name: null,
        taken_at: null,
        closed_at: null,
        pending_count: Math.max(
          1,
          session.pendingCount,
        ),
        pending_since:
          session.pendingSince || now,
        updated_at: now,
      })
      .eq('id', sessionId)
      .eq('company_id', session.companyId);

    if (error) {
      throw new Error(
        `No se pudo transferir la conversación social a atención humana: ${error.message}`,
      );
    }

    return this.getSessionById(sessionId);
  }

  async releaseInactiveHumanForIncoming(
    session: ConversationSession,
    idleHours: number,
  ): Promise<ConversationSession> {
    if (this.isSocialSession(session)) {
      return session;
    }

    return this.conversationMemoryService.releaseInactiveHumanForIncoming(
      session,
      idleHours,
    );
  }

  async hasPreviousAssistantIdentityMention(
    companyId: string,
    customerIdentity: string,
    assistantIdentity: string,
  ): Promise<boolean> {
    const socialIdentity =
      this.parseSocialIdentity(customerIdentity);

    if (!socialIdentity) {
      return this.conversationMemoryService
        .hasPreviousAssistantIdentityMention(
          companyId,
          customerIdentity,
          assistantIdentity,
        );
    }

    const { data, error } = await this.supabaseService
      .getClient()
      .from('social_conversations')
      .select('message')
      .eq('company_id', companyId)
      .eq('channel', socialIdentity.channel)
      .eq(
        'external_customer_id',
        socialIdentity.externalCustomerId,
      )
      .in('author_type', ['assistant', 'ai'])
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      return false;
    }

    const needle =
      assistantIdentity
        .trim()
        .toLocaleLowerCase('es');

    if (!needle) {
      return false;
    }

    return (data ?? []).some((row) => {
      const message =
        typeof row.message === 'string'
          ? row.message
          : '';

      return message
        .toLocaleLowerCase('es')
        .includes(needle);
    });
  }

  async getRecentMessages(
    sessionId: string,
    limit = 12,
  ): Promise<Array<{
    sender: string;
    message: string;
  }>> {
    const socialRow =
      await this.getSocialSessionRow(sessionId);

    const safeLimit = Math.min(
      Math.max(Math.trunc(limit) || 12, 1),
      50,
    );

    if (socialRow) {
      const { data, error } = await this.supabaseService
        .getClient()
        .from('social_conversations')
        .select('sender, message, created_at')
        .eq('company_id', String(socialRow.company_id))
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(safeLimit);

      if (error) {
        return [];
      }

      return (data ?? [])
        .slice()
        .reverse()
        .map((message) => ({
          sender:
            typeof message.sender === 'string'
              ? message.sender
              : 'customer',
          message:
            typeof message.message === 'string'
              ? message.message
              : '',
        }));
    }

    const { data, error } = await this.supabaseService
      .getClient()
      .from('conversations')
      .select('sender, message, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(safeLimit);

    if (error) {
      return [];
    }

    return (data ?? [])
      .slice()
      .reverse()
      .map((message) => ({
        sender:
          typeof message.sender === 'string'
            ? message.sender
            : 'customer',
        message:
          typeof message.message === 'string'
            ? message.message
            : '',
      }));
  }

  isSocialSession(
    session: ConversationSession,
  ): boolean {
    return (
      session.context.channel === 'instagram' ||
      session.context.channel === 'messenger' ||
      session.customerPhone.startsWith('instagram:') ||
      session.customerPhone.startsWith('messenger:')
    );
  }

  getChannel(
    session: ConversationSession,
  ): 'whatsapp' | SocialChannel {
    if (
      session.context.channel === 'instagram' ||
      session.customerPhone.startsWith('instagram:')
    ) {
      return 'instagram';
    }

    if (
      session.context.channel === 'messenger' ||
      session.customerPhone.startsWith('messenger:')
    ) {
      return 'messenger';
    }

    return 'whatsapp';
  }

  private async getSocialSessionRow(
    sessionId: string,
  ): Promise<Record<string, any> | null> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('social_conversation_sessions')
      .select(
        [
          'id',
          'company_id',
          'channel',
          'external_customer_id',
          'display_name',
          'username',
          'profile_picture_url',
          'attention_status',
          'assigned_to_user_id',
          'assigned_to_name',
          'pending_count',
          'pending_since',
          'taken_at',
          'closed_at',
          'last_message_at',
          'agent_stage',
          'agent_context',
        ].join(', '),
      )
      .eq('id', sessionId)
      .maybeSingle();

    if (error) {
      throw new Error(
        `No se pudo consultar la sesión comercial social: ${error.message}`,
      );
    }

    return data
      ? data as Record<string, any>
      : null;
  }

  private toSocialSession(
    row: Record<string, any>,
  ): ConversationSession {
    const channel: SocialChannel =
      row.channel === 'messenger'
        ? 'messenger'
        : 'instagram';

    const externalCustomerId =
      typeof row.external_customer_id === 'string'
        ? row.external_customer_id
        : '';

    const storedContext =
      row.agent_context &&
      typeof row.agent_context === 'object' &&
      !Array.isArray(row.agent_context)
        ? row.agent_context as JsonObject
        : {};

    const status: AttentionStatus =
      row.attention_status === 'waiting' ||
      row.attention_status === 'human' ||
      row.attention_status === 'closed'
        ? row.attention_status
        : 'ai';

    return {
      id: String(row.id),
      companyId: String(row.company_id),
      customerPhone:
        `${channel}:${externalCustomerId}`,
      stage:
        typeof row.agent_stage === 'string' &&
        row.agent_stage.trim()
          ? row.agent_stage.trim()
          : 'active',
      context: {
        ...storedContext,
        channel,
        externalCustomerId,
        displayName:
          typeof row.display_name === 'string'
            ? row.display_name
            : null,
        username:
          typeof row.username === 'string'
            ? row.username
            : null,
        profilePictureUrl:
          typeof row.profile_picture_url === 'string'
            ? row.profile_picture_url
            : null,
      },
      lastMessageAt:
        typeof row.last_message_at === 'string'
          ? row.last_message_at
          : new Date().toISOString(),
      pendingCount:
        Math.max(
          0,
          Number(row.pending_count) || 0,
        ),
      pendingSince:
        typeof row.pending_since === 'string'
          ? row.pending_since
          : null,
      attentionStatus: status,
      assignedToUserId:
        typeof row.assigned_to_user_id === 'string'
          ? row.assigned_to_user_id
          : null,
      assignedToName:
        typeof row.assigned_to_name === 'string'
          ? row.assigned_to_name
          : null,
      takenAt:
        typeof row.taken_at === 'string'
          ? row.taken_at
          : null,
      closedAt:
        typeof row.closed_at === 'string'
          ? row.closed_at
          : null,
    };
  }

  private parseSocialIdentity(
    value: string,
  ): {
    channel: SocialChannel;
    externalCustomerId: string;
  } | null {
    const clean = value.trim();

    for (const channel of [
      'instagram',
      'messenger',
    ] as const) {
      const prefix = `${channel}:`;

      if (clean.startsWith(prefix)) {
        const externalCustomerId =
          clean.slice(prefix.length).trim();

        if (externalCustomerId) {
          return {
            channel,
            externalCustomerId,
          };
        }
      }
    }

    return null;
  }
}
