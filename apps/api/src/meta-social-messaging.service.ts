import { Injectable } from '@nestjs/common';
import { SupabaseService } from './supabase.service';
import { IntegrationCredentialsService } from './integration-credentials.service';

@Injectable()
export class MetaSocialMessagingService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly credentialsService: IntegrationCredentialsService,
  ) {}

  async sendAdvisorText(input: {
    companyId: string;
    sessionId: string;
    message: string;
    advisorName: string;
  }): Promise<{ messageId: string | null }> {
    const client = this.supabaseService.getClient();

    const { data: sessionRow, error: sessionError } =
      await client
        .from('social_conversation_sessions')
        .select(
          'id, company_id, channel, external_customer_id, attention_status',
        )
        .eq('id', input.sessionId)
        .eq('company_id', input.companyId)
        .maybeSingle();

    if (sessionError) {
      throw new Error(
        `No se pudo consultar la conversación social: ${sessionError.message}`,
      );
    }

    if (!sessionRow) {
      throw new Error(
        'La conversación social no existe para esta empresa.',
      );
    }

    const session = sessionRow as any;

    if (session.attention_status !== 'human') {
      throw new Error(
        'La conversación debe estar tomada por un asesor para responder.',
      );
    }

    if (session.channel !== 'messenger') {
      throw new Error(
        'Este canal social todavía no admite envío desde ChatPro.',
      );
    }

    const recipientId =
      typeof session.external_customer_id === 'string'
        ? session.external_customer_id.trim()
        : '';

    if (!recipientId) {
      throw new Error(
        'La conversación de Messenger no tiene destinatario.',
      );
    }

    const { data: integrationRow, error: integrationError } =
      await client
        .from('company_integrations')
        .select(
          'external_id, credentials_encrypted, config',
        )
        .eq('company_id', input.companyId)
        .eq('provider', 'meta')
        .eq('integration_type', 'messenger')
        .eq('status', 'active')
        .maybeSingle();

    if (integrationError) {
      throw new Error(
        `No se pudo consultar la integración de Messenger: ${integrationError.message}`,
      );
    }

    if (!integrationRow) {
      throw new Error(
        'Messenger no está conectado para esta empresa.',
      );
    }

    const integration = integrationRow as any;

    const credentialsEncrypted =
      typeof integration.credentials_encrypted === 'string'
        ? integration.credentials_encrypted
        : '';

    if (!credentialsEncrypted) {
      throw new Error(
        'La integración de Messenger no tiene credenciales disponibles.',
      );
    }

    const credentials =
      this.credentialsService.decrypt(
        credentialsEncrypted,
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

    const config =
      integration.config &&
      typeof integration.config === 'object' &&
      !Array.isArray(integration.config)
        ? integration.config as Record<string, unknown>
        : {};

    const apiVersion =
      typeof config.api_version === 'string' &&
      config.api_version.trim()
        ? config.api_version.trim()
        : process.env.META_MESSENGER_GRAPH_VERSION?.trim() ||
          'v25.0';

    const url = new URL(
      `https://graph.facebook.com/${apiVersion}/me/messages`,
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
          id: recipientId,
        },
        message: {
          text: input.message,
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

      const detail =
        typeof metaError.message === 'string'
          ? metaError.message
          : `HTTP ${response.status}`;

      throw new Error(
        `Meta Messenger rechazó el mensaje: ${detail}`,
      );
    }

    const messageId =
      typeof payload.message_id === 'string'
        ? payload.message_id
        : null;

    const now = new Date().toISOString();

    const { error: saveError } =
      await client
        .from('social_conversations')
        .insert({
          company_id: input.companyId,
          session_id: input.sessionId,
          channel: 'messenger',
          external_customer_id: recipientId,
          provider_message_id: messageId,
          sender: 'assistant',
          author_type: 'advisor',
          message_type: 'text',
          message: input.message,
          media_url: null,
          created_at: now,
        });

    if (saveError) {
      throw new Error(
        `El mensaje salió por Messenger, pero no se pudo guardar en ChatPro: ${saveError.message}`,
      );
    }

    const { error: updateError } =
      await client
        .from('social_conversation_sessions')
        .update({
          last_message_at: now,
          pending_count: 0,
          pending_since: null,
          updated_at: now,
        })
        .eq('id', input.sessionId)
        .eq('company_id', input.companyId);

    if (updateError) {
      throw new Error(
        `El mensaje se envió, pero no se pudo actualizar la sesión: ${updateError.message}`,
      );
    }

    console.log(
      `[ChatPro][Messenger] asesor respondió session=${input.sessionId} advisor="${input.advisorName}"`,
    );

    return {
      messageId,
    };
  }
}
