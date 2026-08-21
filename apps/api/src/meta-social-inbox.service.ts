import { Injectable } from '@nestjs/common';
import { SupabaseService } from './supabase.service';
import type {
  AttentionStatus,
  ContactRecord,
  InboxConversation,
  InboxMessage,
  InboxSessionSummary,
} from './conversation-memory.service';

type SocialChannel = 'messenger' | 'instagram';

type SocialSessionSummary = InboxSessionSummary & {
  channel: SocialChannel;
  externalCustomerId: string;
  profilePictureUrl: string | null;
  username: string | null;
  contact: ContactRecord | null;
};

@Injectable()
export class MetaSocialInboxService {
  constructor(
    private readonly supabaseService: SupabaseService,
  ) {}

  async listSessions(
    companyId: string,
    options: {
      status?: string;
      limit?: number;
      search?: string;
      advisorUserId?: string;
    } = {},
  ): Promise<SocialSessionSummary[]> {
    const client = this.supabaseService.getClient();

    const safeLimit = Math.min(
      Math.max(Math.trunc(options.limit ?? 20) || 20, 1),
      50,
    );

    const status = (options.status ?? '').trim();
    const search = (options.search ?? '').trim();
    const advisorUserId =
      (options.advisorUserId ?? '').trim();

    let query = client
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
          'inbound_message_count',
          'attention_status',
          'assigned_to_user_id',
          'assigned_to_name',
          'pending_count',
          'pending_since',
          'taken_at',
          'closed_at',
          'last_message_at',
          'created_at',
        ].join(', '),
      )
      .eq('company_id', companyId)
      .neq('attention_status', 'closed');

    if (
      status === 'ai' ||
      status === 'waiting' ||
      status === 'human'
    ) {
      query = query.eq('attention_status', status);
    }

    if (advisorUserId) {
      query = query.eq(
        'assigned_to_user_id',
        advisorUserId,
      );
    }

    if (search) {
      const safeSearch = search
        .replace(/[%(),]/g, ' ')
        .trim();

      if (safeSearch) {
        query = query.or(
          `display_name.ilike.%${safeSearch}%,external_customer_id.ilike.%${safeSearch}%`,
        );
      }
    }

    const { data: sessionRows, error: sessionError } =
      await query
        .order('last_message_at', { ascending: false })
        .limit(safeLimit);

    if (sessionError) {
      throw new Error(
        `No se pudieron consultar sesiones sociales: ${sessionError.message}`,
      );
    }

    const rows = sessionRows ?? [];

    if (!rows.length) {
      return [];
    }

    const sessionIds = rows
      .map((row: any) =>
        typeof row.id === 'string' ? row.id : '',
      )
      .filter(Boolean);

    const { data: messageRows, error: messageError } =
      await client
        .from('social_conversations')
        .select(
          'id, session_id, message, sender, author_type, message_type, media_url, provider_message_id, created_at',
        )
        .in('session_id', sessionIds)
        .order('created_at', { ascending: false })
        .limit(500);

    if (messageError) {
      throw new Error(
        `No se pudieron consultar mensajes sociales: ${messageError.message}`,
      );
    }

    const lastBySession = new Map<string, InboxMessage>();

    for (const row of messageRows ?? []) {
      const sessionId =
        typeof row.session_id === 'string'
          ? row.session_id
          : '';

      if (!sessionId || lastBySession.has(sessionId)) {
        continue;
      }

      lastBySession.set(
        sessionId,
        this.toInboxMessage(row),
      );
    }

    return rows.map((row: any) => {
      const channel = this.channel(row.channel);

      const externalCustomerId =
        typeof row.external_customer_id === 'string'
          ? row.external_customer_id
          : '';

      const displayName =
        typeof row.display_name === 'string' &&
        row.display_name.trim()
          ? row.display_name.trim()
          : `${channel === 'instagram' ? 'Instagram' : 'Messenger'} ${externalCustomerId.slice(-6)}`;

      const customerPhone =
        `${channel}:${externalCustomerId}`;

      const contact: ContactRecord = {
        id: `social-session:${row.id}`,
        companyId,
        phone: customerPhone,
        displayName,
        primaryChannel: channel,
        tags: [],
        notes: '',
        firstSeenAt:
          typeof row.created_at === 'string'
            ? row.created_at
            : null,
        lastActivityAt:
          typeof row.last_message_at === 'string'
            ? row.last_message_at
            : null,
      };

      return {
        id: String(row.id),
        companyId,
        customerPhone,
        stage: 'social',
        context: {
          channel,
          externalCustomerId,
          displayName,
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
          Number(row.pending_count) || 0,
        pendingSince:
          typeof row.pending_since === 'string'
            ? row.pending_since
            : null,
        attentionStatus:
          this.attentionStatus(row.attention_status),
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
        lastMessage:
          lastBySession.get(String(row.id)) ?? null,
        channel,
        externalCustomerId,
        profilePictureUrl:
          typeof row.profile_picture_url === 'string'
            ? row.profile_picture_url
            : null,
        username:
          typeof row.username === 'string'
            ? row.username
            : null,
        contact,
      };
    });
  }

  async getConversation(
    company: {
      id: string;
      slug: string;
      name: string;
    },
    sessionIdInput: string,
    afterInput = '',
  ): Promise<InboxConversation | null> {
    const sessionId = sessionIdInput.trim();

    if (!sessionId) {
      return null;
    }

    const client = this.supabaseService.getClient();

    const { data: row, error: sessionError } =
      await client
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
            'created_at',
          ].join(', '),
        )
        .eq('id', sessionId)
        .eq('company_id', company.id)
        .maybeSingle();

    if (sessionError) {
      throw new Error(
        `No se pudo consultar la conversación social: ${sessionError.message}`,
      );
    }

    if (!row) {
      return null;
    }

    const socialRow = row as any;

    const channel = this.channel(socialRow.channel);

    const externalCustomerId =
      typeof socialRow.external_customer_id === 'string'
        ? socialRow.external_customer_id
        : '';

    const customerPhone =
      `${channel}:${externalCustomerId}`;

    const displayName =
      typeof socialRow.display_name === 'string' &&
      socialRow.display_name.trim()
        ? socialRow.display_name.trim()
        : `${channel === 'instagram' ? 'Instagram' : 'Messenger'} ${externalCustomerId.slice(-6)}`;

    const session = {
      id: String(socialRow.id),
      companyId: company.id,
      customerPhone,
      stage: 'social',
      context: {
        channel,
        externalCustomerId,
        displayName,
        username:
          typeof socialRow.username === 'string'
            ? socialRow.username
            : null,
        profilePictureUrl:
          typeof socialRow.profile_picture_url === 'string'
            ? socialRow.profile_picture_url
            : null,
      },
      lastMessageAt:
        typeof socialRow.last_message_at === 'string'
          ? socialRow.last_message_at
          : new Date().toISOString(),
      pendingCount:
        Number(socialRow.pending_count) || 0,
      pendingSince:
        typeof socialRow.pending_since === 'string'
          ? socialRow.pending_since
          : null,
      attentionStatus:
        this.attentionStatus(socialRow.attention_status),
      assignedToUserId:
        typeof socialRow.assigned_to_user_id === 'string'
          ? socialRow.assigned_to_user_id
          : null,
      assignedToName:
        typeof socialRow.assigned_to_name === 'string'
          ? socialRow.assigned_to_name
          : null,
      takenAt:
        typeof socialRow.taken_at === 'string'
          ? socialRow.taken_at
          : null,
      closedAt:
        typeof socialRow.closed_at === 'string'
          ? socialRow.closed_at
          : null,
    };

    const requestedAfter = afterInput.trim();

    const validAfter =
      requestedAfter &&
      !Number.isNaN(Date.parse(requestedAfter))
        ? requestedAfter
        : '';

    let messagesQuery = client
      .from('social_conversations')
      .select(
        'id, session_id, message, sender, author_type, message_type, media_url, provider_message_id, created_at',
      )
      .eq('session_id', sessionId)
      .eq('company_id', company.id)
      .order('created_at', { ascending: true });

    if (validAfter) {
      messagesQuery =
        messagesQuery.gte('created_at', validAfter);
    }

    const { data: messageRows, error: messageError } =
      await messagesQuery;

    if (messageError) {
      throw new Error(
        `No se pudo consultar el historial social: ${messageError.message}`,
      );
    }

    const contact: ContactRecord = {
      id: `social-session:${sessionId}`,
      companyId: company.id,
      phone: customerPhone,
      displayName,
      primaryChannel: channel,
      tags: [],
      notes: '',
      firstSeenAt:
        typeof socialRow.created_at === 'string'
          ? socialRow.created_at
          : null,
      lastActivityAt:
        typeof socialRow.last_message_at === 'string'
          ? socialRow.last_message_at
          : null,
    };

    return {
      company,
      session,
      contact,
      messages:
        (messageRows ?? []).map((messageRow) =>
          this.toInboxMessage(messageRow),
        ),
    };
  }

  async takeConversation(
    company: {
      id: string;
      slug: string;
      name: string;
    },
    sessionId: string,
    advisor: {
      userId: string;
      fullName: string;
    },
  ) {
    const userId = advisor.userId.trim();
    const fullName = advisor.fullName.trim();

    if (!userId || !fullName) {
      throw new Error('Falta el asesor autenticado.');
    }

    const now = new Date().toISOString();

    const { error } = await this.supabaseService
      .getClient()
      .from('social_conversation_sessions')
      .update({
        attention_status: 'human',
        assigned_to_user_id: userId,
        assigned_to_name: fullName,
        taken_at: now,
        closed_at: null,
        updated_at: now,
      })
      .eq('id', sessionId)
      .eq('company_id', company.id);

    if (error) {
      throw new Error(
        `No se pudo tomar la conversación social: ${error.message}`,
      );
    }

    const conversation = await this.getConversation(
      company,
      sessionId,
    );

    if (!conversation) {
      throw new Error(
        'La conversación social no existe para esta empresa.',
      );
    }

    return conversation.session;
  }

  async closeConversation(
    company: {
      id: string;
      slug: string;
      name: string;
    },
    sessionId: string,
  ) {
    const now = new Date().toISOString();

    const { error } = await this.supabaseService
      .getClient()
      .from('social_conversation_sessions')
      .update({
        attention_status: 'closed',
        assigned_to_user_id: null,
        assigned_to_name: null,
        taken_at: null,
        closed_at: now,
        updated_at: now,
      })
      .eq('id', sessionId)
      .eq('company_id', company.id);

    if (error) {
      throw new Error(
        `No se pudo finalizar la conversación social: ${error.message}`,
      );
    }

    const conversation = await this.getConversation(
      company,
      sessionId,
    );

    if (!conversation) {
      throw new Error(
        'La conversación social no existe para esta empresa.',
      );
    }

    return conversation.session;
  }

  async resumeAiConversation(
    company: {
      id: string;
      slug: string;
      name: string;
    },
    sessionId: string,
  ) {
    const now = new Date().toISOString();

    const { error } = await this.supabaseService
      .getClient()
      .from('social_conversation_sessions')
      .update({
        attention_status: 'ai',
        assigned_to_user_id: null,
        assigned_to_name: null,
        taken_at: null,
        closed_at: null,
        updated_at: now,
      })
      .eq('id', sessionId)
      .eq('company_id', company.id);

    if (error) {
      throw new Error(
        `No se pudo devolver la conversación social a la IA: ${error.message}`,
      );
    }

    const conversation = await this.getConversation(
      company,
      sessionId,
    );

    if (!conversation) {
      throw new Error(
        'La conversación social no existe para esta empresa.',
      );
    }

    return conversation.session;
  }

  private toInboxMessage(row: any): InboxMessage {
    const rawType =
      typeof row.message_type === 'string'
        ? row.message_type
        : 'text';

    const messageType:
      | 'text'
      | 'audio'
      | 'image'
      | 'video'
      | 'document' =
      rawType === 'audio'
        ? 'audio'
        : rawType === 'image'
          ? 'image'
          : rawType === 'video'
            ? 'video'
            : rawType === 'attachment'
              ? 'document'
              : 'text';

    const rawAuthor =
      typeof row.author_type === 'string'
        ? row.author_type
        : '';

    const authorType:
      | 'customer'
      | 'ai'
      | 'advisor' =
      rawAuthor === 'advisor'
        ? 'advisor'
        : rawAuthor === 'assistant' ||
            rawAuthor === 'ai'
          ? 'ai'
          : 'customer';

    return {
      id:
        row.id === null || row.id === undefined
          ? null
          : String(row.id),
      sessionId:
        typeof row.session_id === 'string'
          ? row.session_id
          : '',
      message:
        typeof row.message === 'string'
          ? row.message
          : '',
      sender:
        typeof row.sender === 'string'
          ? row.sender
          : 'customer',
      authorType,
      messageType,
      mediaMimeType: null,
      mediaStoragePath:
        typeof row.media_url === 'string'
          ? row.media_url
          : null,
      mediaVoice: false,
      providerMessageId:
        typeof row.provider_message_id === 'string'
          ? row.provider_message_id
          : null,
      replyToProviderMessageId: null,
      replyToMessage: null,
      messageSource: this.sourceName(row),
      sourceName: this.sourceName(row),
      createdAt:
        typeof row.created_at === 'string'
          ? row.created_at
          : null,
    };
  }

  private sourceName(row: any): string {
    const channel = this.channel(row.channel);

    return channel === 'instagram'
      ? 'Instagram'
      : 'Messenger';
  }

  private channel(value: unknown): SocialChannel {
    return value === 'instagram'
      ? 'instagram'
      : 'messenger';
  }

  private attentionStatus(
    value: unknown,
  ): AttentionStatus {
    if (
      value === 'waiting' ||
      value === 'human' ||
      value === 'closed'
    ) {
      return value;
    }

    return 'ai';
  }
}
