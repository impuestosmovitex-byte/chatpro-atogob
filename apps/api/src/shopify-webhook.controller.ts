import {
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { ShopifyWebhookEventService } from './shopify-webhook-event.service';

@Controller('webhook/shopify')
export class ShopifyWebhookController {
  constructor(
    private readonly shopifyWebhookEventService: ShopifyWebhookEventService,
  ) {}

  @Post()
  @HttpCode(200)
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-shopify-hmac-sha256') hmac = '',
    @Headers('x-shopify-shop-domain') shopDomain = '',
    @Headers('x-shopify-topic') topic = '',
    @Headers('x-shopify-webhook-id') webhookId = '',
    @Headers('x-shopify-api-version') apiVersion = '',
  ) {
    return this.shopifyWebhookEventService.receive({
      rawBody: request.rawBody,
      body: request.body,
      hmac,
      shopDomain,
      topic,
      webhookId,
      apiVersion,
    });
  }
}
