import { Controller, ForbiddenException, Get, Headers, HttpCode, Post, Query, Req } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { validMetaSignature } from './staging-meta-signature';
import { extractStagingWhatsappPhoneIds } from './staging-whatsapp-routing';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { SupabaseService } from './supabase.service';

/**
 * Dedicated staging-only verification endpoint. No production webhook changes.
 * Incoming events remain rejected until tenant routing and Meta signature
 * verification are implemented and tested.
 */
@Controller('webhook/whatsapp-staging')
export class StagingWhatsappWebhookController {
  constructor(private readonly supabase: SupabaseService) {}
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
  async receive(
    @Req() request?: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature?: string,
  ): Promise<never> {
    // Validate original bytes BEFORE inspecting events. No event processing yet.
    if (!request?.rawBody || !validMetaSignature(request.rawBody, signature, process.env.META_WHATSAPP_APP_SECRET))
      throw new ForbiddenException('Firma Meta no válida.');
    // Parsing candidates is not authorization; never process or route without a DB lookup.
    const ids = extractStagingWhatsappPhoneIds(request.body);
    if (ids.length !== 1) throw new ForbiddenException('Número de destino ambiguo o ausente.');
    const { data, error } = await this.supabase.getClient()
      .from('company_integrations')
      .select('company_id,status')
      .eq('provider','meta')
      .eq('integration_type','whatsapp')
      .eq('external_id',ids[0])
      .limit(2);
    if (error || !Array.isArray(data) || data.length !== 1 ||
        data[0].status !== 'active' || !data[0].company_id)
      throw new ForbiddenException('Número sin una empresa autorizada única.');
    // A registered phone alone is insufficient: the owning company must be active.
    const { data: tenant, error: tenantError } = await this.supabase.getClient()
      .from('companies')
      .select('id,status')
      .eq('id',data[0].company_id)
      .maybeSingle();
    if (tenantError || !tenant || tenant.status !== 'active')
      throw new ForbiddenException('Empresa destinataria no autorizada.');
    // No delivery or acknowledgement until isolated message processing is verified.
    throw new ForbiddenException('Recepción de WhatsApp deshabilitada en staging.');
  }
}
