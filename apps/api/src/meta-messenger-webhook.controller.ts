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

@Controller('webhook/messenger')
export class MetaMessengerWebhookController {
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
  receive(@Body() body: unknown) {
    // Etapa 1:
    // Messenger ya puede entregar eventos a este endpoint.
    // Todavía no procesamos ni guardamos mensajes.
    void body;

    return 'EVENT_RECEIVED';
  }
}
