import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { CompanyIntegrationService } from './company-integration.service';
import { ShopifyAutomationProcessorService } from './shopify-automation-processor.service';
import { SupabaseService } from './supabase.service';

type JsonObject = Record<string, unknown>;

const SUPPORTED_TOPICS = new Set([
  'orders/create',
  'orders/cancelled',
  'fulfillments/create',
  'fulfillments/update',
]);

@Injectable()
export class ShopifyWebhookEventService {
  constructor(
    private readonly companyIntegrationService: CompanyIntegrationService,
    private readonly supabaseService: SupabaseService,
    private readonly shopifyAutomationProcessorService: ShopifyAutomationProcessorService,
  ) {}

  async receive(input: {
    rawBody: Buffer | undefined;
    body: unknown;
    hmac: string;
    shopDomain: string;
    topic: string;
    webhookId: string;
    apiVersion: string;
  }) {
    const rawBody = input.rawBody;

    if (!rawBody?.length) {
      throw new BadRequestException(
        'Shopify no entregó el cuerpo original del evento.',
      );
    }

    this.verifyHmac(rawBody, input.hmac);

    const shopDomain = this.normalizeShop(input.shopDomain);
    const topic = input.topic.trim().toLowerCase();

    if (!SUPPORTED_TOPICS.has(topic)) {
      return {
        ok: true,
        ignored: true,
        reason: 'topic_not_supported',
      };
    }

    const integration =
      await this.companyIntegrationService.findActiveIntegrationByExternalId(
        'shopify',
        'store',
        shopDomain,
      );

    if (!integration) {
      throw new BadRequestException(
        'La tienda Shopify no está conectada a una empresa activa.',
      );
    }

    const payload = this.object(input.body);
    const webhookId =
      input.webhookId.trim() ||
      createHash('sha256')
        .update(shopDomain)
        .update('\n')
        .update(topic)
        .update('\n')
        .update(rawBody)
        .digest('hex');

    const now = new Date().toISOString();
    const { data, error } = await this.supabaseService
      .getClient()
      .from('shopify_webhook_events')
      .upsert(
        {
          webhook_id: webhookId,
          company_id: integration.companyId,
          shop_domain: shopDomain,
          topic,
          api_version: input.apiVersion.trim() || null,
          status: 'received',
          payload,
          received_at: now,
          updated_at: now,
        },
        {
          onConflict: 'webhook_id',
          ignoreDuplicates: true,
        },
      )
      .select('id, webhook_id, status')
      .maybeSingle();

    if (error) {
      throw new BadRequestException(
        `No se pudo guardar el evento de Shopify: ${error.message}`,
      );
    }

    void this.shopifyAutomationProcessorService.processPending();

    return {
      ok: true,
      duplicate: !data,
      eventId: data?.id ?? null,
      topic,
      shopDomain,
      processingTriggered: true,
    };
  }

  private verifyHmac(rawBody: Buffer, receivedValue: string): void {
    const secret = process.env.SHOPIFY_PLATFORM_CLIENT_SECRET?.trim();

    if (!secret) {
      throw new Error(
        'Falta SHOPIFY_PLATFORM_CLIENT_SECRET para validar Shopify.',
      );
    }

    const receivedText = receivedValue.trim();

    if (!receivedText) {
      throw new UnauthorizedException(
        'Falta la firma segura de Shopify.',
      );
    }

    let received: Buffer;

    try {
      received = Buffer.from(receivedText, 'base64');
    } catch {
      throw new UnauthorizedException(
        'La firma segura de Shopify no es válida.',
      );
    }

    const expected = createHmac('sha256', secret)
      .update(rawBody)
      .digest();

    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      throw new UnauthorizedException(
        'No se pudo validar la firma segura de Shopify.',
      );
    }
  }

  private normalizeShop(value: string): string {
    const shop = value
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '')
      .toLowerCase();

    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
      throw new BadRequestException(
        'Shopify no envió un dominio de tienda válido.',
      );
    }

    return shop;
  }

  private object(value: unknown): JsonObject {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as JsonObject)
      : {};
  }
}
