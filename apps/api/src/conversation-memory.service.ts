import { Injectable } from '@nestjs/common';
import { SupabaseService } from './supabase.service';

type JsonObject = Record<string, unknown>;

export type AttentionStatus = 'ai' | 'waiting' | 'human' | 'closed';

const SESSION_FIELDS = [
  'id',
  'company_id',
  'customer_phone',
  'stage',
  'context',
  'last_message_at',
  'attention_status',
  'assigned_to_name',
  'taken_at',
  'closed_at',
].join(', ');

export type CompanyProfile = {
  id: string;
  slug: string;
  name: string;
  assistantName: string | null;
  aiInstructions: string;
  settings: JsonObject;
};

export type ConversationSession = {
  id: string;
  companyId: string;
  customerPhone: string;
  stage: string;
  context: JsonObject;
  lastMessageAt: string;
  attentionStatus: AttentionStatus;
  assignedToName: string | null;
  takenAt: string | null;
  closedAt: string | null;
};

export type InboxMessage = {
  id: string | null;
  sessionId: string;
  message: string;
  sender: string;
  authorType: 'customer' | 'ai' | 'advisor';
  createdAt: string | null;
};

export type InboxConversation = {
  company: {
    id: string;
    slug: string;
    name: string;
  };
  session: ConversationSession;
  messages: InboxMessage[];
};

export type InboxSessionSummary = ConversationSession & {
  lastMessage: InboxMessage | null;
};

type SaveMessageInput = {
  companyId: string;
  sessionId: string;
  customerPhone: string;
  message: string;
  sender: 'customer' | 'assistant';
  authorType?: 'customer' | 'ai' | 'advisor';
  aiResponse?: string | null;
  providerMessageId?: string | null;
};

@Injectable()
export class ConversationMemoryService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async getCompanyProfile(companySlug: string): Promise<CompanyProfile> {
    const slug = companySlug.trim().toLowerCase();

    if (!slug) {
      throw new Error('Falta el identificador de la empresa.');
    }

    const client = this.supabaseService.getClient();

    const { data: company, error: companyError } = await client
      .from('companies')
      .select('id, slug, name, status')
      .eq('slug', slug)
      .eq('status', 'active')
      .maybeSingle();

    if (companyError) {
      throw new Error(
        `No se pudo consultar la empresa: ${companyError.message}`,
      );
    }

    if (!company) {
      throw new Error(`No existe una empresa activa con slug "${slug}".`);
    }

