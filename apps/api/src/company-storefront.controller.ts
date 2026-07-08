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
    const storefrontUrl = await this.companyShopifyService.getStorefrontUrl(
      profile.id,
    );

    return {
      ok: true,
      company: {
        id: profile.id,
        slug: profile.slug,
        name: profile.name,
      },
      storefrontUrl,
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
}
