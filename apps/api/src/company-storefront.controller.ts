import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { CompanyShopifyService } from './company-shopify.service';
import { ConversationMemoryService } from './conversation-memory.service';

type JsonObject = Record<string, unknown>;

@Controller('company-storefront')
export class CompanyStorefrontController {
  constructor(
    private readonly conversationMemoryService: ConversationMemoryService,
    private readonly companyShopifyService: CompanyShopifyService,
  ) {}

  @Get()
  async getStorefront(
    @Headers('x-chatpro-inbox-key') key = '',
    @Query('company') company = '',
  ) {
    this.authorize(key);

    const profile = await this.conversationMemoryService.getCompanyProfile(
      this.company(company),
    );

    let storefrontUrl = '';
    let source: 'shopify' | 'identity' = 'shopify';

    try {
      storefrontUrl = await this.companyShopifyService.getStorefrontUrl(
        profile.id,
      );
    } catch {
      storefrontUrl = this.readWebsiteFromSettings(profile.settings);
      source = 'identity';
    }

    if (!storefrontUrl) {
      throw new BadRequestException(
        'No se pudo abrir la tienda conectada. Configura la URL web en Identidad de empresa o revisa la conexión Shopify.',
      );
    }

    return {
      ok: true,
      company: {
        id: profile.id,
        slug: profile.slug,
        name: profile.name,
      },
      storefrontUrl,
      source,
    };
  }

  private authorize(value: string) {
    const expected = process.env.CHATPRO_INBOX_KEY?.trim();

    if (!expected || value.trim() !== expected) {
      throw new UnauthorizedException('No autorizado.');
    }
  }

  private company(value: string) {
    const slug = value.trim().toLowerCase();

    if (!slug) {
      throw new BadRequestException('Falta la empresa.');
    }

    return slug;
  }

  private readWebsiteFromSettings(settings: JsonObject) {
    const identity =
      settings.business_identity &&
      typeof settings.business_identity === 'object' &&
      !Array.isArray(settings.business_identity)
        ? settings.business_identity as JsonObject
        : {};
    const raw = typeof identity.website === 'string' ? identity.website.trim() : '';

    if (!raw) {
      return '';
    }

    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

    try {
      const url = new URL(withProtocol);
      return url.origin;
    } catch {
      return '';
    }
  }
}
