import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Res,
} from '@nestjs/common';

import type {
  Response,
} from 'express';

import {
  MetaSocialMessageService,
} from './meta-social-message.service';
import {
  MetaInstagramMediaAiService,
} from './meta-instagram-media-ai.service';
import { MetaAdsLeadService } from './meta-ads-lead.service';

type JsonObject = Record<string, unknown>;

@Controller('webhook/instagram')
export class MetaInstagramWebhookController {
  constructor(
    private readonly socialMessageService:
      MetaSocialMessageService,
    private readonly mediaAiService:
      MetaInstagramMediaAiService,
    private readonly metaAdsLeadService:
      MetaAdsLeadService,
  ) {}

  @Get()
  verify(
    @Query('hub.mode')
    mode: string | undefined,

    @Query('hub.verify_token')
    verifyToken: string | undefined,

    @Query('hub.challenge')
    challenge: string | undefined,

    @Res()
    response: Response,
  ) {
    const expected =
      process.env
        .META_INSTAGRAM_WEBHOOK_VERIFY_TOKEN
        ?.trim() ||
      process.env
        .META_MESSENGER_WEBHOOK_VERIFY_TOKEN
        ?.trim() ||
      '';

    if (
      expected &&
      mode === 'subscribe' &&
      verifyToken === expected &&
      challenge
    ) {
      return response
        .status(200)
        .send(challenge);
    }

    return response
      .status(403)
      .send('Forbidden');
  }

  @Post()
  @HttpCode(200)
  async receive(
    @Body()
    body: unknown,
  ) {
    try {
      const normalizedBody =
        this.normalizeInstagramAttachments(body);

      await this.socialMessageService
        .processInstagramWebhook(normalizedBody);

      await this.metaAdsLeadService
        .processInstagramWebhook(normalizedBody);

      await this.mediaAiService
        .processWebhook(normalizedBody);
    } catch (error) {
      console.error(
        '[ChatPro][Instagram] Error procesando webhook:',
        error,
      );
    }

    return 'EVENT_RECEIVED';
  }

  /**
   * Meta puede agrupar varias fotos/archivos dentro de message.attachments[].
   * El runtime social procesa un mensaje por evento, por lo que expandimos
   * cada adjunto a un evento independiente antes de entregarlo al servicio.
   *
   * También normalizamos "file"/"document" a "attachment" para que la
   * bandeja los muestre como archivos descargables en lugar de texto plano.
   */
  private normalizeInstagramAttachments(
    bodyInput: unknown,
  ): unknown {
    const body = this.record(bodyInput);

    if (!Array.isArray(body.entry)) {
      return bodyInput;
    }

    let expandedAttachments = 0;

    const entries = body.entry.map((rawEntry) => {
      const entry = this.record(rawEntry);
      const nextEntry: JsonObject = {
        ...entry,
      };

      if (Array.isArray(entry.messaging)) {
        const messaging: JsonObject[] = [];

        for (const rawEvent of entry.messaging) {
          const expanded =
            this.expandMessageEvent(rawEvent);

          expandedAttachments += Math.max(
            0,
            expanded.length - 1,
          );

          messaging.push(...expanded);
        }

        nextEntry.messaging = messaging;
      }

      if (Array.isArray(entry.changes)) {
        const changes: JsonObject[] = [];

        for (const rawChange of entry.changes) {
          const change = this.record(rawChange);

          if (
            this.text(change.field) !== 'messages'
          ) {
            changes.push(change);
            continue;
          }

          const expandedValues =
            this.expandMessageEvent(change.value);

          expandedAttachments += Math.max(
            0,
            expandedValues.length - 1,
          );

          for (const value of expandedValues) {
            changes.push({
              ...change,
              value,
            });
          }
        }

        nextEntry.changes = changes;
      }

      return nextEntry;
    });

    if (expandedAttachments > 0) {
      console.log(
        `[ChatPro][Instagram] adjuntos múltiples expandidos=${expandedAttachments}`,
      );
    }

    return {
      ...body,
      entry: entries,
    };
  }

  private expandMessageEvent(
    eventInput: unknown,
  ): JsonObject[] {
    const event = this.record(eventInput);
    const message = this.record(event.message);

    if (!Array.isArray(message.attachments)) {
      return [event];
    }

    const attachments = message.attachments
      .map((item) => this.normalizeAttachment(item))
      .filter((item) => Object.keys(item).length > 0);

    if (!attachments.length) {
      return [event];
    }

    const baseMid = this.text(message.mid);
    const text = this.text(message.text);
    const expanded: JsonObject[] = [];

    // Si el evento trae texto + adjuntos, conservamos el texto como mensaje
    // independiente para no perder la intención/caption del cliente.
    if (text) {
      const textMessage: JsonObject = {
        ...message,
      };

      delete textMessage.attachments;

      expanded.push({
        ...event,
        message: textMessage,
      });
    }

    attachments.forEach((attachment, index) => {
      const attachmentMessage: JsonObject = {
        ...message,
        text: undefined,
        attachments: [attachment],
      };

      // Mantener el MID original en el primer adjunto cuando no existe texto
      // conserva la deduplicación histórica. Los adjuntos adicionales usan
      // IDs determinísticos para poder guardarse por separado sin colisionar.
      if (baseMid) {
        attachmentMessage.mid =
          !text && index === 0
            ? baseMid
            : `${baseMid}:attachment:${index}`;
      }

      expanded.push({
        ...event,
        message: attachmentMessage,
      });
    });

    return expanded.length
      ? expanded
      : [event];
  }

  private normalizeAttachment(
    value: unknown,
  ): JsonObject {
    const attachment = this.record(value);
    const type = this.text(attachment.type).toLowerCase();

    if (
      type === 'file' ||
      type === 'document'
    ) {
      return {
        ...attachment,
        type: 'attachment',
      };
    }

    return attachment;
  }

  private record(value: unknown): JsonObject {
    return value &&
      typeof value === 'object' &&
      !Array.isArray(value)
      ? value as JsonObject
      : {};
  }

  private text(value: unknown): string {
    return typeof value === 'string'
      ? value.trim()
      : '';
  }
}
