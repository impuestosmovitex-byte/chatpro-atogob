import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
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

  async sendAdvisorMedia(input: {
    companyId: string;
    sessionId: string;
    buffer: Buffer;
    mimeType: string;
    filename: string;
    mediaType: 'image' | 'audio' | 'video' | 'document';
    caption?: string;
    advisorName: string;
  }): Promise<{ messageId: string | null }> {
    const client = this.supabaseService.getClient();

    if (!input.buffer.length) {
      throw new Error('El archivo está vacío.');
    }

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
      throw new Error('La conversación social no existe.');
    }

    const session = sessionRow as any;

    if (session.attention_status !== 'human') {
      throw new Error(
        'La conversación debe estar tomada por un asesor.',
      );
    }

    if (session.channel !== 'messenger') {
      throw new Error(
        'Este envío multimedia todavía está habilitado únicamente para Messenger.',
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

    let mediaBuffer = input.buffer;
    let mimeType =
      input.mimeType.split(';')[0].trim().toLowerCase() ||
      'application/octet-stream';
    let mediaFilename =
      input.filename || 'archivo';

    if (input.mediaType === 'audio') {
      const prepared =
        await this.prepareMessengerAudio({
          buffer: input.buffer,
          mimeType,
          filename:
            input.filename || 'audio.webm',
        });

      mediaBuffer = prepared.buffer;
      mimeType = prepared.mimeType;
      mediaFilename = prepared.filename;
    }

    const limit =
      input.mediaType === 'image'
        ? 8 * 1024 * 1024
        : input.mediaType === 'audio'
          ? 12 * 1024 * 1024
          : 25 * 1024 * 1024;

    if (mediaBuffer.length > limit) {
      throw new Error(
        input.mediaType === 'image'
          ? 'La imagen supera 8 MB.'
          : input.mediaType === 'audio'
            ? 'El audio supera 12 MB.'
            : 'El archivo supera 25 MB.',
      );
    }

    const { data: integrationRow, error: integrationError } =
      await client
        .from('company_integrations')
        .select('credentials_encrypted, config')
        .eq('company_id', input.companyId)
        .eq('provider', 'meta')
        .eq('integration_type', 'messenger')
        .eq('status', 'active')
        .maybeSingle();

    if (integrationError) {
      throw new Error(
        `No se pudo consultar Messenger: ${integrationError.message}`,
      );
    }

    if (!integrationRow) {
      throw new Error(
        'Messenger no está conectado para esta empresa.',
      );
    }

    const credentialsEncrypted =
      typeof integrationRow.credentials_encrypted === 'string'
        ? integrationRow.credentials_encrypted
        : '';

    if (!credentialsEncrypted) {
      throw new Error(
        'Messenger no tiene credenciales disponibles.',
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
      integrationRow.config &&
      typeof integrationRow.config === 'object' &&
      !Array.isArray(integrationRow.config)
        ? integrationRow.config as Record<string, unknown>
        : {};

    const apiVersion =
      typeof config.api_version === 'string' &&
      config.api_version.trim()
        ? config.api_version.trim()
        : process.env.META_MESSENGER_GRAPH_VERSION?.trim() ||
          'v25.0';

    const safeFilename =
      mediaFilename
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120) || 'archivo';

    const storagePath =
      `social/${input.companyId}/${input.sessionId}/` +
      `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${safeFilename}`;

    const { error: uploadError } =
      await client.storage
        .from('chatpro-media')
        .upload(
          storagePath,
          mediaBuffer,
          {
            contentType: mimeType,
            upsert: false,
          },
        );

    if (uploadError) {
      throw new Error(
        `No se pudo guardar el archivo: ${uploadError.message}`,
      );
    }

    const { data: signed, error: signedError } =
      await client.storage
        .from('chatpro-media')
        .createSignedUrl(
          storagePath,
          60 * 60,
        );

    if (signedError || !signed?.signedUrl) {
      await client.storage
        .from('chatpro-media')
        .remove([storagePath]);

      throw new Error(
        `No se pudo preparar el archivo para Messenger: ${
          signedError?.message || 'URL no disponible'
        }`,
      );
    }

    const graphType =
      input.mediaType === 'document'
        ? 'file'
        : input.mediaType;

    const graphUrl = new URL(
      `https://graph.facebook.com/${apiVersion}/me/messages`,
    );

    graphUrl.searchParams.set(
      'access_token',
      accessToken,
    );

    const sendGraphMessage = async (
      message: Record<string, unknown>,
    ) => {
      const response = await fetch(
        graphUrl,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            messaging_type: 'RESPONSE',
            recipient: {
              id: recipientId,
            },
            message,
          }),
        },
      );

      const raw = await response.text();

      let payload: Record<string, unknown> = {};

      try {
        const parsed: unknown = JSON.parse(raw);

        if (
          parsed &&
          typeof parsed === 'object' &&
          !Array.isArray(parsed)
        ) {
          payload =
            parsed as Record<string, unknown>;
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
          `Meta Messenger rechazó el archivo: ${detail}`,
        );
      }

      return payload;
    };

    let mediaPayload: Record<string, unknown>;

    try {
      mediaPayload =
        await sendGraphMessage({
          attachment: {
            type: graphType,
            payload: {
              url: signed.signedUrl,
              is_reusable: false,
            },
          },
        });
    } catch (error) {
      await client.storage
        .from('chatpro-media')
        .remove([storagePath]);

      throw error;
    }

    const messageId =
      typeof mediaPayload.message_id === 'string'
        ? mediaPayload.message_id
        : null;

    const now = new Date().toISOString();

    const label =
      input.mediaType === 'image'
        ? '📷 Imagen enviada.'
        : input.mediaType === 'audio'
          ? '🎤 Audio enviado.'
          : input.mediaType === 'video'
            ? '🎥 Video enviado.'
            : `📎 Archivo enviado: ${safeFilename}`;

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
          message_type:
            input.mediaType === 'document'
              ? 'attachment'
              : input.mediaType,
          message: label,
          media_url: storagePath,
          created_at: now,
        });

    if (saveError) {
      throw new Error(
        `El archivo salió por Messenger, pero no pudo guardarse en ChatPro: ${saveError.message}`,
      );
    }

    const caption =
      input.caption?.trim().slice(0, 1024) || '';

    if (caption) {
      const captionPayload =
        await sendGraphMessage({
          text: caption,
        });

      const captionId =
        typeof captionPayload.message_id === 'string'
          ? captionPayload.message_id
          : null;

      const { error: captionError } =
        await client
          .from('social_conversations')
          .insert({
            company_id: input.companyId,
            session_id: input.sessionId,
            channel: 'messenger',
            external_customer_id: recipientId,
            provider_message_id: captionId,
            sender: 'assistant',
            author_type: 'advisor',
            message_type: 'text',
            message: caption,
            media_url: null,
            created_at: new Date().toISOString(),
          });

      if (captionError) {
        console.error(
          '[ChatPro][Messenger] archivo enviado; falló guardado del caption:',
          captionError,
        );
      }
    }

    const updateNow =
      new Date().toISOString();

    await client
      .from('social_conversation_sessions')
      .update({
        last_message_at: updateNow,
        pending_count: 0,
        pending_since: null,
        updated_at: updateNow,
      })
      .eq('id', input.sessionId)
      .eq('company_id', input.companyId);

    console.log(
      `[ChatPro][Messenger] asesor envió ${input.mediaType} session=${input.sessionId} advisor="${input.advisorName}"`,
    );

    return {
      messageId,
    };
  }


  private async prepareMessengerAudio(input: {
    buffer: Buffer;
    mimeType: string;
    filename: string;
  }): Promise<{
    buffer: Buffer;
    mimeType: string;
    filename: string;
  }> {
    const ffmpegPath =
      require('ffmpeg-static') as string | null;

    if (!ffmpegPath) {
      throw new Error(
        'El conversor de audio no está instalado en el servidor.',
      );
    }

    try {
      await access(ffmpegPath);
    } catch {
      throw new Error(
        'El conversor de audio no quedó instalado correctamente en Railway.',
      );
    }

    const directory =
      await mkdtemp(
        join(
          tmpdir(),
          'chatpro-messenger-audio-',
        ),
      );

    const sourceExtension =
      extname(input.filename) ||
      (
        input.mimeType.includes('mp4')
          ? '.m4a'
          : input.mimeType.includes('ogg')
            ? '.ogg'
            : input.mimeType.includes('mpeg')
              ? '.mp3'
              : '.webm'
      );

    const source =
      join(
        directory,
        `source${sourceExtension}`,
      );

    const target =
      join(
        directory,
        'audio.mp3',
      );

    try {
      await writeFile(
        source,
        input.buffer,
      );

      await new Promise<void>(
        (resolve, reject) => {
          const process =
            spawn(
              ffmpegPath,
              [
                '-hide_banner',
                '-loglevel',
                'error',
                '-y',
                '-i',
                source,

                // Elimina video/metadatos y reconstruye
                // timestamps/duración para que Messenger
                // no reciba un audio de 0:00.
                '-vn',
                '-af',
                'aresample=async=1:first_pts=0',
                '-fflags',
                '+genpts',
                '-avoid_negative_ts',
                'make_zero',
                '-map_metadata',
                '-1',

                // MP3 mono ampliamente compatible.
                '-ac',
                '1',
                '-ar',
                '44100',
                '-c:a',
                'libmp3lame',
                '-b:a',
                '64k',

                target,
              ],
            );

          let errorOutput = '';

          process.stderr.on(
            'data',
            (chunk: Buffer) => {
              errorOutput +=
                chunk.toString('utf8');
            },
          );

          process.on(
            'error',
            (error) => {
              reject(
                new Error(
                  `No se pudo iniciar el conversor de audio: ${error.message}`,
                ),
              );
            },
          );

          process.on(
            'close',
            (code) => {
              if (code === 0) {
                resolve();
                return;
              }

              reject(
                new Error(
                  `No se pudo convertir el audio${
                    errorOutput.trim()
                      ? `: ${errorOutput.trim().slice(0, 700)}`
                      : '.'
                  }`,
                ),
              );
            },
          );
        },
      );

      const buffer =
        await readFile(target);

      if (!buffer.length) {
        throw new Error(
          'El conversor generó un audio vacío.',
        );
      }

      return {
        buffer,
        mimeType: 'audio/mpeg',
        filename: 'audio.mp3',
      };
    } finally {
      await rm(
        directory,
        {
          recursive: true,
          force: true,
        },
      ).catch(() => undefined);
    }
  }

}
