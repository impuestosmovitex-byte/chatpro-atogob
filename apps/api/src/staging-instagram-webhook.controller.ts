import {
  Controller, ForbiddenException, Get, Headers, HttpCode, Post,
  Query, Req, ServiceUnavailableException, Logger,
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
  private readonly logger = new Logger(StagingInstagramWebhookController.name);
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
  @HttpCode(200)
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature?: string,
  ): Promise<{ok:true;stored:number;duplicates:number}> {
    // Staging-only delivery diagnostics: never record messages, usernames,
    // IDs, IP addresses, access tokens or request bodies in application logs.
    this.logger.log('IG_PILOT_WEBHOOK_POST_RECEIVED');
    if (process.env.MW1_STAGING_MODE !== 'true' ||
      !request.rawBody ||
      !validMetaSignature(request.rawBody, signature,
        process.env.META_INSTAGRAM_APP_SECRET)) {
      this.logger.warn('IG_PILOT_WEBHOOK_SIGNATURE_REJECTED');
      throw new ForbiddenException('Firma de Meta inválida.');
    }
    const ids = instagramWebhookBusinessIds(request.body);
    if (ids.length !== 1) {
      this.logger.warn('IG_PILOT_WEBHOOK_PAYLOAD_SHAPE_REJECTED');
      throw new ForbiddenException('Cuenta de Instagram ambigua.');
    }
    const db = this.supabase.getClient();
    const { data: rows, error } = await db.from('company_integrations')
      .select('id,company_id,status,config')
      .eq('provider', 'meta')
      .eq('integration_type', 'instagram')
      .eq('external_id', ids[0])
      .limit(2);
    if (error || !Array.isArray(rows) || rows.length !== 1) {
      this.logger.warn('IG_PILOT_WEBHOOK_ACCOUNT_MAPPING_REJECTED');
      throw new ForbiddenException('Cuenta Instagram sin titular único.');
    }
    const integration = rows[0];
    const cfg = asObject(integration.config);
    if (integration.status !== 'pending' ||
      cfg?.username !== 'chatpro_mw1' ||
      cfg?.webhooks_subscribed !== true) {
      this.logger.warn('IG_PILOT_WEBHOOK_SUBSCRIPTION_GATE_REJECTED');
      throw new ForbiddenException('Cuenta Instagram fuera del piloto autorizado.');
    }
    const { data: company, error: companyError } = await db.from('companies')
      .select('slug,status').eq('id',integration.company_id).maybeSingle();
    if (companyError || company?.slug !== 'piloto-mw1-prueba' ||
      company.status !== 'active') {
      this.logger.warn('IG_PILOT_WEBHOOK_TENANT_GATE_REJECTED');
      throw new ForbiddenException('Empresa piloto no autorizada.');
    }
    // Do not subscribe the Meta application webhook until the pilot is
    // specifically enabled. This switch remains OFF in Railway by default.
    if (process.env.MW1_STAGING_INSTAGRAM_RECEIVE_ENABLED !== 'true') {
      this.logger.warn('IG_PILOT_WEBHOOK_RECEIPT_GATE_REJECTED');
      throw new ServiceUnavailableException('Recepción de Instagram aún no activada en staging.');
    }
    const payload = asObject(request.body);
    const entries = payload?.entry;
    if (!Array.isArray(entries) || entries.length > 20) {
      this.logger.warn('IG_PILOT_WEBHOOK_INVALID_ENTRY_BATCH');
      throw new ForbiddenException('Paquete de mensajes inválido.');
    }
    const messages: Array<{
      company_id: string;
      integration_id: string;
      provider_message_id: string;
      sender_id: string;
      recipient_ig_id: string;
      message_text: string | null;
      provider_timestamp: number | null;
    }> = [];
    for (const rawEntry of entries) {
      const entry = asObject(rawEntry);
      if (!entry || !Array.isArray(entry.messaging) || entry.messaging.length > 20) {
        this.logger.warn('IG_PILOT_WEBHOOK_INVALID_MESSAGE_BATCH');
        throw new ForbiddenException('Lote de mensajes de Instagram inválido.');
      }
      for (const rawEvent of entry.messaging) {
        const event = asObject(rawEvent);
        const sender = asObject(event?.sender);
        const recipient = asObject(event?.recipient);
        const message = asObject(event?.message);
        // Only user-originated text messages are supported in the initial pilot.
        // Do not acknowledge unsupported payloads as successfully stored.
        if (message?.is_echo === true || !sender || !recipient || !message ||
          typeof sender.id !== 'string' || !/^[0-9]{5,100}$/.test(sender.id) ||
          recipient.id !== ids[0] || sender.id === ids[0] ||
          typeof message.mid !== 'string' || message.mid.length < 1 ||
          message.mid.length > 255 || message.is_echo === true ||
          typeof message.text !== 'string' || message.text.length > 5000 ||
          typeof integration.id !== 'string' ||
          typeof integration.company_id !== 'string') {
          this.logger.warn('IG_PILOT_WEBHOOK_UNSUPPORTED_MESSAGE_TYPE');
          throw new ServiceUnavailableException('Evento de Instagram aún no soportado por el piloto.');
        }
        const timestamp = event?.timestamp;
        messages.push({
          company_id: integration.company_id,
          integration_id: integration.id,
          provider_message_id: message.mid,
          sender_id: sender.id,
          recipient_ig_id: ids[0],
          message_text: message.text,
          provider_timestamp: typeof timestamp === 'number' && Number.isSafeInteger(timestamp)
            ? timestamp : null,
        });
      }
    }
    if (!messages.length || messages.length > 20) {
      throw new ForbiddenException('No hay mensajes válidos para guardar.');
    }
    // Let the unique index enforce idempotency and return only inserted IDs.
    // Never report a duplicate as a newly received message.
    const { data: inserted, error: writeError } = await db
      .from('mw1_instagram_staging_inbox')
      .upsert(messages, {
        onConflict: 'integration_id,provider_message_id',
        ignoreDuplicates: true,
      })
      .select('id');
    if (writeError || !Array.isArray(inserted)) {
      this.logger.error('IG_PILOT_WEBHOOK_PERSISTENCE_FAILED');
      throw new ServiceUnavailableException('No se pudo guardar el mensaje. Meta puede reintentar.');
    }
    this.logger.log('IG_PILOT_WEBHOOK_STORED count=' + inserted.length);
    return {
      ok: true,
      stored: inserted.length,
      duplicates: Math.max(0, messages.length - inserted.length),
    };
  }
}
