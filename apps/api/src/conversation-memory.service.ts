import { Injectable } from '@nestjs/common';
import { SupabaseService } from './supabase.service';
import { PushNotificationService } from './push-notification.service';

type JsonObject = Record<string, unknown>;

export type AttentionStatus = 'ai' | 'waiting' | 'human' | 'closed';

export type ActiveServiceArea = {
  id: string;
  name: string;
  description: string;
};

const SESSION_FIELDS = [
  'id',
  'company_id',
  'customer_phone',
  'stage',
  'context',
  'last_message_at',
  'pending_count',
  'pending_since',
  'attention_status',
  'assigned_to_user_id',
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
  pendingCount: number;
  pendingSince: string | null;
  attentionStatus: AttentionStatus;
  assignedToUserId: string | null;
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
  messageType: 'text' | 'audio' | 'image';
  mediaMimeType: string | null;
  mediaStoragePath: string | null;
  mediaVoice: boolean;
  createdAt: string | null;
};

export type InboxConversation = {
  company: {
    id: string;
    slug: string;
    name: string;
  };
  session: ConversationSession;
  contact: ContactRecord | null;
  messages: InboxMessage[];
};

export type InboxSessionSummary = ConversationSession & {
  lastMessage: InboxMessage | null;
};


export type ContactRecord = {
  id: string;
  companyId: string;
  phone: string;
  displayName: string | null;
  primaryChannel: 'whatsapp' | 'instagram' | 'messenger' | 'manual';
  tags: string[];
  notes: string;
  firstSeenAt: string | null;
  lastActivityAt: string | null;
};

export type ClientSummary = {
  customerPhone: string;
  contact: ContactRecord | null;
  firstMessageAt: string | null;
  lastMessageAt: string;
  attentionStatus: AttentionStatus;
  assignedToUserId: string | null;
  assignedToName: string | null;
  totalMessages: number;
  lastMessage: InboxMessage | null;
};

export type ClientProfile = {
  company: {
    id: string;
    slug: string;
    name: string;
  };
  client: ClientSummary;
  session: ConversationSession;
  messages: InboxMessage[];
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
  messageType?: 'text' | 'audio' | 'image';
  mediaId?: string | null;
  mediaMimeType?: string | null;
  mediaStoragePath?: string | null;
  mediaFilename?: string | null;
  mediaVoice?: boolean;
};