    return this.getCompanyProfileById(company.id);
  }

  async getCompanyProfileById(companyId: string): Promise<CompanyProfile> {
    const id = companyId.trim();

    if (!id) {
      throw new Error('Falta el identificador de la empresa.');
    }

    const client = this.supabaseService.getClient();

    const { data: company, error: companyError } = await client
      .from('companies')
      .select('id, slug, name, status')
      .eq('id', id)
      .eq('status', 'active')
      .maybeSingle();

    if (companyError) {
      throw new Error(
        `No se pudo consultar la empresa: ${companyError.message}`,
      );
    }

    if (!company) {
      throw new Error('No existe una empresa activa con ese identificador.');
    }

    const { data: companySettings, error: settingsError } = await client
      .from('company_settings')
      .select('assistant_name, ai_instructions, settings')
      .eq('company_id', company.id)
      .maybeSingle();

    if (settingsError) {
      throw new Error(
        `No se pudo consultar la configuración: ${settingsError.message}`,
      );
    }

    return {
      id: company.id,
      slug: company.slug,
      name: company.name,
      assistantName: companySettings?.assistant_name ?? null,
      aiInstructions: companySettings?.ai_instructions ?? '',
      settings: this.toJsonObject(companySettings?.settings),
    };
  }

  async updateCompanyAiSettings(
    companySlug: string,
    input: {
      assistantName?: string;
      tone?: string;
      aiInstructions?: string;
    },
  ): Promise<CompanyProfile> {
    const profile = await this.getCompanyProfile(companySlug);
    const nextSettings: JsonObject = { ...profile.settings };

    if (input.tone !== undefined) {
      const tone = input.tone.trim();

      if (tone) {
        nextSettings.ai_tone = tone;
      } else {
        delete nextSettings.ai_tone;
      }
    }

    const assistantName =
      input.assistantName === undefined
        ? profile.assistantName
        : input.assistantName.trim() || null;

    const aiInstructions =
      input.aiInstructions === undefined
        ? profile.aiInstructions
        : input.aiInstructions.trim();

    const { error } = await this.supabaseService
      .getClient()
      .from('company_settings')
      .upsert(
        {
          company_id: profile.id,
          assistant_name: assistantName,
          ai_instructions: aiInstructions,
          settings: nextSettings,
        },
        { onConflict: 'company_id' },
      );

    if (error) {
      throw new Error(
        `No se pudo guardar la configuración de IA: ${error.message}`,
      );
    }

    return this.getCompanyProfileById(profile.id);
  }

  async getOrCreateSession(
    companySlug: string,
    customerPhone: string,
  ): Promise<ConversationSession> {
    const profile = await this.getCompanyProfile(companySlug);

    return this.getOrCreateSessionByCompanyId(profile.id, customerPhone);
  }

  async getOrCreateSessionByCompanyId(
    companyId: string,
    customerPhone: string,
  ): Promise<ConversationSession> {
    const id = companyId.trim();
    const phone = customerPhone.trim();

    if (!id) {
      throw new Error('Falta el identificador de la empresa.');
    }

    if (!phone) {
      throw new Error('Falta el número de teléfono del cliente.');
    }

    const client = this.supabaseService.getClient();

    const { data: existingSession, error: existingError } = await client
      .from('conversation_sessions')
      .select(SESSION_FIELDS)
      .eq('company_id', id)
      .eq('customer_phone', phone)
      .maybeSingle();

    if (existingError) {
      throw new Error(
        `No se pudo consultar la sesión: ${existingError.message}`,
      );
    }

    if (existingSession) {
      return this.toSession(existingSession);
    }

    const now = new Date().toISOString();

    const { data: createdSession, error: createError } = await client
      .from('conversation_sessions')
      .insert({
        company_id: id,
        customer_phone: phone,
        stage: 'main',
        context: {},
        attention_status: 'ai',
        last_message_at: now,
        updated_at: now,
      })
      .select(SESSION_FIELDS)
      .single();

    if (createError || !createdSession) {
      throw new Error(
        `No se pudo crear la sesión: ${
          createError?.message ?? 'respuesta vacía'
        }`,
      );
    }

    return this.toSession(createdSession);
  }

  async getSessionById(sessionId: string): Promise<ConversationSession> {
    const id = sessionId.trim();

    if (!id) {
      throw new Error('Falta el identificador de la sesión.');
    }

    const { data, error } = await this.supabaseService
      .getClient()
      .from('conversation_sessions')
      .select(SESSION_FIELDS)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`No se pudo consultar la sesión: ${error.message}`);
    }

    if (!data) {
      throw new Error('No existe la sesión solicitada.');
    }

    return this.toSession(data);
  }

  async updateSession(
    sessionId: string,
    changes: {
      stage?: string;
      context?: JsonObject;
    },
  ): Promise<ConversationSession> {
    const now = new Date().toISOString();

    const updateData: {
      stage?: string;
      context?: JsonObject;
      last_message_at: string;
      updated_at: string;
    } = {
      last_message_at: now,
      updated_at: now,
    };

    if (changes.stage !== undefined) {
      updateData.stage = changes.stage;
    }

    if (changes.context !== undefined) {
      updateData.context = changes.context;
    }

    const { data, error } = await this.supabaseService
      .getClient()
      .from('conversation_sessions')
      .update(updateData)
      .eq('id', sessionId)
      .select(SESSION_FIELDS)
      .single();

    if (error || !data) {
      throw new Error(
        `No se pudo actualizar la sesión: ${
          error?.message ?? 'respuesta vacía'
        }`,
      );
    }

    return this.toSession(data);
  }

  async touchSession(sessionId: string): Promise<void> {
    const now = new Date().toISOString();

    const { error } = await this.supabaseService
      .getClient()
      .from('conversation_sessions')
      .update({
        last_message_at: now,
        updated_at: now,
      })
      .eq('id', sessionId);

    if (error) {
      throw new Error(
        `No se pudo actualizar la actividad de la sesión: ${error.message}`,
      );
    }
  }

  async requestHumanAttention(sessionId: string): Promise<ConversationSession> {
    return this.updateAttention(sessionId, {
      attention_status: 'waiting',
      assigned_to_user_id: null,
      assigned_to_name: null,
      taken_at: null,
      closed_at: null,
    });
  }

  async takeConversation(
    sessionId: string,
    advisorName: string,
  ): Promise<ConversationSession> {
    const name = advisorName.trim() || 'Asesor';
    const now = new Date().toISOString();

    return this.updateAttention(sessionId, {
      attention_status: 'human',
      assigned_to_name: name,
      taken_at: now,
      closed_at: null,
    });
  }

  async closeConversation(sessionId: string): Promise<ConversationSession> {
    return this.updateAttention(sessionId, {
      attention_status: 'closed',
      closed_at: new Date().toISOString(),
    });
  }

  async resumeAiConversation(sessionId: string): Promise<ConversationSession> {
    return this.updateAttention(sessionId, {
      attention_status: 'ai',
      assigned_to_user_id: null,
      assigned_to_name: null,
      taken_at: null,
      closed_at: null,
    });
  }

  async listInboxSessions(
    companySlug: string,
    status: string = 'all',
    limit: number = 60,
  ): Promise<{
    company: { id: string; slug: string; name: string };
    sessions: InboxSessionSummary[];
  }> {
    const profile = await this.getCompanyProfile(companySlug);
    const max = Math.min(Math.max(Math.trunc(limit) || 60, 1), 150);
    const normalizedStatus = this.normalizeStatusFilter(status);
    const client = this.supabaseService.getClient();

    let query = client
      .from('conversation_sessions')
      .select(SESSION_FIELDS)
      .eq('company_id', profile.id)
      .order('last_message_at', { ascending: false })
      .limit(max);

    if (normalizedStatus) {
      query = query.eq('attention_status', normalizedStatus);
    }

    const { data: sessionRows, error: sessionError } = await query;

    if (sessionError) {
      throw new Error(
        `No se pudieron consultar las conversaciones: ${sessionError.message}`,
      );
    }

    const sessions = (sessionRows ?? []).map((row) => this.toSession(row));

    if (!sessions.length) {
      return {
        company: { id: profile.id, slug: profile.slug, name: profile.name },
        sessions: [],
      };
    }

    const sessionIds = sessions.map((session) => session.id);
    const { data: messageRows, error: messageError } = await client
      .from('conversations')
      .select('id, session_id, message, sender, author_type, created_at')
      .in('session_id', sessionIds)
      .order('created_at', { ascending: false });

    if (messageError) {
      throw new Error(
        `No se pudieron consultar los últimos mensajes: ${messageError.message}`,
      );
    }

    const latestBySession = new Map<string, InboxMessage>();

    for (const row of messageRows ?? []) {
      const message = this.toInboxMessage(row);

      if (!latestBySession.has(message.sessionId)) {
        latestBySession.set(message.sessionId, message);
      }
    }

    return {
      company: { id: profile.id, slug: profile.slug, name: profile.name },
      sessions: sessions.map((session) => ({
        ...session,
        lastMessage: latestBySession.get(session.id) ?? null,
      })),
    };
  }

  async getInboxConversation(
    companySlug: string,
    sessionId: string,
  ): Promise<InboxConversation> {
    const profile = await this.getCompanyProfile(companySlug);
    const id = sessionId.trim();

    if (!id) {
      throw new Error('Falta el identificador de la conversación.');
    }

    const client = this.supabaseService.getClient();
    const { data: sessionRow, error: sessionError } = await client
      .from('conversation_sessions')
      .select(SESSION_FIELDS)
      .eq('id', id)
      .eq('company_id', profile.id)
      .maybeSingle();

    if (sessionError) {
      throw new Error(
        `No se pudo consultar la conversación: ${sessionError.message}`,
      );
    }

    if (!sessionRow) {
      throw new Error('La conversación no existe para esta empresa.');
    }

    const { data: messageRows, error: messageError } = await client
      .from('conversations')
      .select('id, session_id, message, sender, author_type, created_at')
      .eq('session_id', id)
      .order('created_at', { ascending: true });

    if (messageError) {
      throw new Error(
        `No se pudo consultar el historial: ${messageError.message}`,
      );
    }

    return {
      company: { id: profile.id, slug: profile.slug, name: profile.name },
      session: this.toSession(sessionRow),
      messages: (messageRows ?? []).map((row) => this.toInboxMessage(row)),
    };
  }

  async saveMessage(input: SaveMessageInput): Promise<'saved' | 'duplicate'> {
    const providerMessageId = input.providerMessageId?.trim() || null;
    const authorType =
      input.authorType ?? (input.sender === 'customer' ? 'customer' : 'ai');

    const { error } = await this.supabaseService
      .getClient()
      .from('conversations')
      .insert({
        company_id: input.companyId,
        session_id: input.sessionId,
        customer_phone: input.customerPhone,
        message: input.message,
        sender: input.sender,
        author_type: authorType,
        message_type: 'text',
        status: input.sender === 'customer' ? 'received' : 'sent',
        ai_response: input.aiResponse ?? null,
        provider_message_id: providerMessageId,
      });

    if (error) {
      if (providerMessageId && error.code === '23505') {
        return 'duplicate';
      }

      throw new Error(`No se pudo guardar el mensaje: ${error.message}`);
    }

    return 'saved';
  }

  private async updateAttention(
    sessionId: string,
    changes: Record<string, unknown>,
  ): Promise<ConversationSession> {
    const now = new Date().toISOString();

    const { data, error } = await this.supabaseService
      .getClient()
      .from('conversation_sessions')
      .update({
        ...changes,
        updated_at: now,
      })
      .eq('id', sessionId)
      .select(SESSION_FIELDS)
      .single();

    if (error || !data) {
      throw new Error(
        `No se pudo cambiar el estado de la conversación: ${
          error?.message ?? 'respuesta vacía'
        }`,
      );
    }

    return this.toSession(data);
  }

  private normalizeStatusFilter(status: string): AttentionStatus | null {
    const clean = status.trim().toLowerCase();

    if (
      clean === 'ai' ||
      clean === 'waiting' ||
      clean === 'human' ||
      clean === 'closed'
    ) {
      return clean;
    }

    return null;
  }

  private toSession(session: unknown): ConversationSession {
    if (
      !session ||
      typeof session !== 'object' ||
      Array.isArray(session)
    ) {
      throw new Error('La sesión recibida no tiene un formato válido.');
    }

    const row = session as Record<string, unknown>;

    const id =
      typeof row.id === 'string' ? row.id.trim() : '';
    const companyId =
      typeof row.company_id === 'string'
        ? row.company_id.trim()
        : '';
    const customerPhone =
      typeof row.customer_phone === 'string'
        ? row.customer_phone.trim()
        : '';

    if (!id || !companyId || !customerPhone) {
      throw new Error('La sesión recibida no tiene los datos requeridos.');
    }

    return {
      id,
      companyId,
      customerPhone,
      stage:
        typeof row.stage === 'string' && row.stage.trim()
          ? row.stage
          : 'main',
      context: this.toJsonObject(row.context),
      lastMessageAt:
        typeof row.last_message_at === 'string' &&
        row.last_message_at.trim()
          ? row.last_message_at
          : new Date(0).toISOString(),
      attentionStatus: this.toAttentionStatus(
        row.attention_status,
      ),
      assignedToName:
        typeof row.assigned_to_name === 'string' &&
        row.assigned_to_name.trim()
          ? row.assigned_to_name
          : null,
      takenAt:
        typeof row.taken_at === 'string' && row.taken_at.trim()
          ? row.taken_at
          : null,
      closedAt:
        typeof row.closed_at === 'string' && row.closed_at.trim()
          ? row.closed_at
          : null,
    };
  }

  private toInboxMessage(message: {
    id?: string | null;
    session_id: string;
    message: string;
    sender: string;
    author_type?: string | null;
    created_at?: string | null;
  }): InboxMessage {
    const authorType =
      message.author_type === 'advisor' ||
      message.author_type === 'ai' ||
      message.author_type === 'customer'
        ? message.author_type
        : message.sender === 'customer'
          ? 'customer'
          : 'ai';

    return {
      id: message.id ?? null,
      sessionId: message.session_id,
      message: message.message,
      sender: message.sender,
      authorType,
      createdAt: message.created_at ?? null,
    };
  }

  private toAttentionStatus(value: unknown): AttentionStatus {
    if (value === 'waiting' || value === 'human' || value === 'closed') {
      return value;
    }

    return 'ai';
  }

  private toJsonObject(value: unknown): JsonObject {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as JsonObject;
    }

    return {};
  }
}
