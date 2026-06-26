import { Injectable } from '@nestjs/common';
import { SupabaseService } from './supabase.service';

type JsonObject = Record<string, unknown>;

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
};

type SaveMessageInput = {
  companyId: string;
  sessionId: string;
  customerPhone: string;
  message: string;
  sender: 'customer' | 'assistant';
  aiResponse?: string | null;
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

  async getOrCreateSession(
    companySlug: string,
    customerPhone: string,
  ): Promise<ConversationSession> {
    const phone = customerPhone.trim();

    if (!phone) {
      throw new Error('Falta el número de teléfono del cliente.');
    }

    const company = await this.getCompanyProfile(companySlug);
    const client = this.supabaseService.getClient();

    const { data: existingSession, error: existingError } = await client
      .from('conversation_sessions')
      .select(
        'id, company_id, customer_phone, stage, context, last_message_at',
      )
      .eq('company_id', company.id)
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
        company_id: company.id,
        customer_phone: phone,
        stage: 'main',
        context: {},
        last_message_at: now,
        updated_at: now,
      })
      .select(
        'id, company_id, customer_phone, stage, context, last_message_at',
      )
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
      .select(
        'id, company_id, customer_phone, stage, context, last_message_at',
      )
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

  async saveMessage(input: SaveMessageInput): Promise<void> {
    const { error } = await this.supabaseService
      .getClient()
      .from('conversations')
      .insert({
        company_id: input.companyId,
        session_id: input.sessionId,
        customer_phone: input.customerPhone,
        message: input.message,
        sender: input.sender,
        message_type: 'text',
        status: input.sender === 'customer' ? 'received' : 'sent',
        ai_response: input.aiResponse ?? null,
      });

    if (error) {
      throw new Error(`No se pudo guardar el mensaje: ${error.message}`);
    }
  }
  async getCompanyProfileById(
    companyId: string,
  ): Promise<CompanyProfile> {
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
      .select(
        'id, company_id, customer_phone, stage, context, last_message_at',
      )
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
        last_message_at: now,
        updated_at: now,
      })
      .select(
        'id, company_id, customer_phone, stage, context, last_message_at',
      )
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
  private toSession(session: {
    id: string;
    company_id: string;
    customer_phone: string;
    stage: string;
    context: unknown;
    last_message_at: string | null;
  }): ConversationSession {
    return {
      id: session.id,
      companyId: session.company_id,
      customerPhone: session.customer_phone,
      stage: session.stage,
      context: this.toJsonObject(session.context),
      lastMessageAt:
        session.last_message_at ?? new Date(0).toISOString(),
    };
  }

  private toJsonObject(value: unknown): JsonObject {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      return value as JsonObject;
    }

    return {};
  }
}