@Injectable()
export class ConversationMemoryService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly pushNotificationService: PushNotificationService,
  ) {}

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
      commercialFlow?: unknown;
      knowledgeBase?: unknown;
      cartRecovery?: unknown;
      shippingTracking?: unknown;
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

    if (input.commercialFlow !== undefined) {
      const commercialFlow = this.normalizeCommercialFlow(
        input.commercialFlow,
      );

      if (Object.keys(commercialFlow).length) {
        nextSettings.commercial_flow = commercialFlow;
      } else {
        delete nextSettings.commercial_flow;
      }
    }

    if (input.knowledgeBase !== undefined) {
      const knowledgeBase = this.normalizeKnowledgeBase(
        input.knowledgeBase,
      );

      if (Object.keys(knowledgeBase).length) {
        nextSettings.knowledge_base = knowledgeBase;
      } else {
        delete nextSettings.knowledge_base;
      }
    }

    if (input.cartRecovery !== undefined) {
      const cartRecovery = this.normalizeCartRecovery(
        input.cartRecovery,
      );

      if (Object.keys(cartRecovery).length) {
        nextSettings.cart_recovery = cartRecovery;
      } else {
        delete nextSettings.cart_recovery;
      }

      delete nextSettings.cart_recovery_default_country_code;
      delete nextSettings.cart_recovery_reply_context_hours;
      delete nextSettings.cart_recovery_test_mode;
      delete nextSettings.cart_recovery_test_phones;
      delete nextSettings.cart_recovery_fallback_message;
    }

    if (input.shippingTracking !== undefined) {
      const shippingTracking = this.toJsonObject(input.shippingTracking);

      if (Object.keys(shippingTracking).length) {
        nextSettings.shipping_tracking = shippingTracking;
      } else {
        delete nextSettings.shipping_tracking;
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

  async createManualContact(
    companySlug: string,
    input: {
      phone: string;
      displayName?: string;
      tags?: string[];
      notes?: string;
    },
  ): Promise<{
    company: { id: string; slug: string; name: string };
    contact: ContactRecord;
    session: ConversationSession;
  }> {
    const profile = await this.getCompanyProfile(companySlug);
    const phone = this.normalizePhone(input.phone);

    if (!phone) {
      throw new Error('Escribe un número de teléfono válido.');
    }

    const now = new Date().toISOString();
    const contact = await this.upsertContact(profile.id, {
      phone,
      displayName: input.displayName,
      primaryChannel: 'manual',
      tags: input.tags,
      notes: input.notes,
      firstSeenAt: now,
      lastActivityAt: now,
    });

    let session = await this.getOrCreateSessionByCompanyId(
      profile.id,
      phone,
    );

    const { count: messageCount, error: messageCountError } =
      await this.supabaseService
        .getClient()
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', session.id);

    if (messageCountError) {
      throw new Error(
        `No se pudo preparar la conversación del contacto: ${messageCountError.message}`,
      );
    }

    if ((messageCount ?? 0) === 0) {
      session = await this.updateAttention(session.id, {
        attention_status: 'waiting',
        assigned_to_user_id: null,
        assigned_to_name: null,
        taken_at: null,
        closed_at: null,
        context: {
          ...session.context,
          manual_contact: true,
          manual_contact_created_at: now,
        },
      });
    }

    return {
      company: { id: profile.id, slug: profile.slug, name: profile.name },
      contact,
      session,
    };
  }

  async updateContact(
    companySlug: string,
    phoneInput: string,
    input: {
      displayName?: string;
      tags?: string[];
      notes?: string;
    },
  ): Promise<ContactRecord> {
    const profile = await this.getCompanyProfile(companySlug);
    const phone = this.normalizePhone(phoneInput);

    if (!phone) {
      throw new Error('Falta el teléfono del contacto.');
    }

    return this.upsertContact(profile.id, {
      phone,
      displayName: input.displayName,
      tags: input.tags,
      notes: input.notes,
    });
  }

  async getOrCreateSessionByCompanyId(
    companyId: string,
    customerPhone: string,
  ): Promise<ConversationSession> {
    const id = companyId.trim();
    const phone = this.normalizePhone(customerPhone);

    if (!id) {
      throw new Error('Falta el identificador de la empresa.');
    }

    if (!phone) {
      throw new Error('Falta el número de teléfono del cliente.');
    }

    const client = this.supabaseService.getClient();

    const localPhone =
      phone.length > 10 ? phone.slice(-10) : phone;

    const phoneCandidates = Array.from(
      new Set(
        [
          phone,
          `+${phone}`,
          localPhone,
          `+${localPhone}`,
        ].filter(Boolean),
      ),
    );

    const { data: existingSessions, error: existingError } = await client
      .from('conversation_sessions')
      .select(SESSION_FIELDS)
      .eq('company_id', id)
      .in('customer_phone', phoneCandidates)
      .order('last_message_at', { ascending: false })
      .limit(20);

    if (existingError) {
      throw new Error(
        `No se pudo consultar la sesión: ${existingError.message}`,
      );
    }

    const matchingSessions = (existingSessions ?? []) as unknown as Array<
      Record<string, unknown>
    >;

    const existingSession =
      matchingSessions.find(
        (row) =>
          typeof row.customer_phone === 'string' &&
          this.normalizePhone(row.customer_phone) === phone,
      ) ??
      matchingSessions.find(
        (row) =>
          typeof row.customer_phone === 'string' &&
          this.normalizePhone(row.customer_phone).slice(-10) === localPhone,
      ) ??
      null;

    if (matchingSessions.length > 1) {
      console.warn(
        `[ChatPro][duplicate-phone-sessions] company=${id} phone=${phone} sessions=${matchingSessions
          .map((row) => String(row.id ?? ''))
          .filter(Boolean)
          .join(',')}`,
      );
    }

    if (existingSession) {
      let sessionRow: Record<string, unknown> = existingSession;

      if (
        matchingSessions.length === 1 &&
        typeof existingSession.customer_phone === 'string' &&
        existingSession.customer_phone !== phone
      ) {
        const { data: normalizedSession, error: normalizeSessionError } =
          await client
            .from('conversation_sessions')
            .update({
              customer_phone: phone,
              updated_at: new Date().toISOString(),
            })
            .eq('id', String(existingSession.id))
            .eq('company_id', id)
            .select(SESSION_FIELDS)
            .single();

        if (normalizeSessionError) {
          console.error(
            `No se pudo normalizar el teléfono de la sesión ${String(existingSession.id)}:`,
            normalizeSessionError,
          );
        } else if (normalizedSession) {
          sessionRow = normalizedSession as unknown as Record<string, unknown>;
        }
      }

      await this.upsertContact(id, {
        phone,
        primaryChannel: 'whatsapp',
        lastActivityAt: new Date().toISOString(),
      });

      return this.toSession(sessionRow);
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

    await this.upsertContact(id, {
      phone,
      primaryChannel: 'whatsapp',
      firstSeenAt: now,
      lastActivityAt: now,
    });

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

    try {
      const session = await this.getSessionById(sessionId);
      await this.upsertContact(session.companyId, {
        phone: session.customerPhone,
        primaryChannel: 'whatsapp',
        lastActivityAt: now,
      });
    } catch (contactError) {
      console.error('No se pudo sincronizar la actividad del contacto:', contactError);
    }
  }

  async getDefaultServiceArea(
    companyId: string,
  ): Promise<ActiveServiceArea | null> {
    const id = companyId.trim();

    if (!id) {
      return null;
    }

    const { data, error } = await this.supabaseService
      .getClient()
      .from('service_areas')
      .select('id, name, description')
      .eq('company_id', id)
      .eq('is_active', true)
      .eq('is_default', true)
      .order('created_at')
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(
        `No se pudo consultar el área predeterminada: ${error.message}`,
      );
    }

    if (!data || typeof data.id !== 'string' || typeof data.name !== 'string') {
      return null;
    }

    return {
      id: data.id,
      name: data.name.trim(),
      description:
        typeof data.description === 'string' ? data.description.trim() : '',
    };
  }

  async listActiveServiceAreas(
    companyId: string,
  ): Promise<ActiveServiceArea[]> {
    const id = companyId.trim();

    if (!id) {
      return [];
    }

    const { data, error } = await this.supabaseService
      .getClient()
      .from('service_areas')
      .select('id, name, description')
      .eq('company_id', id)
      .eq('is_active', true)
      .order('created_at');

    if (error) {
      throw new Error(`No se pudieron consultar las áreas de atención: ${error.message}`);
    }

    return (data ?? []).map((area: any) => ({
      id: String(area.id),
      name: typeof area.name === 'string' ? area.name.trim() : '',
      description:
        typeof area.description === 'string' ? area.description.trim() : '',
    })).filter((area) => area.id && area.name);
  }

  async requestHumanAttention(
    sessionId: string,
    handoff: { reason?: string; summary?: string } = {},
  ): Promise<ConversationSession> {
    const session = await this.getSessionById(sessionId);
    const selectedArea = this.readSelectedServiceArea(session.context);
    const area =
      selectedArea ??
      await this.getDefaultServiceArea(session.companyId);
    const handoffReason = this.compactHandoffText(
      handoff.reason,
      'Requiere atención de un asesor.',
      160,
    );
    const handoffSummary = this.compactHandoffText(
      handoff.summary,
      'Revisa el último mensaje del cliente y continúa la atención.',
      280,
    );
    const nextContext: JsonObject = {
      ...session.context,
      ...(area && !selectedArea
        ? {
            service_area: {
              id: area.id,
              name: area.name,
              selected_at: new Date().toISOString(),
              selected_automatically: true,
            },
          }
        : {}),
      handoff: {
        reason: handoffReason,
        summary: handoffSummary,
        created_at: new Date().toISOString(),
        area_id: area?.id ?? null,
        area_name: area?.name ?? null,
        status: 'pending',
      },
    };

    if (!area) {
      await this.saveHandoffStatus(sessionId, nextContext, 'waiting_no_area');
      return this.updateAttention(sessionId, {
        attention_status: 'waiting',
        assigned_to_user_id: null,
        assigned_to_name: null,
        taken_at: null,
        closed_at: null,
      });
    }

    const canRoute = await this.isHumanAttentionOpen(session.companyId);

    if (!canRoute) {
      await this.saveHandoffStatus(sessionId, nextContext, 'waiting_outside_hours');
      return this.updateAttention(sessionId, {
        attention_status: 'waiting',
        assigned_to_user_id: null,
        assigned_to_name: null,
        taken_at: null,
        closed_at: null,
      });
    }

    const advisor = await this.findAvailableAdvisorForArea(
      session.companyId,
      area.id,
    );

    if (!advisor) {
      await this.saveHandoffStatus(sessionId, nextContext, 'waiting_no_advisor');
      return this.updateAttention(sessionId, {
        attention_status: 'waiting',
        assigned_to_user_id: null,
        assigned_to_name: null,
        taken_at: null,
        closed_at: null,
      });
    }

    await this.saveHandoffStatus(sessionId, nextContext, 'assigned');

    return this.updateAttention(sessionId, {
      attention_status: 'human',
      assigned_to_user_id: advisor.userId,
      assigned_to_name: advisor.fullName,
      taken_at: new Date().toISOString(),
      closed_at: null,
    });
  }

  async assignWaitingSessionsToAdvisor(
    companyId: string,
    advisor: { userId: string; fullName: string },
    limit = 100,
  ): Promise<number> {
    if (
      !companyId.trim() ||
      !advisor.userId.trim() ||
      !advisor.fullName.trim()
    ) {
      return 0;
    }

    if (!(await this.isHumanAttentionOpen(companyId))) {
      return 0;
    }

    const client = this.supabaseService.getClient();
    const max = Math.min(
      Math.max(Math.trunc(limit) || 100, 1),
      100,
    );
    const { data: waitingRows, error: waitingError } = await client
      .from('conversation_sessions')
      .select('id, context')
      .eq('company_id', companyId)
      .eq('attention_status', 'waiting')
      .order('last_message_at', { ascending: true })
      .limit(max);

    if (waitingError) {
      throw new Error(
        `No se pudieron consultar las conversaciones pendientes: ${waitingError.message}`,
      );
    }

    let assigned = 0;

    for (const row of waitingRows ?? []) {
      const context =
        row.context &&
        typeof row.context === 'object' &&
        !Array.isArray(row.context)
          ? row.context as JsonObject
          : {};
      const area = await this.resolveWaitingAreaForAdvisor(
        companyId,
        context,
        advisor.userId,
      );

      if (!area) {
        continue;
      }

      const canReceive =
        await this.advisorCanReceiveArea(
          companyId,
          area.id,
          advisor.userId,
        );

      if (!canReceive) {
        continue;
      }

      const selectedAdvisor = {
        userId: advisor.userId.trim(),
        fullName: advisor.fullName.trim(),
      };

      const now = new Date().toISOString();
      const handoff =
        context.handoff &&
        typeof context.handoff === 'object' &&
        !Array.isArray(context.handoff)
          ? context.handoff as JsonObject
          : {};
      const existingArea =
        this.readSelectedServiceArea(context);

      const nextContext: JsonObject = {
        ...context,
        ...(existingArea
          ? {}
          : {
              service_area: {
                id: area.id,
                name: area.name,
              },
            }),
        handoff: {
          ...handoff,
          status: 'assigned',
          assigned_at: now,
          assigned_to_name: selectedAdvisor.fullName,
        },
      };

      const { data: updated, error: updateError } = await client
        .from('conversation_sessions')
        .update({
          attention_status: 'human',
          assigned_to_user_id: selectedAdvisor.userId,
          assigned_to_name: selectedAdvisor.fullName,
          taken_at: now,
          closed_at: null,
          context: nextContext,
          updated_at: now,
        })
        .eq('id', row.id)
        .eq('company_id', companyId)
        .eq('attention_status', 'waiting')
        .select('id')
        .maybeSingle();

      if (updateError) {
        throw new Error(
          `No se pudo asignar una conversación pendiente: ${updateError.message}`,
        );
      }

      if (updated?.id) {
        assigned += 1;
      }
    }

    return assigned;
  }

  private async saveHandoffStatus(
    sessionId: string,
    context: JsonObject,
    status: 'assigned' | 'waiting_no_area' | 'waiting_outside_hours' | 'waiting_no_advisor',
  ): Promise<void> {
    const handoff =
      context.handoff && typeof context.handoff === 'object' && !Array.isArray(context.handoff)
        ? context.handoff as JsonObject
        : {};

    await this.updateSession(sessionId, {
      context: {
        ...context,
        handoff: {
          ...handoff,
          status,
        },
      },
    });
  }

  private readSelectedServiceArea(
    context: JsonObject,
  ): { id: string; name: string } | null {
    const raw = context.service_area;

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return null;
    }

    const area = raw as JsonObject;
    const id = typeof area.id === 'string' ? area.id.trim() : '';
    const name = typeof area.name === 'string' ? area.name.trim() : '';

    return id && name ? { id, name } : null;
  }

  private async isHumanAttentionOpen(companyId: string): Promise<boolean> {
    const client = this.supabaseService.getClient();
    const { data: settings, error: settingsError } = await client
      .from('company_support_settings')
      .select('timezone, human_attention_enabled')
      .eq('company_id', companyId)
      .maybeSingle();

    if (settingsError) {
      throw new Error(
        `No se pudo consultar la configuración de atención: ${settingsError.message}`,
      );
    }

    if (settings?.human_attention_enabled === false) {
      return false;
    }

    const timezone =
      typeof settings?.timezone === 'string' && settings.timezone.trim()
        ? settings.timezone.trim()
        : 'America/Bogota';

    const now = new Date();
    let parts: Intl.DateTimeFormatPart[];

    try {
      parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(now);
    } catch {
      parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Bogota',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(now);
    }

    const value = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? '';

    const weekDayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };

    const dayOfWeek = weekDayMap[value('weekday')] ?? -1;
    const time = `${value('hour')}:${value('minute')}`;

    if (dayOfWeek < 0 || !/^\d{2}:\d{2}$/.test(time)) {
      return false;
    }

    const { data: day, error: dayError } = await client
      .from('company_support_hours')
      .select('is_open, start_time, end_time')
      .eq('company_id', companyId)
      .eq('day_of_week', dayOfWeek)
      .maybeSingle();

    if (dayError) {
      throw new Error(
        `No se pudo consultar el horario de atención: ${dayError.message}`,
      );
    }

    if (!day?.is_open || !day.start_time || !day.end_time) {
      return false;
    }

    const start = String(day.start_time).slice(0, 5);
    const end = String(day.end_time).slice(0, 5);

    return time >= start && time < end;
  }

  private advisorPresenceCutoffIso(): string {
    const configured =
      Number(process.env.CHATPRO_ADVISOR_PRESENCE_MAX_AGE_SECONDS);
    const seconds =
      Number.isFinite(configured) &&
      configured >= 90 &&
      configured <= 900
        ? Math.trunc(configured)
        : 180;

    return new Date(Date.now() - seconds * 1000).toISOString();
  }

  private async advisorCanReceiveArea(
    companyId: string,
    areaId: string,
    userId: string,
  ): Promise<boolean> {
    const cleanCompanyId = companyId.trim();
    const cleanAreaId = areaId.trim();
    const cleanUserId = userId.trim();

    if (!cleanCompanyId || !cleanAreaId || !cleanUserId) {
      return false;
    }

    const client = this.supabaseService.getClient();

    const [
      { data: assignment, error: assignmentError },
      { data: membership, error: membershipError },
    ] = await Promise.all([
      client
        .from('advisor_service_areas')
        .select('user_id')
        .eq('company_id', cleanCompanyId)
        .eq('area_id', cleanAreaId)
        .eq('user_id', cleanUserId)
        .maybeSingle(),
      client
        .from('company_memberships')
        .select('user_id')
        .eq('company_id', cleanCompanyId)
        .eq('user_id', cleanUserId)
        .eq('active', true)
        .maybeSingle(),
    ]);

    if (assignmentError || membershipError) {
      throw new Error(
        `No se pudo validar el área del asesor: ${
          assignmentError?.message ??
          membershipError?.message ??
          'error desconocido'
        }`,
      );
    }

    return Boolean(assignment?.user_id && membership?.user_id);
  }

  private async resolveWaitingAreaForAdvisor(
    companyId: string,
    context: JsonObject,
    userId: string,
  ): Promise<{ id: string; name: string } | null> {
    const selectedArea = this.readSelectedServiceArea(context);

    if (selectedArea) {
      return selectedArea;
    }

    const client = this.supabaseService.getClient();

    const { data: rows, error } = await client
      .from('advisor_service_areas')
      .select('area_id, service_areas!inner(id, name, is_active)')
      .eq('company_id', companyId)
      .eq('user_id', userId);

    if (error) {
      throw new Error(
        `No se pudieron consultar las áreas del asesor: ${error.message}`,
      );
    }

    const availableAreas = (rows ?? [])
      .map((row: any) => {
        const rawArea = Array.isArray(row.service_areas)
          ? row.service_areas[0]
          : row.service_areas;

        const id =
          typeof rawArea?.id === 'string'
            ? rawArea.id.trim()
            : typeof row.area_id === 'string'
              ? row.area_id.trim()
              : '';

        const name =
          typeof rawArea?.name === 'string'
            ? rawArea.name.trim()
            : '';

        const isActive = rawArea?.is_active !== false;

        return { id, name, isActive };
      })
      .filter(
        (area) =>
          area.id &&
          area.name &&
          area.isActive,
      );

    if (availableAreas.length !== 1) {
      return null;
    }

    return {
      id: availableAreas[0].id,
      name: availableAreas[0].name,
    };
  }

  private async findAvailableAdvisorForArea(
    companyId: string,
    areaId: string,
  ): Promise<{ userId: string; fullName: string } | null> {
    const client = this.supabaseService.getClient();

    const { data: areaAssignments, error: areaError } = await client
      .from('advisor_service_areas')
      .select('user_id')
      .eq('company_id', companyId)
      .eq('area_id', areaId);

    if (areaError) {
      throw new Error(
        `No se pudieron consultar los asesores del área: ${areaError.message}`,
      );
    }

    const areaUserIds = [...new Set(
      (areaAssignments ?? [])
        .map((row: any) => typeof row.user_id === 'string' ? row.user_id : '')
        .filter(Boolean),
    )];

    if (!areaUserIds.length) {
      return null;
    }

    const [
      { data: memberships, error: membershipError },
      { data: availability, error: availabilityError },
      { data: profiles, error: profileError },
    ] = await Promise.all([
      client
        .from('company_memberships')
        .select('user_id')
        .eq('company_id', companyId)
        .eq('active', true)
        .in('user_id', areaUserIds),
      client
        .from('advisor_availability')
        .select('user_id, status, last_seen_at')
        .eq('company_id', companyId)
        .eq('status', 'available')
        .gte('last_seen_at', this.advisorPresenceCutoffIso())
        .in('user_id', areaUserIds),
      client
        .from('app_profiles')
        .select('user_id, full_name')
        .in('user_id', areaUserIds),
    ]);

    if (membershipError || availabilityError || profileError) {
      throw new Error(
        `No se pudo consultar la disponibilidad de asesores: ${
          membershipError?.message ??
          availabilityError?.message ??
          profileError?.message ??
          'error desconocido'
        }`,
      );
    }

    const active = new Set(
      (memberships ?? [])
        .map((row: any) => typeof row.user_id === 'string' ? row.user_id : '')
        .filter(Boolean),
    );
    const available = new Set(
      (availability ?? [])
        .map((row: any) => typeof row.user_id === 'string' ? row.user_id : '')
        .filter(Boolean),
    );
    const names = new Map<string, string>();

    for (const row of profiles ?? []) {
      const userId =
        typeof (row as any).user_id === 'string'
          ? (row as any).user_id
          : '';
      const fullName =
        typeof (row as any).full_name === 'string'
          ? (row as any).full_name.trim()
          : '';

      if (userId && fullName) {
        names.set(userId, fullName);
      }
    }

    const candidates = areaUserIds
      .filter((userId) => active.has(userId) && available.has(userId) && names.has(userId))
      .sort();

    if (!candidates.length) {
      return null;
    }

    const { data: activeChats, error: chatsError } = await client
      .from('conversation_sessions')
      .select('assigned_to_user_id')
      .eq('company_id', companyId)
      .eq('attention_status', 'human')
      .in('assigned_to_user_id', candidates);

    if (chatsError) {
      throw new Error(
        `No se pudo calcular la carga de asesores: ${chatsError.message}`,
      );
    }

    const loads = new Map(candidates.map((userId) => [userId, 0]));

    for (const chat of activeChats ?? []) {
      const userId =
        typeof (chat as any).assigned_to_user_id === 'string'
          ? (chat as any).assigned_to_user_id
          : '';

      if (loads.has(userId)) {
        loads.set(userId, (loads.get(userId) ?? 0) + 1);
      }
    }

    const chosen = candidates
      .map((userId) => ({
        userId,
        fullName: names.get(userId) as string,
        load: loads.get(userId) ?? 0,
      }))
      .sort(
        (left, right) =>
          left.load - right.load ||
          left.fullName.localeCompare(right.fullName, 'es-CO'),
      )[0];

    return chosen ? { userId: chosen.userId, fullName: chosen.fullName } : null;
  }

  async takeConversation(
    sessionId: string,
    advisor: { userId: string; fullName: string },
  ): Promise<ConversationSession> {
    const userId = advisor.userId.trim();
    const name = advisor.fullName.trim();
    if (!userId || !name) throw new Error('Falta el asesor autenticado.');
    const now = new Date().toISOString();

    return this.updateAttention(sessionId, {
      attention_status: 'human',
      assigned_to_user_id: userId,
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
    options: {
      status?: string;
      limit?: number;
      offset?: number;
      search?: string;
      advisorUserId?: string;
      visibility?: {
        isFullAccess: boolean;
        userId: string;
        canViewOwn: boolean;
        canViewAi: boolean;
        canViewWaiting: boolean;
        canViewTeam: boolean;
        canTake: boolean;
        advisorsCanTakeAi: boolean;
        aiTakeAfterMinutes: number;
      };
    } = {},
  ): Promise<{
    company: { id: string; slug: string; name: string };
    sessions: InboxSessionSummary[];
    hasMore: boolean;
    nextOffset: number;
    pendingTotal: number;
  }> {
    const profile = await this.getCompanyProfile(companySlug);
    const limit = Math.min(
      Math.max(Math.trunc(options.limit ?? 20) || 20, 1),
      50,
    );
    const offset = Math.max(Math.trunc(options.offset ?? 0) || 0, 0);
    const searchText = options.search?.trim() ?? '';
    const advisorUserId = options.advisorUserId?.trim() ?? '';
    const normalizedStatus = this.normalizeStatusFilter(options.status ?? 'all');
    const visibility = options.visibility;
    const client = this.supabaseService.getClient();

    const matchedSessionIds = new Set<string>();

    if (searchText) {
      const normalizedPhoneSearch = this.normalizePhone(searchText);

      if (normalizedPhoneSearch) {
        const { data: phoneRows, error: phoneError } = await client
          .from('conversation_sessions')
          .select('id')
          .eq('company_id', profile.id)
          .ilike('customer_phone', `%${normalizedPhoneSearch}%`)
          .limit(500);

        if (phoneError) {
          throw new Error(
            `No se pudieron buscar conversaciones por teléfono: ${phoneError.message}`,
          );
        }

        for (const row of phoneRows ?? []) {
          if (typeof row.id === 'string') {
            matchedSessionIds.add(row.id);
          }
        }
      }

      const { data: contactRows, error: contactError } = await client
        .from('contacts')
        .select('phone')
        .eq('company_id', profile.id)
        .ilike('display_name', `%${searchText}%`)
        .limit(500);

      if (contactError) {
        throw new Error(
          `No se pudieron buscar conversaciones por nombre: ${contactError.message}`,
        );
      }

      const contactPhones = (contactRows ?? [])
        .map((row) => row.phone)
        .filter(
          (phone): phone is string =>
            typeof phone === 'string' && Boolean(phone.trim()),
        );

      if (contactPhones.length) {
        const { data: contactSessionRows, error: contactSessionError } =
          await client
            .from('conversation_sessions')
            .select('id')
            .eq('company_id', profile.id)
            .in('customer_phone', contactPhones)
            .limit(500);

        if (contactSessionError) {
          throw new Error(
            `No se pudieron relacionar los contactos encontrados: ${contactSessionError.message}`,
          );
        }

        for (const row of contactSessionRows ?? []) {
          if (typeof row.id === 'string') {
            matchedSessionIds.add(row.id);
          }
        }
      }

      const { data: messageRows, error: messageSearchError } = await client
        .from('conversations')
        .select('session_id')
        .eq('company_id', profile.id)
        .ilike('message', `%${searchText}%`)
        .order('created_at', { ascending: false })
        .limit(500);

      if (messageSearchError) {
        throw new Error(
          `No se pudieron buscar conversaciones por mensaje: ${messageSearchError.message}`,
        );
      }

      for (const row of messageRows ?? []) {
        if (typeof row.session_id === 'string') {
          matchedSessionIds.add(row.session_id);
        }
      }

      if (!matchedSessionIds.size) {
        return {
          company: { id: profile.id, slug: profile.slug, name: profile.name },
          sessions: [],
          hasMore: false,
          nextOffset: offset,
          pendingTotal: 0,
        };
      }
    }

    const applyCommonFilters = (query: any) => {
      let filtered = query.eq('company_id', profile.id);

      if (normalizedStatus) {
        filtered = filtered.eq('attention_status', normalizedStatus);
      }

      if (searchText) {
        filtered = filtered.in('id', Array.from(matchedSessionIds));
      }

      if (advisorUserId) {
        filtered = filtered.eq(
          'assigned_to_user_id',
          advisorUserId,
        );
      }

      if (
        visibility &&
        !visibility.isFullAccess &&
        !searchText
      ) {
        const conditions: string[] = [];

        if (visibility.canViewOwn && visibility.userId) {
          conditions.push(
            `assigned_to_user_id.eq.${visibility.userId}`,
          );
        }

        if (visibility.canViewAi) {
          conditions.push('attention_status.eq.ai');
        }

        if (visibility.canViewWaiting) {
          conditions.push('attention_status.eq.waiting');
        }

        if (visibility.canViewTeam) {
          conditions.push('attention_status.eq.human');
        }

        if (visibility.canTake) {
          conditions.push('attention_status.eq.waiting');

          if (visibility.advisorsCanTakeAi) {
            const cutoff = new Date(
              Date.now() -
                Math.max(0, visibility.aiTakeAfterMinutes) * 60_000,
            ).toISOString();

            conditions.push(
              `and(attention_status.eq.ai,last_message_at.lte.${cutoff})`,
            );
          }
        }

        if (!conditions.length) {
          filtered = filtered.eq('id', '__no_visible_sessions__');
        } else {
          filtered = filtered.or(conditions.join(','));
        }
      }

      return filtered;
    };

    let pendingQuery = applyCommonFilters(
      client
        .from('conversation_sessions')
        .select(SESSION_FIELDS)
        .gt('pending_count', 0),
    )
      .order('last_message_at', { ascending: false });

    const { data: pendingRows, error: pendingError } = await pendingQuery;

    if (pendingError) {
      throw new Error(
        `No se pudieron consultar las conversaciones pendientes: ${pendingError.message}`,
      );
    }

    const pendingSessions = (pendingRows ?? []).map((row) =>
      this.toSession(row),
    );

    const recentPageSize = limit;

    let recentSessions: ConversationSession[] = [];
    let hasMore = false;

    if (recentPageSize > 0) {
      const recentQuery = applyCommonFilters(
        client
          .from('conversation_sessions')
          .select(SESSION_FIELDS)
          .eq('pending_count', 0),
      )
        .order('last_message_at', { ascending: false })
        .range(offset, offset + recentPageSize);

      const { data: recentRows, error: recentError } = await recentQuery;

      if (recentError) {
        throw new Error(
          `No se pudieron consultar las conversaciones recientes: ${recentError.message}`,
        );
      }

      const recentCandidates = (recentRows ?? []).map((row) =>
        this.toSession(row),
      );

      hasMore = recentCandidates.length > recentPageSize;
      recentSessions = recentCandidates.slice(0, recentPageSize);
    } else {
      const countQuery = applyCommonFilters(
        client
          .from('conversation_sessions')
          .select('id', { count: 'exact', head: true })
          .eq('pending_count', 0),
      );

      const { count, error: countError } = await countQuery;

      if (countError) {
        throw new Error(
          `No se pudo verificar si existen más conversaciones: ${countError.message}`,
        );
      }

      hasMore = (count ?? 0) > offset;
    }

    const sessions = [...pendingSessions, ...recentSessions];
    const uniqueSessions = Array.from(
      new Map(sessions.map((session) => [session.id, session])).values(),
    ).sort(
      (left, right) =>
        new Date(right.lastMessageAt).getTime() -
        new Date(left.lastMessageAt).getTime(),
    );

    if (!uniqueSessions.length) {
      return {
        company: { id: profile.id, slug: profile.slug, name: profile.name },
        sessions: [],
        hasMore,
        nextOffset: offset + recentSessions.length,
        pendingTotal: pendingSessions.length,
      };
    }

    const sessionIds = uniqueSessions.map((session) => session.id);

    const { data: messageRows, error: messageError } = await client
      .from('conversations')
      .select(
        'id, session_id, message, sender, author_type, message_type, media_mime_type, media_storage_path, media_voice, created_at',
      )
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

    const contactsByPhone = await this.getContactsByPhones(
      profile.id,
      uniqueSessions.map((session) => session.customerPhone),
    );

    return {
      company: { id: profile.id, slug: profile.slug, name: profile.name },
      sessions: uniqueSessions.map((session) => ({
        ...session,
        contact: contactsByPhone.get(session.customerPhone) ?? null,
        lastMessage: latestBySession.get(session.id) ?? null,
      })),
      hasMore,
      nextOffset: offset + recentSessions.length,
      pendingTotal: pendingSessions.length,
    };
  }

  async listClients(
    companySlug: string,
    search: string = '',
    limit: number = 100,
  ): Promise<{
    company: { id: string; slug: string; name: string };
    clients: ClientSummary[];
  }> {
    const profile = await this.getCompanyProfile(companySlug);
    const max = Math.min(Math.max(Math.trunc(limit) || 100, 1), 150);
    const searchText = search.trim();
    const normalizedPhoneSearch = this.normalizePhone(searchText);
    const client = this.supabaseService.getClient();

    let query = client
      .from('conversation_sessions')
      .select(SESSION_FIELDS)
      .eq('company_id', profile.id)
      .order('last_message_at', { ascending: false })
      .limit(max);

    if (searchText) {
      const matchedPhones = new Set<string>();

      if (normalizedPhoneSearch) {
        const { data: phoneRows, error: phoneError } = await client
          .from('conversation_sessions')
          .select('customer_phone')
          .eq('company_id', profile.id)
          .ilike('customer_phone', `%${normalizedPhoneSearch}%`)
          .limit(max);

        if (phoneError) {
          throw new Error(
            `No se pudieron buscar clientes por teléfono: ${phoneError.message}`,
          );
        }

        for (const row of phoneRows ?? []) {
          if (typeof row.customer_phone === 'string' && row.customer_phone) {
            matchedPhones.add(row.customer_phone);
          }
        }
      }

      const { data: contactRows, error: contactError } = await client
        .from('contacts')
        .select('phone')
        .eq('company_id', profile.id)
        .ilike('display_name', `%${searchText}%`)
        .limit(max);

      if (contactError) {
        throw new Error(
          `No se pudieron buscar clientes por nombre: ${contactError.message}`,
        );
      }

      for (const row of contactRows ?? []) {
        if (typeof row.phone === 'string' && row.phone) {
          matchedPhones.add(row.phone);
        }
      }

      if (!matchedPhones.size) {
        return {
          company: { id: profile.id, slug: profile.slug, name: profile.name },
          clients: [],
        };
      }

      query = query.in('customer_phone', Array.from(matchedPhones));
    }

    const { data: sessionRows, error: sessionError } = await query;

    if (sessionError) {
      throw new Error(
        `No se pudieron consultar los clientes: ${sessionError.message}`,
      );
    }

    const sessions = (sessionRows ?? []).map((row) => this.toSession(row));

    if (!sessions.length) {
      return {
        company: { id: profile.id, slug: profile.slug, name: profile.name },
        clients: [],
      };
    }

    const sessionIds = sessions.map((session) => session.id);
    const { data: messageRows, error: messageError } = await client
      .from('conversations')
      .select('id, session_id, message, sender, author_type, message_type, media_mime_type, media_storage_path, media_voice, created_at')
      .in('session_id', sessionIds)
      .order('created_at', { ascending: true });

    if (messageError) {
      throw new Error(
        `No se pudo consultar el historial de clientes: ${messageError.message}`,
      );
    }

    const messagesBySession = new Map<string, InboxMessage[]>();

    for (const row of messageRows ?? []) {
      const message = this.toInboxMessage(row);
      const current = messagesBySession.get(message.sessionId) ?? [];
      current.push(message);
      messagesBySession.set(message.sessionId, current);
    }

    const contactsByPhone = await this.getContactsByPhones(
      profile.id,
      sessions.map((session) => session.customerPhone),
    );

    return {
      company: { id: profile.id, slug: profile.slug, name: profile.name },
      clients: sessions.map((session) =>
        this.buildClientSummary(
          session,
          messagesBySession.get(session.id) ?? [],
          contactsByPhone.get(session.customerPhone) ?? null,
        ),
      ),
    };
  }

  async getClientProfile(
    companySlug: string,
    customerPhone: string,
  ): Promise<ClientProfile> {
    const profile = await this.getCompanyProfile(companySlug);
    const phone = customerPhone.trim();

    if (!phone) {
      throw new Error('Falta el número de teléfono del cliente.');
    }

    const client = this.supabaseService.getClient();
    const { data: sessionRow, error: sessionError } = await client
      .from('conversation_sessions')
      .select(SESSION_FIELDS)
      .eq('company_id', profile.id)
      .eq('customer_phone', phone)
      .maybeSingle();

    if (sessionError) {
      throw new Error(
        `No se pudo consultar el cliente: ${sessionError.message}`,
      );
    }

    if (!sessionRow) {
      throw new Error('El cliente no existe para esta empresa.');
    }

    const session = this.toSession(sessionRow);
    const { data: messageRows, error: messageError } = await client
      .from('conversations')
      .select('id, session_id, message, sender, author_type, message_type, media_mime_type, media_storage_path, media_voice, created_at')
      .eq('session_id', session.id)
      .order('created_at', { ascending: true });

    if (messageError) {
      throw new Error(
        `No se pudo consultar el historial del cliente: ${messageError.message}`,
      );
    }

    const messages = (messageRows ?? []).map((row) =>
      this.toInboxMessage(row),
    );

    const contactsByPhone = await this.getContactsByPhones(
      profile.id,
      [session.customerPhone],
    );

    return {
      company: { id: profile.id, slug: profile.slug, name: profile.name },
      client: this.buildClientSummary(
        session,
        messages,
        contactsByPhone.get(session.customerPhone) ?? null,
      ),
      session,
      messages,
    };
  }

  async getInboxConversation(
    companySlug: string,
    sessionId: string,
    afterCreatedAt = '',
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

    const requestedAfter = afterCreatedAt.trim();
    const validAfter =
      requestedAfter && !Number.isNaN(Date.parse(requestedAfter))
        ? requestedAfter
        : '';

    const messageFields =
      'id, session_id, message, sender, author_type, message_type, media_mime_type, media_storage_path, media_voice, created_at';

    let messageRows: any[] | null = null;
    let messageError: { message: string } | null = null;

    if (validAfter) {
      const result = await client
        .from('conversations')
        .select(messageFields)
        .eq('session_id', id)
        .gte('created_at', validAfter)
        .order('created_at', { ascending: true });

      messageRows = result.data;
      messageError = result.error;
    } else {
      const result = await client
        .from('conversations')
        .select(messageFields)
        .eq('session_id', id)
        .order('created_at', { ascending: false })
        .limit(30);

      messageRows = result.data ? [...result.data].reverse() : [];
      messageError = result.error;
    }

    if (messageError) {
      throw new Error(
        `No se pudo consultar el historial: ${messageError.message}`,
      );
    }

    const session = this.toSession(sessionRow);
    const contactsByPhone = await this.getContactsByPhones(
      profile.id,
      [session.customerPhone],
    );

    return {
      company: { id: profile.id, slug: profile.slug, name: profile.name },
      session,
      contact: contactsByPhone.get(session.customerPhone) ?? null,
      messages: (messageRows ?? []).map((row) => this.toInboxMessage(row)),
    };
  }

  async getRecentMessagesForAi(
    sessionId: string,
    limit = 14,
  ): Promise<
    Array<{
      sender: string;
      authorType: string;
      message: string;
      messageType: string;
      mediaMimeType: string | null;
      createdAt: string | null;
    }>
  > {
    const id = sessionId.trim();
    const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 30);

    if (!id) {
      return [];
    }

    const { data, error } = await this.supabaseService
      .getClient()
      .from('conversations')
      .select(
        'sender, author_type, message, message_type, media_mime_type, created_at',
      )
      .eq('session_id', id)
      .order('created_at', { ascending: false })
      .limit(safeLimit);

    if (error) {
      throw new Error(
        `No se pudo consultar el contexto reciente: ${error.message}`,
      );
    }

    return (data ?? [])
      .reverse()
      .map((row) => ({
        sender: typeof row.sender === 'string' ? row.sender : '',
        authorType:
          typeof row.author_type === 'string' ? row.author_type : '',
        message: typeof row.message === 'string' ? row.message : '',
        messageType:
          typeof row.message_type === 'string' ? row.message_type : 'text',
        mediaMimeType:
          typeof row.media_mime_type === 'string'
            ? row.media_mime_type
            : null,
        createdAt:
          typeof row.created_at === 'string' ? row.created_at : null,
      }));
  }

  async persistIncomingMedia(input: {
    companyId: string;
    sessionId: string;
    mediaId: string;
    providerMessageId?: string | null;
    buffer: Buffer;
    mimeType: string;
    filename?: string | null;
  }): Promise<string> {
    const cleanMime =
      input.mimeType.split(';')[0].trim().toLowerCase() ||
      'application/octet-stream';
    const extensionByMime: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'audio/ogg': 'ogg',
      'audio/mpeg': 'mp3',
      'audio/mp4': 'm4a',
      'audio/aac': 'aac',
    };
    const fallbackExtension = extensionByMime[cleanMime] || 'bin';
    const rawFilename = input.filename?.trim() || `media.${fallbackExtension}`;
    const safeFilename = rawFilename
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120) || `media.${fallbackExtension}`;
    const identity =
      input.providerMessageId?.trim() ||
      input.mediaId.trim() ||
      `${Date.now()}`;
    const safeIdentity = identity.replace(/[^a-zA-Z0-9_-]+/g, '-');
    const storagePath =
      `${input.companyId}/${input.sessionId}/${safeIdentity}-${safeFilename}`;

    const client = this.supabaseService.getClient();
    const { error: uploadError } = await client.storage
      .from('chatpro-media')
      .upload(storagePath, input.buffer, {
        contentType: cleanMime,
        upsert: true,
      });

    if (uploadError) {
      throw new Error(
        `No se pudo guardar el archivo permanente: ${uploadError.message}`,
      );
    }

    let update = client
      .from('conversations')
      .update({ media_storage_path: storagePath })
      .eq('company_id', input.companyId)
      .eq('session_id', input.sessionId)
      .eq('media_id', input.mediaId);

    if (input.providerMessageId?.trim()) {
      update = update.eq(
        'provider_message_id',
        input.providerMessageId.trim(),
      );
    }

    const { error: updateError } = await update;

    if (updateError) {
      await client.storage.from('chatpro-media').remove([storagePath]);
      throw new Error(
        `No se pudo vincular el archivo al mensaje: ${updateError.message}`,
      );
    }

    return storagePath;
  }

  async saveMessage(input: SaveMessageInput): Promise<'saved' | 'duplicate'> {
    const customerPhone = this.normalizePhone(input.customerPhone);

    if (!customerPhone) {
      throw new Error('El mensaje no tiene un teléfono de cliente válido.');
    }

    const providerMessageId = input.providerMessageId?.trim() || null;
    const authorType =
      input.authorType ?? (input.sender === 'customer' ? 'customer' : 'ai');

    const { error } = await this.supabaseService
      .getClient()
      .from('conversations')
      .insert({
        company_id: input.companyId,
        session_id: input.sessionId,
        customer_phone: customerPhone,
        message: input.message,
        sender: input.sender,
        author_type: authorType,
        message_type: input.messageType ?? 'text',
        status: input.sender === 'customer' ? 'received' : 'sent',
        ai_response: input.aiResponse ?? null,
        provider_message_id: providerMessageId,
        media_id: input.mediaId?.trim() || null,
        media_mime_type: input.mediaMimeType?.trim() || null,
        media_storage_path: input.mediaStoragePath?.trim() || null,
        media_filename: input.mediaFilename?.trim() || null,
        media_voice: input.mediaVoice === true,
      });

    if (error) {
      if (providerMessageId && error.code === '23505') {
        return 'duplicate';
      }

      throw new Error(`No se pudo guardar el mensaje: ${error.message}`);
    }

    if (input.sender === 'assistant' && authorType === 'ai') {
      try {
        const client = this.supabaseService.getClient();

        const { data: sessionRow } = await client
          .from('conversation_sessions')
          .select(
            'attention_status, context, pending_count, pending_since',
          )
          .eq('id', input.sessionId)
          .eq('company_id', input.companyId)
          .maybeSingle();

        const context =
          sessionRow?.context &&
          typeof sessionRow.context === 'object' &&
          !Array.isArray(sessionRow.context)
            ? sessionRow.context as Record<string, unknown>
            : {};

        const handoff =
          context.handoff &&
          typeof context.handoff === 'object' &&
          !Array.isArray(context.handoff)
            ? context.handoff as Record<string, unknown>
            : null;

        const handoffPending =
          handoff &&
          typeof handoff.status === 'string' &&
          handoff.status.startsWith('pending');

        const humanAttention =
          sessionRow?.attention_status === 'waiting' ||
          sessionRow?.attention_status === 'human';

        if (handoffPending && humanAttention) {
          const currentPending = Number(sessionRow?.pending_count ?? 0);
          const existingPendingSince =
            typeof sessionRow?.pending_since === 'string' &&
            sessionRow.pending_since.trim()
              ? sessionRow.pending_since
              : null;

          await client
            .from('conversation_sessions')
            .update({
              pending_count: Math.max(1, currentPending),
              pending_since:
                existingPendingSince ?? new Date().toISOString(),
            })
            .eq('id', input.sessionId)
            .eq('company_id', input.companyId);
        }
      } catch (handoffPendingError) {
        console.error(
          `No se pudo conservar la alerta de transferencia de la sesión ${input.sessionId}:`,
          handoffPendingError,
        );
      }
    }

    if (input.sender === 'customer' && authorType === 'customer') {
      try {
        const notification =
          await this.pushNotificationService.notifyAssignedAdvisorForIncomingMessage(
            {
              companyId: input.companyId,
              sessionId: input.sessionId,
              customerPhone: input.customerPhone,
              message: input.message,
            },
          );

        if (notification.sent > 0) {
          console.log(
            `Notificación enviada al asesor asignado de la sesión ${input.sessionId}.`,
          );
        }
      } catch (notificationError) {
        console.error(
          `No se pudo notificar el mensaje entrante de la sesión ${input.sessionId}:`,
          notificationError,
        );
      }
    }

    return 'saved';
  }

  private async upsertContact(
    companyId: string,
    input: {
      phone: string;
      displayName?: string;
      primaryChannel?: 'whatsapp' | 'instagram' | 'messenger' | 'manual';
      tags?: string[];
      notes?: string;
      firstSeenAt?: string;
      lastActivityAt?: string;
    },
  ): Promise<ContactRecord> {
    const phone = this.normalizePhone(input.phone);

    if (!phone) {
      throw new Error('El contacto no tiene un teléfono válido.');
    }

    const client = this.supabaseService.getClient();
    const { data: existing, error: findError } = await client
      .from('contacts')
      .select(
        'id, company_id, phone, display_name, primary_channel, tags, notes, first_seen_at, last_activity_at',
      )
      .eq('company_id', companyId)
      .eq('phone', phone)
      .maybeSingle();

    if (findError) {
      throw new Error(`No se pudo consultar el contacto: ${findError.message}`);
    }

    const now = new Date().toISOString();
    const payload = {
      company_id: companyId,
      phone,
      display_name:
        input.displayName === undefined
          ? existing?.display_name ?? null
          : input.displayName.trim() || null,
      primary_channel:
        input.primaryChannel ?? existing?.primary_channel ?? 'whatsapp',
      tags:
        input.tags === undefined
          ? this.toTags(existing?.tags)
          : this.toTags(input.tags),
      notes:
        input.notes === undefined
          ? typeof existing?.notes === 'string'
            ? existing.notes
            : ''
          : input.notes.trim(),
      first_seen_at:
        existing?.first_seen_at ?? input.firstSeenAt ?? now,
      last_activity_at:
        input.lastActivityAt ??
        existing?.last_activity_at ??
        now,
      updated_at: now,
    };

    const result = existing?.id
      ? await client
          .from('contacts')
          .update(payload)
          .eq('id', existing.id)
          .select(
            'id, company_id, phone, display_name, primary_channel, tags, notes, first_seen_at, last_activity_at',
          )
          .single()
      : await client
          .from('contacts')
          .insert(payload)
          .select(
            'id, company_id, phone, display_name, primary_channel, tags, notes, first_seen_at, last_activity_at',
          )
          .single();

    if (result.error || !result.data) {
      throw new Error(
        `No se pudo guardar el contacto: ${result.error?.message ?? 'respuesta vacía'}`,
      );
    }

    return this.toContact(result.data);
  }

  private async getContactsByPhones(
    companyId: string,
    phones: string[],
  ): Promise<Map<string, ContactRecord>> {
    if (!phones.length) {
      return new Map();
    }

    const { data, error } = await this.supabaseService
      .getClient()
      .from('contacts')
      .select(
        'id, company_id, phone, display_name, primary_channel, tags, notes, first_seen_at, last_activity_at',
      )
      .eq('company_id', companyId)
      .in('phone', phones);

    if (error) {
      throw new Error(`No se pudieron consultar los contactos: ${error.message}`);
    }

    return new Map(
      (data ?? []).map((row) => {
        const contact = this.toContact(row);
        return [contact.phone, contact];
      }),
    );
  }

  private toContact(value: unknown): ContactRecord {
    const row =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

    const channel =
      row.primary_channel === 'instagram' ||
      row.primary_channel === 'messenger' ||
      row.primary_channel === 'manual'
        ? row.primary_channel
        : 'whatsapp';

    return {
      id: typeof row.id === 'string' ? row.id : '',
      companyId: typeof row.company_id === 'string' ? row.company_id : '',
      phone: typeof row.phone === 'string' ? row.phone : '',
      displayName:
        typeof row.display_name === 'string' && row.display_name.trim()
          ? row.display_name.trim()
          : null,
      primaryChannel: channel,
      tags: this.toTags(row.tags),
      notes: typeof row.notes === 'string' ? row.notes : '',
      firstSeenAt:
        typeof row.first_seen_at === 'string' ? row.first_seen_at : null,
      lastActivityAt:
        typeof row.last_activity_at === 'string' ? row.last_activity_at : null,
    };
  }

  private toTags(value: unknown): string[] {
    const source = Array.isArray(value) ? value : [];
    const unique = new Set<string>();

    for (const item of source) {
      if (typeof item !== 'string') {
        continue;
      }

      const clean = item.trim().replace(/\s+/g, ' ').slice(0, 40);

      if (clean) {
        unique.add(clean);
      }
    }

    return Array.from(unique).slice(0, 15);
  }

  private normalizePhone(value: string): string {
    return value.trim().replace(/\D/g, '');
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

  private buildClientSummary(
    session: ConversationSession,
    messages: InboxMessage[],
    contact: ContactRecord | null = null,
  ): ClientSummary {
    const firstMessage = messages[0] ?? null;
    const lastMessage = messages[messages.length - 1] ?? null;

    return {
      customerPhone: session.customerPhone,
      contact,
      firstMessageAt: firstMessage?.createdAt ?? null,
      lastMessageAt: session.lastMessageAt,
      attentionStatus: session.attentionStatus,
      assignedToUserId: session.assignedToUserId,
      assignedToName: session.assignedToName,
      totalMessages: messages.length,
      lastMessage,
    };
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
      pendingCount:
        typeof row.pending_count === 'number' &&
        Number.isFinite(row.pending_count)
          ? Math.max(0, Math.trunc(row.pending_count))
          : 0,
      pendingSince:
        typeof row.pending_since === 'string' && row.pending_since.trim()
          ? row.pending_since
          : null,
      attentionStatus: this.toAttentionStatus(
        row.attention_status,
      ),
      assignedToUserId:
        typeof row.assigned_to_user_id === 'string' &&
        row.assigned_to_user_id.trim()
          ? row.assigned_to_user_id
          : null,
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
    message_type?: string | null;
    media_mime_type?: string | null;
    media_storage_path?: string | null;
    media_voice?: boolean | null;
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
      messageType:
        message.message_type === 'audio'
          ? 'audio'
          : message.message_type === 'image'
            ? 'image'
            : 'text',
      mediaMimeType:
        typeof message.media_mime_type === 'string' &&
        message.media_mime_type.trim()
          ? message.media_mime_type
          : null,
      mediaStoragePath:
        typeof message.media_storage_path === 'string' &&
        message.media_storage_path.trim()
          ? message.media_storage_path
          : null,
      mediaVoice: message.media_voice === true,
      createdAt: message.created_at ?? null,
    };
  }

  private toAttentionStatus(value: unknown): AttentionStatus {
    if (value === 'waiting' || value === 'human' || value === 'closed') {
      return value;
    }

    return 'ai';
  }

  private normalizeCartRecovery(value: unknown): JsonObject {
    const source =
      value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};

    const result: JsonObject = {};

    const fallbackMessage =
      typeof source.fallbackMessage === 'string'
        ? source.fallbackMessage.trim().slice(0, 2000)
        : '';

    if (fallbackMessage) {
      result.fallback_message = fallbackMessage;
    }

    const defaultCountryCode =
      typeof source.defaultCountryCode === 'string'
        ? source.defaultCountryCode.replace(/\D/g, '').slice(0, 4)
        : '';

    if (defaultCountryCode) {
      result.default_country_code = defaultCountryCode;
    }

    const replyContextHours =
      typeof source.replyContextHours === 'number'
        ? source.replyContextHours
        : typeof source.replyContextHours === 'string'
          ? Number(source.replyContextHours)
          : Number.NaN;

    if (
      Number.isInteger(replyContextHours) &&
      replyContextHours >= 1 &&
      replyContextHours <= 168
    ) {
      result.reply_context_hours = replyContextHours;
    }

    if (source.testMode === true) {
      result.test_mode = true;
    } else if (source.testMode === false) {
      result.test_mode = false;
    }

    const testPhonesSource = source.testPhones;
    const testPhones = Array.isArray(testPhonesSource)
      ? testPhonesSource
      : typeof testPhonesSource === 'string'
        ? testPhonesSource.split(/[\n,;]+/)
        : [];

    const cleanedPhones = testPhones
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.replace(/[^0-9+]/g, '').trim())
      .filter(Boolean)
      .slice(0, 50);

    if (cleanedPhones.length) {
      result.test_phones = cleanedPhones;
    }

    return result;
  }

  private normalizeCommercialFlow(value: unknown): JsonObject {
    const source =
      value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};

    const mapping: Array<[string, string]> = [
      ['welcome_message', 'welcomeMessage'],
      ['area_welcome_message', 'areaWelcomeMessage'],
      ['sales_instructions', 'salesInstructions'],
      ['shipping_instructions', 'shippingInstructions'],
      ['payment_instructions', 'paymentInstructions'],
      ['checkout_instructions', 'checkoutInstructions'],
    ];

    const result: JsonObject = {};

    for (const [storedKey, inputKey] of mapping) {
      const raw = source[inputKey];
      const text = typeof raw === 'string' ? raw.trim() : '';

      if (text) {
        result[storedKey] = text;
      }
    }

    const responseLength =
      typeof source.responseLength === 'string'
        ? source.responseLength.trim().toLowerCase()
        : '';

    result.response_length =
      responseLength === 'balanced' ||
      responseLength === 'detailed'
        ? responseLength
        : 'brief';

    const maxQuestions = Number(source.maxQuestionsPerMessage);

    result.max_questions_per_message =
      Number.isInteger(maxQuestions) &&
      maxQuestions >= 1 &&
      maxQuestions <= 3
        ? maxQuestions
        : 1;

    result.avoid_repetition =
      source.avoidRepetition !== false;
    result.show_restrictions_only_when_relevant =
      source.showRestrictionsOnlyWhenRelevant !== false;
    result.ask_before_showing_catalog =
      source.askBeforeShowingCatalog !== false;

    return result;
  }

  private normalizeKnowledgeBase(value: unknown): JsonObject {
    const source =
      value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};

    const mapping: Array<[string, string]> = [
      ['terms_conditions', 'termsConditions'],
      ['exchanges_returns', 'exchangesReturns'],
      ['warranties', 'warranties'],
      ['policies_faq', 'policiesFaq'],
    ];

    const result: JsonObject = {};

    for (const [storedKey, inputKey] of mapping) {
      const raw = source[inputKey];
      const text = typeof raw === 'string' ? raw.trim() : '';

      if (text) {
        result[storedKey] = text;
      }
    }

    return result;
  }

  private compactHandoffText(
    value: unknown,
    fallback: string,
    maxLength: number,
  ): string {
    const normalized =
      typeof value === 'string'
        ? value
            .replace(/\s+/g, ' ')
            .replace(/^(motivo|resumen|detalle)\s*:\s*/i, '')
            .trim()
        : '';

    if (!normalized) {
      return fallback;
    }

    if (normalized.length <= maxLength) {
      return normalized;
    }

    return `${normalized.slice(0, Math.max(1, maxLength - 1)).trim()}…`;
  }

  private toJsonObject(value: unknown): JsonObject {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as JsonObject;
    }

    return {};
  }
}
