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

@Controller('webhook/instagram')
export class MetaInstagramWebhookController {
  constructor(
    private readonly socialMessageService:
      MetaSocialMessageService,
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
      const processor =
        (
          this.socialMessageService as unknown as {
            processInstagramWebhook?: (
              value: unknown,
            ) => Promise<void>;
          }
        ).processInstagramWebhook;

      if (
        typeof processor ===
        'function'
      ) {
        await processor.call(
          this.socialMessageService,
          body,
        );
      } else {
        console.warn(
          '[ChatPro][Instagram] webhook recibido; procesador todavía pendiente.',
        );
      }
    } catch (error) {
      console.error(
        '[ChatPro][Instagram] Error procesando webhook:',
        error,
      );
    }

    return 'EVENT_RECEIVED';
  }
}
