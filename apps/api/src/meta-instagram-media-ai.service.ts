import { Injectable } from '@nestjs/common';
import OpenAI, { toFile } from 'openai';
import { CompanyIntegrationService } from './company-integration.service';
import { MetaSocialAiService } from './meta-social-ai.service';
import { SupabaseService } from './supabase.service';

type JsonObject = Record<string, unknown>;

@Injectable()
export class MetaInstagramMediaAiService {
  private client: OpenAI | null = null;
  private readonly processingMessageIds = new Set<string>();

  constructor(
    private readonly companyIntegrationService: CompanyIntegrationService,
    private readonly socialAiService: MetaSocialAiService,
    private readonly supabaseService: SupabaseService,
  ) {}

  async processWebhook(bodyInput: unknown): Promise<void> {
    const body = this.record(bodyInput);

    if (!Array.isArray(body.entry)) {
      return;
    }

    for (const rawEntry of body.entry) {
      const entry = this.record(rawEntry);
      const instagramId = this.text(entry.id);

      if (!instagramId) {
        continue;
      }

      const integration =
        await this.companyIntegrationService.findActiveIntegrationByExternalId(
          'meta',
          'instagram',
          instagramId,
        );

      if (!integration) {
        continue;
      }

      const events = this.collectEvents(entry);

      for (const event of events) {
        const sender = this.record(event.sender);
        const recipient = this.record(event.recipient);
        const senderId = this.text(sender.id);
        const recipientId = this.text(recipient.id);

        if (!senderId || senderId === instagramId) {
          continue;
        }

        if (recipientId && recipientId !== instagramId) {
          continue;
        }

        const message = this.record(event.message);

        if (message.is_echo === true) {
          continue;
        }

        const attachments = Array.isArray(message.attachments)
          ? message.attachments
          : [];

        if (!attachments.length) {
          continue;
        }

        for (const rawAttachment of attachments) {
          const attachment = this.record(rawAttachment);
          const payload = this.record(attachment.payload);
          const attachmentType = this.text(attachment.type).toLowerCase();
          const mediaUrl = this.text(payload.url);

          if (!mediaUrl) {
            continue;
          }

          const providerMessageId = this.text(message.mid);
          const dedupeKey = providerMessageId
            ? `${instagramId}:${providerMessageId}:${attachmentType}:${mediaUrl}`
            : `${instagramId}:${senderId}:${attachmentType}:${mediaUrl}`;

          if (this.processingMessageIds.has(dedupeKey)) {
            continue;
          }

          if (
            attachmentType !== 'audio' &&
            attachmentType !== 'voice' &&
            attachmentType !== 'video' &&
            attachmentType !== 'attachment' &&
            attachmentType !== 'file' &&
            attachmentType !== 'document'
          ) {
            continue;
          }

          this.processingMessageIds.add(dedupeKey);

          try {
            await this.processMedia({
              companyId: integration.companyId,
              instagramId,
              senderId,
              providerMessageId: providerMessageId || null,
              attachmentType,
              mediaUrl,
              credentialsEncrypted: integration.credentialsEncrypted,
              setupSource:
                typeof integration.config.setup_source === 'string'
                  ? integration.config.setup_source
                  : '',
              apiVersion:
                typeof integration.config.api_version === 'string'
                  ? integration.config.api_version
                  : '',
            });
          } catch (error) {
            console.error(
              `[ChatPro][Instagram][media-ai] No se pudo procesar ${attachmentType} de sender=${senderId}:`,
              error,
            );
          } finally {
            this.processingMessageIds.delete(dedupeKey);
          }
        }
      }
    }
  }

