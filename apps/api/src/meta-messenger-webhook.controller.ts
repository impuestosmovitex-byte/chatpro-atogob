import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { MetaSocialMessageService } from './meta-social-message.service';

@Controller('webhook/messenger')
export class MetaMessengerWebhookController {
  constructor(
    private readonly socialMessageService: MetaSocialMessageService,
  ) {}

  @Get()
  verify(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') verifyToken: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
    @Res() response: Response,
  ) {
    const expected =
      process.env.META_MESSENGER_WEBHOOK_VERIFY_TOKEN?.trim() || '';

    if (
      expected &&
      mode === 'subscribe' &&
      verifyToken === expected &&
      challenge
    ) {
      return response.status(200).send(challenge);
    }

    return response.status(403).send('Forbidden');
  }

  @Post()
  @HttpCode(200)
  async receive(@Body() body: unknown) {
    try {
      await this.socialMessageService.processMessengerWebhook(body);
    } catch (error) {
      console.error(
        '[ChatPro][Messenger] Error procesando webhook:',
        error,
      );
    }

    return 'EVENT_RECEIVED';
  }
}
