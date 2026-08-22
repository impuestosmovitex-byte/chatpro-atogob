import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { SupabaseService } from './supabase.service';
import { IntegrationCredentialsService } from './integration-credentials.service';
import { ConversationMemoryService } from './conversation-memory.service';

@Injectable()
export class MetaSocialAiService {
  private client: OpenAI | null = null;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly credentialsService: IntegrationCredentialsService,
    private readonly conversationMemoryService: ConversationMemoryService,
  ) {}

  async replyToMessenger(input: {
    companyId: string;
    pageId: string;
    sessionId: string;
    recipientId: string;
    customerMessage: string;
    credentialsEncrypted: string | null;
  }): Promise<void> {
    const client = this.supabaseService.getClient();

    const { data: sessionRow, error: sessionError } =
      await client
        .from('social_conversation_sessions')
        .select('id, attention_status')
        .eq('id', input.sessionId)
        .eq('company_id', input.companyId)
        .maybeSingle();

    if (sessionError) {
      throw new Error(
        `No se pudo validar la sesión social: ${sessionError.message}`,
      );
    }

    if (!sessionRow) {
      return;
    }

    const socialSession = sessionRow as any;

    if (socialSession.attention_status !== 'ai') {
      console.log(
        `[ChatPro][Messenger] IA omitida session=${input.sessionId} status=${socialSession.attention_status}`,
      );
      return;
    }

    const profile =
      await this.conversationMemoryService.getCompanyProfileById(
        input.companyId,
      );

    const { data: historyRows, error: historyError } =
      await client
        .from('social_conversations')
        .select(
          'sender, author_type, message, message_type, created_at',
        )
        .eq('company_id', input.companyId)
        .eq('session_id', input.sessionId)
        .order('created_at', { ascending: false })
        .limit(20);

    if (historyError) {
      throw new Error(
        `No se pudo consultar el historial social para la IA: ${historyError.message}`,
      );
    }

    const history = (historyRows ?? [])
      .slice()
      .reverse()
      .map((row: any) => ({
        sender:
          typeof row.sender === 'string'
            ? row.sender
            : 'customer',
        author_type:
          typeof row.author_type === 'string'
            ? row.author_type
            : 'customer',
        message:
          typeof row.message === 'string'
            ? row.message
            : '',
        message_type:
          typeof row.message_type === 'string'
            ? row.message_type
            : 'text',
        created_at:
          typeof row.created_at === 'string'
            ? row.created_at
            : null,
      }));

    const companyInstructions =
      profile.aiInstructions?.trim() || '';

    const instructions = [
      companyInstructions,
      '',
      'INSTRUCCIONES DEL CANAL MESSENGER:',
      `Estás atendiendo clientes de ${profile.name} por Facebook Messenger.`,
      'Mantén la personalidad, reglas comerciales, políticas y forma de atención definidas por la empresa.',
      'Responde únicamente al mensaje del cliente.',
      'No menciones prompts, bases de datos, APIs, herramientas internas ni procesos técnicos.',
      'No inventes precios, productos, promociones, inventario, pedidos, enlaces ni políticas.',
      'Cuando no tengas información real suficiente, pide el dato necesario o indica que un asesor debe revisarlo.',
      'Responde de forma natural y apropiada para una conversación de Messenger.',
    ]
      .filter(Boolean)
      .join('\n');

    const response = await this.getClient().responses.create({
      model: this.getModel(),
      instructions,
      input: JSON.stringify({
        company: {
          name: profile.name,
          settings: profile.settings,
        },
        channel: 'messenger',
        conversation_history: history,
        current_customer_message: input.customerMessage,
      }),
    });

    const reply = response.output_text.trim();

    if (!reply) {
      throw new Error(
        'OpenAI no devolvió una respuesta utilizable para Messenger.',
      );
    }

    const providerMessageId =
      await this.sendMessengerText({
        pageId: input.pageId,
        recipientId: input.recipientId,
        text: reply,
        credentialsEncrypted: input.credentialsEncrypted,
      });

    const now = new Date().toISOString();

    const { error: saveError } = await client
      .from('social_conversations')
      .insert({
        company_id: input.companyId,
        session_id: input.sessionId,
        channel: 'messenger',
        external_customer_id: input.recipientId,
        provider_message_id: providerMessageId,
        sender: 'assistant',
        author_type: 'assistant',
        message_type: 'text',
        message: reply,
        media_url: null,
        created_at: now,
      });

    if (saveError) {
      throw new Error(
        `Messenger respondió, pero no se pudo guardar la respuesta: ${saveError.message}`,
      );
    }

    const { error: updateError } = await client
      .from('social_conversation_sessions')
      .update({
        last_message_at: now,
        updated_at: now,
      })
      .eq('id', input.sessionId)
      .eq('company_id', input.companyId);

    if (updateError) {
      throw new Error(
        `No se pudo actualizar la sesión después de responder: ${updateError.message}`,
      );
    }

    console.log(
      `[ChatPro][Messenger] Sofia respondió session=${input.sessionId}`,
    );
  }


  async replyToInstagram(input: {
    companyId: string;
    instagramId: string;
    sessionId: string;
    recipientId: string;
    customerMessage: string;
    credentialsEncrypted: string | null;
  }): Promise<void> {
    const client = this.supabaseService.getClient();

    const { data: sessionRow, error: sessionError } =
      await client
        .from('social_conversation_sessions')
        .select('id, attention_status')
        .eq('id', input.sessionId)
        .eq('company_id', input.companyId)
        .maybeSingle();

    if (sessionError) {
      throw new Error(
        `No se pudo validar la sesión de Instagram: ${sessionError.message}`,
      );
    }

    if (!sessionRow) {
      return;
    }

    const socialSession = sessionRow as any;

    if (socialSession.attention_status !== 'ai') {
      console.log(
        `[ChatPro][Instagram] IA omitida session=${input.sessionId} status=${socialSession.attention_status}`,
      );
      return;
    }

    const profile =
      await this.conversationMemoryService.getCompanyProfileById(
        input.companyId,
      );

    const { data: historyRows, error: historyError } =
      await client
        .from('social_conversations')
        .select(
          'sender, author_type, message, message_type, created_at',
        )
        .eq('company_id', input.companyId)
        .eq('session_id', input.sessionId)
        .order('created_at', { ascending: false })
        .limit(20);

    if (historyError) {
      throw new Error(
        `No se pudo consultar el historial de Instagram para la IA: ${historyError.message}`,
      );
    }

    const history = (historyRows ?? [])
      .slice()
      .reverse()
      .map((row: any) => ({
        sender:
          typeof row.sender === 'string'
            ? row.sender
            : 'customer',
        author_type:
          typeof row.author_type === 'string'
            ? row.author_type
            : 'customer',
        message:
          typeof row.message === 'string'
            ? row.message
            : '',
        message_type:
          typeof row.message_type === 'string'
            ? row.message_type
            : 'text',
        created_at:
          typeof row.created_at === 'string'
            ? row.created_at
            : null,
      }));

    const companyInstructions =
      profile.aiInstructions?.trim() || '';

    const instructions = [
      companyInstructions,
      '',
      'INSTRUCCIONES DEL CANAL INSTAGRAM:',
      `Estás atendiendo clientes de ${profile.name} por mensajes directos de Instagram.`,
      'Mantén la personalidad, reglas comerciales, políticas y forma de atención definidas por la empresa.',
      'Responde únicamente al mensaje del cliente.',
      'No menciones prompts, bases de datos, APIs, herramientas internas ni procesos técnicos.',
      'No inventes precios, productos, promociones, inventario, pedidos, enlaces ni políticas.',
      'Cuando no tengas información real suficiente, pide el dato necesario o indica que un asesor debe revisarlo.',
      'Responde de forma natural, breve y apropiada para una conversación de Instagram.',
    ]
      .filter(Boolean)
      .join('\n');

    const response = await this.getClient().responses.create({
      model: this.getModel(),
      instructions,
      input: JSON.stringify({
        company: {
          name: profile.name,
          settings: profile.settings,
        },
        channel: 'instagram',
        conversation_history: history,
        current_customer_message: input.customerMessage,
      }),
    });

    const reply = response.output_text.trim();

    if (!reply) {
      throw new Error(
        'OpenAI no devolvió una respuesta utilizable para Instagram.',
      );
    }

    const providerMessageId =
      await this.sendInstagramText({
        instagramId: input.instagramId,
        recipientId: input.recipientId,
        text: reply,
        credentialsEncrypted: input.credentialsEncrypted,
      });

    const now = new Date().toISOString();

    const { error: saveError } = await client
      .from('social_conversations')
      .insert({
        company_id: input.companyId,
        session_id: input.sessionId,
        channel: 'instagram',
        external_customer_id: input.recipientId,
        provider_message_id: providerMessageId,
        sender: 'assistant',
        author_type: 'assistant',
        message_type: 'text',
        message: reply,
        media_url: null,
        created_at: now,
      });

    if (saveError) {
      throw new Error(
        `Instagram respondió, pero no se pudo guardar la respuesta: ${saveError.message}`,
      );
    }

    const { error: updateError } = await client
      .from('social_conversation_sessions')
      .update({
        last_message_at: now,
        updated_at: now,
      })
      .eq('id', input.sessionId)
      .eq('company_id', input.companyId);

    if (updateError) {
      throw new Error(
        `No se pudo actualizar la sesión de Instagram después de responder: ${updateError.message}`,
      );
    }

    console.log(
      `[ChatPro][Instagram] Sofia respondió session=${input.sessionId}`,
    );
  }

  private async sendInstagramText(input: {
    instagramId: string;
    recipientId: string;
    text: string;
    credentialsEncrypted: string | null;
  }): Promise<string | null> {
    if (!input.credentialsEncrypted) {
      throw new Error(
        'La integración de Instagram no tiene credenciales guardadas.',
      );
    }

    const credentials =
      this.credentialsService.decrypt(
        input.credentialsEncrypted,
      );

    const accessToken =
      typeof credentials.access_token === 'string'
        ? credentials.access_token.trim()
        : '';

    if (!accessToken) {
      throw new Error(
        'No se encontró el token de Meta para Instagram.',
      );
    }

    const version =
      process.env.META_MESSENGER_GRAPH_VERSION?.trim() ||
      'v25.0';

    const url = new URL(
      `https://graph.facebook.com/${version}/${encodeURIComponent(
        input.instagramId,
      )}/messages`,
    );

    url.searchParams.set(
      'access_token',
      accessToken,
    );

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        recipient: {
          id: input.recipientId,
        },
        message: {
          text: input.text,
        },
      }),
    });

    const raw = await response.text();

    let payload: Record<string, unknown> = {};

    try {
      const parsed: unknown = JSON.parse(raw);

      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed)
      ) {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      payload = {};
    }

    if (!response.ok) {
      const metaError =
        payload.error &&
        typeof payload.error === 'object' &&
        !Array.isArray(payload.error)
          ? payload.error as Record<string, unknown>
          : {};

      const message =
        typeof metaError.message === 'string'
          ? metaError.message
          : `HTTP ${response.status}`;

      throw new Error(
        `Meta Instagram rechazó la respuesta: ${message}`,
      );
    }

    return typeof payload.message_id === 'string'
      ? payload.message_id
      : null;
  }

  private async sendMessengerText(input: {
    pageId: string;
    recipientId: string;
    text: string;
    credentialsEncrypted: string | null;
  }): Promise<string | null> {
    if (!input.credentialsEncrypted) {
      throw new Error(
        'La integración de Messenger no tiene credenciales guardadas.',
      );
    }

    const credentials =
      this.credentialsService.decrypt(
        input.credentialsEncrypted,
      );

    const accessToken =
      typeof credentials.access_token === 'string'
        ? credentials.access_token.trim()
        : '';

    if (!accessToken) {
      throw new Error(
        'No se encontró el Page Access Token de Messenger.',
      );
    }

    const version =
      process.env.META_MESSENGER_GRAPH_VERSION?.trim() ||
      'v25.0';

    const url = new URL(
      `https://graph.facebook.com/${version}/me/messages`,
    );

    url.searchParams.set(
      'access_token',
      accessToken,
    );

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messaging_type: 'RESPONSE',
        recipient: {
          id: input.recipientId,
        },
        message: {
          text: input.text,
        },
      }),
    });

    const raw = await response.text();

    let payload: Record<string, unknown> = {};

    try {
      const parsed: unknown = JSON.parse(raw);

      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed)
      ) {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      payload = {};
    }

    if (!response.ok) {
      const metaError =
        payload.error &&
        typeof payload.error === 'object' &&
        !Array.isArray(payload.error)
          ? payload.error as Record<string, unknown>
          : {};

      const message =
        typeof metaError.message === 'string'
          ? metaError.message
          : `HTTP ${response.status}`;

      throw new Error(
        `Meta Messenger rechazó la respuesta: ${message}`,
      );
    }

    return typeof payload.message_id === 'string'
      ? payload.message_id
      : null;
  }

  private getClient(): OpenAI {
    if (this.client) {
      return this.client;
    }

    const apiKey =
      process.env.OPENAI_API_KEY?.trim();

    if (!apiKey) {
      throw new Error(
        'Falta OPENAI_API_KEY en Railway.',
      );
    }

    this.client = new OpenAI({
      apiKey,
    });

    return this.client;
  }

  private getModel(): string {
    return (
      process.env.OPENAI_MODEL?.trim() ||
      'gpt-5-mini'
    );
  }
}