  private async processMedia(input: {
    companyId: string;
    instagramId: string;
    senderId: string;
    providerMessageId: string | null;
    attachmentType: string;
    mediaUrl: string;
    credentialsEncrypted: string | null;
    setupSource?: string;
    apiVersion?: string;
  }): Promise<void> {
    const client = this.supabaseService.getClient();

    const { data: sessionRow, error: sessionError } =
      await client
        .from('social_conversation_sessions')
        .select('id, attention_status')
        .eq('company_id', input.companyId)
        .eq('channel', 'instagram')
        .eq('external_customer_id', input.senderId)
        .maybeSingle();

    if (sessionError) {
      throw new Error(
        `No se pudo localizar la sesión social de Instagram: ${sessionError.message}`,
      );
    }

    if (!sessionRow || sessionRow.attention_status !== 'ai') {
      return;
    }

    if (input.providerMessageId) {
      const { data: existing } = await client
        .from('social_conversations')
        .select('id, message')
        .eq('company_id', input.companyId)
        .eq('channel', 'instagram')
        .eq('provider_message_id', input.providerMessageId)
        .maybeSingle();

      const existingMessage =
        typeof existing?.message === 'string'
          ? existing.message
          : '';

      if (existingMessage.startsWith('🎵 Audio: ')) {
        return;
      }
    }

    let customerMessage: string;

    if (
      input.attachmentType === 'audio' ||
      input.attachmentType === 'voice'
    ) {
      const transcript = await this.transcribeAudio(input.mediaUrl);

      if (!transcript) {
        throw new Error('La transcripción del audio de Instagram quedó vacía.');
      }

      customerMessage = [
        '[AUDIO_TRANSCRITO_DE_INSTAGRAM]',
        'El cliente envió una nota de voz o audio.',
        `Transcripción: ${transcript}`,
        'Responde al contenido de la transcripción como si el cliente lo hubiera escrito directamente.',
      ].join('\n');

      if (input.providerMessageId) {
        const { error: updateMessageError } = await client
          .from('social_conversations')
          .update({
            message: `🎵 Audio: ${transcript}`.slice(0, 4000),
          })
          .eq('company_id', input.companyId)
          .eq('channel', 'instagram')
          .eq('provider_message_id', input.providerMessageId);

        if (updateMessageError) {
          console.error(
            '[ChatPro][Instagram][media-ai] No se pudo guardar la transcripción visible:',
            updateMessageError,
          );
        }
      }
    } else if (input.attachmentType === 'video') {
      customerMessage = [
        '[VIDEO_RECIBIDO_DE_INSTAGRAM]',
        'El cliente envió un video por Instagram.',
        'El video quedó recibido en la conversación, pero no interpretes detalles visuales o de audio que no hayan sido analizados.',
        'Responde según el contexto reciente. Si para continuar necesitas saber qué muestra el video, formula una sola pregunta concreta.',
      ].join('\n');
    } else {
      customerMessage = [
        '[ARCHIVO_RECIBIDO_DE_INSTAGRAM]',
        'El cliente envió un archivo por Instagram.',
        'El archivo quedó recibido en la conversación, pero no inventes su contenido.',
        'Responde según el contexto reciente. Si necesitas un dato del archivo para continuar, pide solamente ese dato.',
      ].join('\n');
    }

    await this.socialAiService.replyToInstagram({
      companyId: input.companyId,
      instagramId: input.instagramId,
      sessionId: String(sessionRow.id),
      recipientId: input.senderId,
      customerMessage,
      credentialsEncrypted: input.credentialsEncrypted,
      setupSource: input.setupSource,
      apiVersion: input.apiVersion,
    });
  }

  private async transcribeAudio(mediaUrl: string): Promise<string> {
    const response = await fetch(mediaUrl);

    if (!response.ok) {
      throw new Error(
        `No se pudo descargar el audio de Instagram (${response.status}).`,
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (!buffer.length) {
      throw new Error('El audio descargado desde Instagram está vacío.');
    }

    if (buffer.length > 25 * 1024 * 1024) {
      throw new Error('El audio de Instagram supera el límite seguro de 25 MB.');
    }

    const mimeType =
      (response.headers.get('content-type') || 'audio/mpeg')
        .split(';')[0]
        .trim()
        .toLowerCase();

    const extension = this.audioExtension(mimeType);
    const file = await toFile(
      buffer,
      `instagram-audio.${extension}`,
      { type: mimeType || 'audio/mpeg' },
    );

    const transcription = await this.getClient().audio.transcriptions.create({
      model:
        process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() ||
        'gpt-4o-mini-transcribe',
      file,
    });

    return typeof transcription.text === 'string'
      ? transcription.text.replace(/\s+/g, ' ').trim().slice(0, 8000)
      : '';
  }

  private getClient(): OpenAI {
    if (this.client) {
      return this.client;
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();

    if (!apiKey) {
      throw new Error('OPENAI_API_KEY no está configurada.');
    }

    this.client = new OpenAI({ apiKey });
    return this.client;
  }

  private audioExtension(mimeType: string): string {
    if (mimeType.includes('webm')) return 'webm';
    if (mimeType.includes('wav')) return 'wav';
    if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a';
    if (mimeType.includes('ogg') || mimeType.includes('opus')) return 'ogg';
    if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
    return 'mp3';
  }

  private collectEvents(entry: JsonObject): JsonObject[] {
    const events: JsonObject[] = [];

    if (Array.isArray(entry.messaging)) {
      for (const rawEvent of entry.messaging) {
        events.push(this.record(rawEvent));
      }
    }

    if (Array.isArray(entry.changes)) {
      for (const rawChange of entry.changes) {
        const change = this.record(rawChange);

        if (this.text(change.field) !== 'messages') {
          continue;
        }

        const value = this.record(change.value);

        if (Object.keys(value).length) {
          events.push(value);
        }
      }
    }

    return events;
  }

  private record(value: unknown): JsonObject {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as JsonObject)
      : {};
  }

  private text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }
}
