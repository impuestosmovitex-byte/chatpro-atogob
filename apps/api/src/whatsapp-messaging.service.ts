import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import {
  access,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { CompanyIntegrationService } from './company-integration.service';
import { IntegrationCredentialsService } from './integration-credentials.service';

type JsonObject = Record<string, unknown>;

export type WhatsappSendResult = {
  messageId: string;
  recipient: string | null;
};

export type WhatsappAudioSendResult = WhatsappSendResult & {
  mediaId: string;
  mimeType: string;
};

export type WhatsappMediaDownload = {
  buffer: Buffer;
  mimeType: string;
  filename: string;
};

@Injectable()
export class WhatsappMessagingService {
  constructor(
    private readonly companyIntegrationService: CompanyIntegrationService,
    private readonly credentialsService: IntegrationCredentialsService,
  ) {}

  async checkConnection(companyId: string): Promise<{
    phoneNumberId: string;
    displayPhoneNumber: string | null;
    verifiedName: string | null;
    qualityRating: string | null;
    apiVersion: string;
  }> {
    const channel = await this.resolveChannel(companyId);
    const response = await fetch(
      `https://graph.facebook.com/${channel.apiVersion}/${channel.phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating`,
      {
        headers: {
          Authorization: `Bearer ${channel.accessToken}`,
        },
        signal: AbortSignal.timeout(10000),
        cache: 'no-store',
      },
    );
    const raw = await response.text();
    let data: JsonObject = {};

    try {
      data = raw ? (JSON.parse(raw) as JsonObject) : {};
    } catch {
      data = {};
    }

    if (!response.ok) {
      const error = this.object(data.error);
      const message =
        this.readText(error.message) ||
        `Meta rechazó la verificación (${response.status}).`;

      throw new Error(message);
    }

    return {
      phoneNumberId: channel.phoneNumberId,
      displayPhoneNumber:
        this.readText(data.display_phone_number) || null,
      verifiedName: this.readText(data.verified_name) || null,
      qualityRating: this.readText(data.quality_rating) || null,
      apiVersion: channel.apiVersion,
    };
  }

  async sendText(
    companyId: string,
    to: string,
    body: string,
  ): Promise<WhatsappSendResult> {
    const channel = await this.resolveChannel(companyId);

    return this.send(channel, {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    });
  }

  async sendAudio(
    companyId: string,
    to: string,
    input: {
      buffer: Buffer;
      mimeType: string;
      filename: string;
    },
  ): Promise<WhatsappAudioSendResult> {
    if (!input.buffer.length) {
      throw new Error('El audio está vacío.');
    }

    if (input.buffer.length > 12 * 1024 * 1024) {
      throw new Error('El audio supera el límite de 12 MB.');
    }

    const channel = await this.resolveChannel(companyId);
    const prepared = await this.prepareAudio(input);
    const mediaId = await this.uploadMedia(channel, prepared);
    const sent = await this.send(channel, {
      messaging_product: 'whatsapp',
      to,
      type: 'audio',
      audio: { id: mediaId },
    });

    return {
      ...sent,
      mediaId,
      mimeType: prepared.mimeType,
    };
  }

  async downloadMedia(
    companyId: string,
    mediaId: string,
  ): Promise<WhatsappMediaDownload> {
    const channel = await this.resolveChannel(companyId);
    const id = mediaId.trim();

    if (!id) {
      throw new Error('El audio no tiene identificador de Meta.');
    }

    const metadataResponse = await fetch(
      `https://graph.facebook.com/${channel.apiVersion}/${encodeURIComponent(id)}`,
      {
        headers: {
          Authorization: `Bearer ${channel.accessToken}`,
        },
        cache: 'no-store',
      },
    );
    const metadataRaw = await metadataResponse.text();
    let metadata: JsonObject = {};

    try {
      metadata = metadataRaw
        ? (JSON.parse(metadataRaw) as JsonObject)
        : {};
    } catch {
      metadata = {};
    }

    if (!metadataResponse.ok) {
      throw new Error(
        `Meta no permitió consultar el audio: ${metadataRaw}`,
      );
    }

    const url = this.readText(metadata.url);
    const mimeType =
      this.readText(metadata.mime_type) || 'audio/ogg';

    if (!url) {
      throw new Error('Meta no devolvió la URL temporal del audio.');
    }

    const mediaResponse = await fetch(url, {
      headers: {
        Authorization: `Bearer ${channel.accessToken}`,
      },
      cache: 'no-store',
    });

    if (!mediaResponse.ok) {
      throw new Error(
        `Meta no permitió descargar el audio: ${await mediaResponse.text()}`,
      );
    }

    const downloaded = {
      buffer: Buffer.from(await mediaResponse.arrayBuffer()),
      mimeType:
        mediaResponse.headers.get('content-type')?.trim() ||
        mimeType,
      filename: `audio-${id}.${this.extensionForMime(mimeType)}`,
    };

    return this.transcodeToMp3(downloaded);
  }

  async sendTemplate(
    companyId: string,
    to: string,
    templateName: string,
    languageCode: string,
    bodyParameters: string[] = [],
  ): Promise<WhatsappSendResult> {
    const channel = await this.resolveChannel(companyId);
    const template: {
      name: string;
      language: { code: string };
      components?: Array<{
        type: 'body';
        parameters: Array<{ type: 'text'; text: string }>;
      }>;
    } = {
      name: templateName,
      language: { code: languageCode },
    };

    if (bodyParameters.length) {
      template.components = [
        {
          type: 'body',
          parameters: bodyParameters.map((text) => ({
            type: 'text',
            text,
          })),
        },
      ];
    }

    return this.send(channel, {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template,
    });
  }

  async sendTemplateComponents(
    companyId: string,
    to: string,
    templateName: string,
    languageCode: string,
    components: JsonObject[] = [],
  ): Promise<WhatsappSendResult> {
    const channel = await this.resolveChannel(companyId);
    const template: JsonObject = {
      name: templateName,
      language: { code: languageCode },
    };

    if (components.length) {
      template.components = components;
    }

    return this.send(channel, {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template,
    });
  }

  private async prepareAudio(input: {
    buffer: Buffer;
    mimeType: string;
    filename: string;
  }): Promise<{
    buffer: Buffer;
    mimeType: string;
    filename: string;
  }> {
    const cleanMime = input.mimeType.split(';')[0].trim().toLowerCase();
    const supported = new Set([
      'audio/aac',
      'audio/amr',
      'audio/mpeg',
      'audio/mp4',
      'audio/ogg',
    ]);

    if (supported.has(cleanMime) && cleanMime !== 'audio/ogg') {
      return {
        buffer: input.buffer,
        mimeType: cleanMime,
        filename:
          input.filename.trim() ||
          `audio.${this.extensionForMime(cleanMime)}`,
      };
    }

    return this.transcodeToOgg(input);
  }

  private async transcodeToOgg(input: {
    buffer: Buffer;
    mimeType: string;
    filename: string;
  }): Promise<{
    buffer: Buffer;
    mimeType: string;
    filename: string;
  }> {
    return this.transcodeAudio(input, {
      outputFilename: 'audio.ogg',
      outputMimeType: 'audio/ogg; codecs=opus',
      arguments: [
        '-vn',
        '-ac',
        '1',
        '-ar',
        '48000',
        '-c:a',
        'libopus',
        '-b:a',
        '32k',
        '-application',
        'voip',
      ],
    });
  }

  private async transcodeToMp3(input: {
    buffer: Buffer;
    mimeType: string;
    filename: string;
  }): Promise<WhatsappMediaDownload> {
    return this.transcodeAudio(input, {
      outputFilename: 'audio.mp3',
      outputMimeType: 'audio/mpeg',
      arguments: [
        '-vn',
        '-ac',
        '1',
        '-ar',
        '44100',
        '-c:a',
        'libmp3lame',
        '-b:a',
        '64k',
      ],
    });
  }

  private async transcodeAudio(
    input: {
      buffer: Buffer;
      mimeType: string;
      filename: string;
    },
    output: {
      outputFilename: string;
      outputMimeType: string;
      arguments: string[];
    },
  ): Promise<{
    buffer: Buffer;
    mimeType: string;
    filename: string;
  }> {
    const ffmpegPath = require('ffmpeg-static') as string | null;

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

    const directory = await mkdtemp(join(tmpdir(), 'chatpro-audio-'));
    const extension =
      extname(input.filename) ||
      `.${this.extensionForMime(input.mimeType)}`;
    const source = join(directory, `source${extension}`);
    const target = join(directory, output.outputFilename);

    try {
      await writeFile(source, input.buffer);
      await new Promise<void>((resolve, reject) => {
        const process = spawn(ffmpegPath, [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-i',
          source,
          ...output.arguments,
          target,
        ]);
        let errorOutput = '';

        process.stderr.on('data', (chunk: Buffer) => {
          errorOutput += chunk.toString('utf8');
        });
        process.on('error', (error) => {
          reject(
            new Error(
              `No se pudo iniciar el conversor de audio: ${error.message}`,
            ),
          );
        });
        process.on('close', (code) => {
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
        });
      });

      const buffer = await readFile(target);

      if (!buffer.length) {
        throw new Error('El conversor generó un audio vacío.');
      }

      return {
        buffer,
        mimeType: output.outputMimeType,
        filename: output.outputFilename,
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async uploadMedia(
    channel: {
      phoneNumberId: string;
      accessToken: string;
      apiVersion: string;
    },
    input: {
      buffer: Buffer;
      mimeType: string;
      filename: string;
    },
  ): Promise<string> {
    const form = new FormData();
    form.set('messaging_product', 'whatsapp');
    form.set('type', input.mimeType);
    form.set(
      'file',
      new Blob([new Uint8Array(input.buffer)], {
        type: input.mimeType,
      }),
      input.filename,
    );

    const response = await fetch(
      `https://graph.facebook.com/${channel.apiVersion}/${channel.phoneNumberId}/media`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${channel.accessToken}`,
        },
        body: form,
      },
    );
    const raw = await response.text();
    let data: JsonObject = {};

    try {
      data = raw ? (JSON.parse(raw) as JsonObject) : {};
    } catch {
      data = {};
    }

    if (!response.ok) {
      throw new Error(`Meta no aceptó el audio: ${raw}`);
    }

    const mediaId = this.readText(data.id);

    if (!mediaId) {
      throw new Error(
        'Meta aceptó el archivo, pero no devolvió su identificador.',
      );
    }

    return mediaId;
  }

  private extensionForMime(value: string): string {
    const mime = value.split(';')[0].trim().toLowerCase();

    if (mime === 'audio/mpeg') return 'mp3';
    if (mime === 'audio/mp4') return 'm4a';
    if (mime === 'audio/aac') return 'aac';
    if (mime === 'audio/amr') return 'amr';
    if (mime === 'audio/webm') return 'webm';

    return 'ogg';
  }

  private async resolveChannel(companyId: string): Promise<{
    phoneNumberId: string;
    accessToken: string;
    apiVersion: string;
  }> {
    const integration =
      await this.companyIntegrationService.getActiveIntegration(
        companyId,
        'meta',
        'whatsapp',
      );

    if (!integration) {
      throw new Error(
        'Esta empresa no tiene un canal de WhatsApp activo configurado.',
      );
    }

    const phoneNumberId = integration.externalId.trim();

    if (!phoneNumberId) {
      throw new Error(
        'La integración de WhatsApp no tiene Phone Number ID configurado.',
      );
    }

    let accessToken = '';

    if (integration.credentialMode === 'environment') {
      const reference = integration.credentialReference as JsonObject;
      const tokenEnv = this.readText(reference.access_token_env);

      if (!tokenEnv) {
        throw new Error(
          'La integración de WhatsApp no tiene definida la referencia segura del token.',
        );
      }

      accessToken = process.env[tokenEnv]?.trim() ?? '';

      if (!accessToken) {
        throw new Error(
          `Falta la variable segura ${tokenEnv} para el WhatsApp de esta empresa.`,
        );
      }
    } else if (integration.credentialMode === 'encrypted') {
      if (!integration.credentialsEncrypted) {
        throw new Error(
          'La integración de WhatsApp no tiene credenciales cifradas.',
        );
      }

      const credentials = this.credentialsService.decrypt(
        integration.credentialsEncrypted,
      );
      accessToken = this.readText(credentials.access_token);

      if (!accessToken) {
        throw new Error(
          'No se encontró un token válido para el WhatsApp de esta empresa.',
        );
      }
    }

    const config = integration.config as JsonObject;
    const apiVersion = this.readText(config.api_version) || 'v25.0';

    return { phoneNumberId, accessToken, apiVersion };
  }

  private async send(
    channel: {
      phoneNumberId: string;
      accessToken: string;
      apiVersion: string;
    },
    payload: Record<string, unknown>,
  ): Promise<WhatsappSendResult> {
    const response = await fetch(
      `https://graph.facebook.com/${channel.apiVersion}/${channel.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${channel.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
    );

    const rawResponse = await response.text();
    let data: JsonObject = {};

    try {
      data = rawResponse
        ? (JSON.parse(rawResponse) as JsonObject)
        : {};
    } catch {
      data = {};
    }

    if (!response.ok) {
      throw new Error(
        `Meta no aceptó el mensaje: ${rawResponse}`,
      );
    }

    const messages = Array.isArray(data.messages)
      ? data.messages
      : [];
    const contacts = Array.isArray(data.contacts)
      ? data.contacts
      : [];
    const message = this.object(messages[0]);
    const contact = this.object(contacts[0]);
    const messageId = this.readText(message.id);

    if (!messageId) {
      throw new Error(
        'Meta aceptó la solicitud, pero no devolvió el identificador del mensaje.',
      );
    }

    return {
      messageId,
      recipient: this.readText(contact.wa_id) || null,
    };
  }

  private object(value: unknown): JsonObject {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as JsonObject)
      : {};
  }

  private readText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }
}
