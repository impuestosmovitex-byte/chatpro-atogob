import { Controller, ForbiddenException, Get, Headers, HttpCode, Post, Query, Req } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { validMetaSignature } from './staging-meta-signature';
import { extractStagingWhatsappPhoneIds } from './staging-whatsapp-routing';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

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
  receive(
    @Req() request?: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature?: string,
  ): never {
    // Validate original bytes BEFORE inspecting events. No event processing yet.
    if (!request?.rawBody || !validMetaSignature(request.rawBody, signature, process.env.META_WHATSAPP_APP_SECRET))
      throw new ForbiddenException('Firma Meta no válida.');
    // Parsing candidates is not authorization; never process or route without a DB lookup.
    const ids = extractStagingWhatsappPhoneIds(request.body);
    if (ids.length !== 1) throw new ForbiddenException('Número de destino ambiguo o ausente.');
    throw new ForbiddenException('Recepción de WhatsApp deshabilitada en staging.');
  }
}
