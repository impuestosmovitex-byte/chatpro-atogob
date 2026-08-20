import { Injectable } from '@nestjs/common';
import { CompanyIntegrationService } from './company-integration.service';
import { IntegrationCredentialsService } from './integration-credentials.service';
import { SupabaseService } from './supabase.service';
import { MetaSocialAiService } from './meta-social-ai.service';

type JsonObject = Record<string, unknown>;

@Injectable()
export class MetaSocialMessageService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly companyIntegrationService: CompanyIntegrationService,
    private readonly credentialsService: IntegrationCredentialsService,
    private readonly socialAiService: MetaSocialAiService,
  ) {}

  async processMessengerWebhook(bodyInput: unknown): Promise<void> {
    const body = this.record(bodyInput);

    if (body.object !== 'page' || !Array.isArray(body.entry)) {
      return;
    }

    for (const rawEntry of body.entry) {
      const entry = this.record(rawEntry);
      const pageId = this.text(entry.id);

      if (!pageId || !Array.isArray(entry.messaging)) {
        continue;
      }

      const integration =
        await this.companyIntegrationService.findActiveIntegrationByExternalId(
          'meta',
          'messenger',
          pageId,
        );

      if (!integration) {
        console.warn(
          `[ChatPro][Messenger] Página no conectada pageId=${pageId}`,
        );
        continue;
      }

      for (const rawEvent of entry.messaging) {
        const event = this.record(rawEvent);
        const sender = this.record(event.sender);
        const senderId = this.text(sender.id);

        if (!senderId || senderId === pageId) {
          continue;
        }

        const message = this.record(event.message);

        if (message.is_echo === true) {
          continue;
        }

        const providerMessageId = this.text(message.mid);

        let text = this.text(message.text);
        let messageType = 'text';
        let mediaUrl: string | null = null;

        if (!text && Array.isArray(message.attachments)) {
          const attachment = this.record(message.attachments[0]);
          const payload = this.record(attachment.payload);

          messageType =
            this.text(attachment.type) || 'attachment';

          mediaUrl =
            this.text(payload.url) || null;

          text =
            messageType === 'image'
              ? '📷 Imagen recibida.'
              : messageType === 'audio'
                ? '🎵 Audio recibido.'
                : messageType === 'video'
                  ? '🎥 Video recibido.'
                  : '📎 Archivo recibido.';
        }

        const postback = this.record(event.postback);

        if (!text && Object.keys(postback).length) {
          text =
            this.text(postback.title) ||
            this.text(postback.payload) ||
            'Interacción con botón.';

          messageType = 'postback';
        }

        if (!text) {
          continue;
        }

        const savedSessionId =
          await this.saveIncomingMessengerMessage({
            companyId: integration.companyId,
            pageId,
            senderId,
            providerMessageId: providerMessageId || null,
            message: text,
            messageType,
            mediaUrl,
            credentialsEncrypted: integration.credentialsEncrypted,
          });

        if (
          savedSessionId &&
          (messageType === 'text' || messageType === 'postback')
        ) {
          try {
            await this.socialAiService.replyToMessenger({
              companyId: integration.companyId,
              pageId,
              sessionId: savedSessionId,
              recipientId: senderId,
              customerMessage: text,
              credentialsEncrypted:
                integration.credentialsEncrypted,
            });
          } catch (error) {
            console.error(
              '[ChatPro][Messenger] Sofia no pudo responder:',
              error,
            );
          }
        }
      }
    }
  }

  private async saveIncomingMessengerMessage(input: {
    companyId: string;
    pageId: string;
    senderId: string;
    providerMessageId: string | null;
    message: string;
    messageType: string;
    mediaUrl: string | null;
    credentialsEncrypted: string | null;
  }) {
    const client = this.supabaseService.getClient();

    if (input.providerMessageId) {
      const { data: duplicate, error: duplicateError } =
        await client
          .from('social_conversations')
          .select('id')
          .eq('company_id', input.companyId)
          .eq('channel', 'messenger')
          .eq('provider_message_id', input.providerMessageId)
          .maybeSingle();

      if (duplicateError) {
        throw new Error(
          `No se pudo validar duplicado de Messenger: ${duplicateError.message}`,
        );
      }

      if (duplicate) {
        return null;
      }
    }

    const profile = await this.getMessengerProfile(
      input.senderId,
      input.credentialsEncrypted,
    );

    const now = new Date().toISOString();

    const { data: existingSession, error: existingSessionError } =
      await client
        .from('social_conversation_sessions')
        .select(
          'id, inbound_message_count, display_name, username, profile_picture_url',
        )
        .eq('company_id', input.companyId)
        .eq('channel', 'messenger')
        .eq('external_customer_id', input.senderId)
        .maybeSingle();

    if (existingSessionError) {
      throw new Error(
        `No se pudo consultar sesión Messenger: ${existingSessionError.message}`,
      );
    }

    let sessionId: string;
    let inboundMessageCount: number;

    if (existingSession) {
      sessionId = String(existingSession.id);
      inboundMessageCount =
        Math.max(
          0,
          Number(existingSession.inbound_message_count) || 0,
        ) + 1;

      const { error: updateError } = await client
        .from('social_conversation_sessions')
        .update({
          inbound_message_count: inboundMessageCount,
          display_name:
            profile.displayName ||
            existingSession.display_name ||
            null,
          username:
            profile.username ||
            existingSession.username ||
            null,
          profile_picture_url:
            profile.profilePictureUrl ||
            existingSession.profile_picture_url ||
            null,
          attention_status: 'ai',
          closed_at: null,
          last_message_at: now,
          updated_at: now,
        })
        .eq('id', sessionId);

      if (updateError) {
        throw new Error(
          `No se pudo actualizar sesión Messenger: ${updateError.message}`,
        );
      }
    } else {
      inboundMessageCount = 1;

      const { data: createdSession, error: createError } =
        await client
          .from('social_conversation_sessions')
          .insert({
            company_id: input.companyId,
            channel: 'messenger',
            external_customer_id: input.senderId,
            display_name: profile.displayName || null,
            username: profile.username || null,
            profile_picture_url:
              profile.profilePictureUrl || null,
            inbound_message_count: 1,
            attention_status: 'ai',
            pending_count: 1,
            pending_since: now,
            last_message_at: now,
            updated_at: now,
          })
          .select('id')
          .single();

      if (createError || !createdSession) {
        throw new Error(
          `No se pudo crear sesión Messenger: ${
            createError?.message || 'sin respuesta'
          }`,
        );
      }

      sessionId = String(createdSession.id);
    }

    const { error: messageError } = await client
      .from('social_conversations')
      .insert({
        company_id: input.companyId,
        session_id: sessionId,
        channel: 'messenger',
        external_customer_id: input.senderId,
        provider_message_id: input.providerMessageId,
        sender: 'customer',
        author_type: 'customer',
        message_type: input.messageType,
        message: input.message,
        media_url: input.mediaUrl,
        created_at: now,
      });

    if (messageError) {
      if (messageError.code === '23505') {
        return null;
      }

      throw new Error(
        `No se pudo guardar mensaje Messenger: ${messageError.message}`,
      );
    }

    if (existingSession) {
      const currentPending =
        await client
          .from('social_conversation_sessions')
          .select('pending_count')
          .eq('id', sessionId)
          .single();

      const pendingCount =
        Math.max(
          0,
          Number(currentPending.data?.pending_count) || 0,
        ) + 1;

      await client
        .from('social_conversation_sessions')
        .update({
          pending_count: pendingCount,
          pending_since:
            pendingCount === 1 ? now : undefined,
          updated_at: now,
        })
        .eq('id', sessionId);
    }

    if (inboundMessageCount >= 4) {
      const { error: contactError } = await client
        .from('social_contacts')
        .upsert(
          {
            company_id: input.companyId,
            channel: 'messenger',
            external_customer_id: input.senderId,
            display_name: profile.displayName || null,
            username: profile.username || null,
            profile_picture_url:
              profile.profilePictureUrl || null,
            inbound_message_count: inboundMessageCount,
            last_activity_at: now,
            updated_at: now,
          },
          {
            onConflict:
              'company_id,channel,external_customer_id',
          },
        );

      if (contactError) {
        throw new Error(
          `No se pudo guardar cliente Messenger: ${contactError.message}`,
        );
      }
    }

    console.log(
      `[ChatPro][Messenger] mensaje guardado company=${input.companyId} sender=${input.senderId} count=${inboundMessageCount}`,
    );

    return sessionId;
  }

  private async getMessengerProfile(
    senderId: string,
    credentialsEncrypted: string | null,
  ): Promise<{
    displayName: string;
    username: string;
    profilePictureUrl: string;
  }> {
    if (!credentialsEncrypted) {
      return {
        displayName: '',
        username: '',
        profilePictureUrl: '',
      };
    }

    try {
      const credentials =
        this.credentialsService.decrypt(credentialsEncrypted);

      const accessToken =
        this.text(credentials.access_token);

      if (!accessToken) {
        return {
          displayName: '',
          username: '',
          profilePictureUrl: '',
        };
      }

      const version =
        process.env.META_MESSENGER_GRAPH_VERSION?.trim() ||
        'v25.0';

      const url = new URL(
        `https://graph.facebook.com/${version}/${encodeURIComponent(
          senderId,
        )}`,
      );

      url.searchParams.set(
        'fields',
        'first_name,last_name,profile_pic',
      );

      url.searchParams.set(
        'access_token',
        accessToken,
      );

      const response = await fetch(url);

      if (!response.ok) {
        console.warn(
          `[ChatPro][Messenger] Meta no permitió consultar perfil sender=${senderId} status=${response.status}`,
        );

        return {
          displayName: '',
          username: '',
          profilePictureUrl: '',
        };
      }

      const payload =
        this.record(await response.json());

      const firstName =
        this.text(payload.first_name);
      const lastName =
        this.text(payload.last_name);

      return {
        displayName:
          `${firstName} ${lastName}`.trim(),
        username: '',
        profilePictureUrl:
          this.text(payload.profile_pic),
      };
    } catch (error) {
      console.warn(
        '[ChatPro][Messenger] No se pudo consultar perfil:',
        error,
      );

      return {
        displayName: '',
        username: '',
        profilePictureUrl: '',
      };
    }
  }

  private record(value: unknown): JsonObject {
    return value &&
      typeof value === 'object' &&
      !Array.isArray(value)
      ? (value as JsonObject)
      : {};
  }

  private text(value: unknown): string {
    return typeof value === 'string'
      ? value.trim()
      : '';
  }
}
