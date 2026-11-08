import {
  Controller, ForbiddenException, Get, Headers, HttpCode, Post,
  Query, Req, ServiceUnavailableException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { validMetaSignature } from './staging-meta-signature';
import { SupabaseService } from './supabase.service';

type MetaObject = Record<string, unknown>;
function asObject(value: unknown): MetaObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as MetaObject : null;
}

/**
 * Extracts the Instagram professional account ID, never the sender ID.
 * A single POST may contain several events but must target exactly one
 * professional account. Reject ambiguous payloads instead of guessing a tenant.
 */
export function instagramWebhookBusinessIds(value: unknown): string[] {
  const payload = asObject(value);
  if (!payload || payload.object !== 'instagram' || !Array.isArray(payload.entry)) return [];
  const ids = new Set<string>();
  for (const item of payload.entry) {
    const entry = asObject(item);
    if (!entry) return [];
    const entryId = entry.id;
    if (typeof entryId !== 'string' || !/^[0-9]{5,30}$/.test(entryId)) return [];
    if (!Array.isArray(entry.messaging) || entry.messaging.length === 0) return [];
    for (const event of entry.messaging) {
      const envelope = asObject(event);
      const recipient = asObject(envelope?.recipient);
      if (!recipient || recipient.id !== entryId) return [];
    }
    ids.add(entryId);
  }
  return [...ids];
}

/**
 * Dedicated staging endpoint. Register with Meta ONLY after creating a
 * staging-specific verify token. Do not point the production application
 * webhook at this endpoint during this verification phase.
 *
 * Incoming events are deliberately NOT acknowledged, stored, or forwarded
 * until deduplication, inbox persistence and delivery tests are complete.
 */
@Controller('webhook/instagram-staging')
export class StagingInstagramWebhookController {
  constructor(private readonly supabase: SupabaseService) {}

  @Get()
  verify(
    @Query('hub.mode') mode = '',
    @Query('hub.verify_token') supplied = '',
    @Query('hub.challenge') challenge = '',
  ): string {
    const expected = process.env.MW1_STAGING_INSTAGRAM_WEBHOOK_VERIFY_TOKEN?.trim() || '';
    if (process.env.MW1_STAGING_MODE !== 'true' ||
      expected.length < 32 || mode !== 'subscribe' || !supplied) {
      throw new ForbiddenException('Verificación de Instagram no autorizada.');
    }
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(supplied, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b) ||
      !/^[0-9]{1,30}$/.test(challenge)) {
      throw new ForbiddenException('Verificación de Instagram no autorizada.');
    }
    return challenge;
  }

  @Post()
  @HttpCode(503)
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature?: string,
  ): Promise<never> {
    if (process.env.MW1_STAGING_MODE !== 'true' ||
      !request.rawBody ||
      !validMetaSignature(request.rawBody, signature,
        process.env.META_INSTAGRAM_APP_SECRET)) {
      throw new ForbiddenException('Firma de Meta inválida.');
    }
    const ids = instagramWebhookBusinessIds(request.body);
    if (ids.length !== 1) {
      throw new ForbiddenException('Cuenta de Instagram ambigua.');
    }
    const db = this.supabase.getClient();
    const { data: rows, error } = await db.from('company_integrations')
      .select('company_id,status,config')
      .eq('provider', 'meta')
      .eq('integration_type', 'instagram')
      .eq('external_id', ids[0])
      .limit(2);
    if (error || !Array.isArray(rows) || rows.length !== 1) {
      throw new ForbiddenException('Cuenta Instagram sin titular único.');
    }
    const integration = rows[0];
    const cfg = asObject(integration.config);
    if (integration.status !== 'pending' ||
      cfg?.username !== 'chatpro_mw1' ||
      cfg?.webhooks_subscribed !== false) {
      throw new ForbiddenException('Cuenta Instagram fuera del piloto autorizado.');
    }
    const { data: company, error: companyError } = await db.from('companies')
      .select('slug,status').eq('id',integration.company_id).maybeSingle();
    if (companyError || company?.slug !== 'piloto-mw1-prueba' ||
      company.status !== 'active') {
      throw new ForbiddenException('Empresa piloto no autorizada.');
    }
    // Fail closed: until explicitly implemented, Meta receives a retriable
    // response rather than a false 200 implying an event was processed.
    throw new ServiceUnavailableException('Recepción de Instagram aún no activada en staging.');
  }
}
