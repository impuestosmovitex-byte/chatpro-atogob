import { Controller, ForbiddenException, Get, HttpCode, Post, Query } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

/**
 * Dedicated staging-only verification endpoint. No production webhook changes.
 * Incoming events remain rejected until tenant routing and Meta signature
 * verification are implemented and tested.
 */
@Controller('webhook/whatsapp-staging')
export class StagingWhatsappWebhookController {
  @Get()
  verify(
    @Query('hub.mode') mode = '',
    @Query('hub.verify_token') supplied = '',
    @Query('hub.challenge') challenge = '',
  ): string {
    const expected = process.env.MW1_STAGING_WHATSAPP_VERIFY_TOKEN?.trim() || '';
    if (!expected || expected.length < 32 || mode !== 'subscribe' || !supplied)
      throw new ForbiddenException('Verificación no autorizada.');
    const expectedBytes = Buffer.from(expected, 'utf8');
    const suppliedBytes = Buffer.from(supplied, 'utf8');
    if (expectedBytes.length !== suppliedBytes.length ||
        !timingSafeEqual(expectedBytes, suppliedBytes))
      throw new ForbiddenException('Verificación no autorizada.');
    if (!/^[0-9]{1,30}$/.test(challenge))
      throw new ForbiddenException('Desafío de verificación inválido.');
    return challenge;
  }

  @Post()
  @HttpCode(503)
  receive(): never {
    // Do not accept or acknowledge real Meta events without signature validation
    // and an independently verified phone-number-to-company routing table.
    throw new ForbiddenException('Recepción de WhatsApp deshabilitada en staging.');
  }
}
