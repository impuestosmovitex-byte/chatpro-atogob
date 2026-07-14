import {
  Controller,
  Get,
  Headers,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ConversationMemoryService } from './conversation-memory.service';
import { CustomerOrderService } from './customer-order.service';

@Controller('internal-diagnostics')
export class InternalDiagnosticsController {
  constructor(
    private readonly conversationMemoryService: ConversationMemoryService,
    private readonly customerOrderService: CustomerOrderService,
  ) {}

  @Get('shopify-order')
  async diagnoseShopifyOrder(
    @Headers('x-chatpro-inbox-key') inboxKey: string | undefined,
    @Query('companySlug') companySlug = '',
    @Query('order') order = '',
    @Query('email') email = '',
    @Query('phone') phone = '',
  ) {
    const expectedKey = process.env.CHATPRO_INBOX_KEY || '';

    if (!expectedKey || inboxKey !== expectedKey) {
      throw new UnauthorizedException('Unauthorized');
    }

    const slug = companySlug.trim().toLowerCase();
    const orderReference = order.trim();
    const emailValue = email.trim();
    const phoneValue = phone.trim();

    if (!slug) {
      return {
        ok: false,
        error: 'MISSING_COMPANY_SLUG',
      };
    }

    if (!orderReference && !emailValue && !phoneValue) {
      return {
        ok: false,
        error: 'MISSING_LOOKUP_IDENTIFIER',
      };
    }

    let companyProfile: Record<string, any>;

    try {
      companyProfile = await this.conversationMemoryService.getCompanyProfile(
        slug,
      ) as Record<string, any>;
    } catch (error) {
      return {
        ok: false,
        error: 'COMPANY_PROFILE_LOOKUP_FAILED',
        message: error instanceof Error ? error.message : String(error),
        companySlug: slug,
      };
    }

    const companyId = String(
      companyProfile.id ||
        companyProfile.companyId ||
        companyProfile.company_id ||
        '',
    );

    if (!companyId) {
      return {
        ok: false,
        error: 'COMPANY_ID_NOT_FOUND_IN_PROFILE',
        companyProfile: this.safeCompany(companyProfile),
      };
    }

    const envPresence = this.readShopifyEnvPresence();

    let lookupResult: Record<string, any>;

    try {
      lookupResult = await this.customerOrderService.lookup(companyId, {
        orderReference,
        email: emailValue,
        phone: phoneValue,
      }) as Record<string, any>;
    } catch (error) {
      return {
        ok: false,
        error: 'LOOKUP_THROWN',
        message: error instanceof Error ? error.message : String(error),
        company: this.safeCompany(companyProfile),
        envPresence,
      };
    }

    const orders = Array.isArray(lookupResult.orders)
      ? lookupResult.orders.map((orderItem: Record<string, any>) => ({
          name: orderItem.name || null,
          created_at: orderItem.created_at || null,
          processed_at: orderItem.processed_at || null,
          financial_status: orderItem.financial_status || null,
          fulfillment_status: orderItem.fulfillment_status || null,
          items_count: Array.isArray(orderItem.items) ? orderItem.items.length : 0,
          tracking_count: Array.isArray(orderItem.tracking) ? orderItem.tracking.length : 0,
          has_tracking_url: Array.isArray(orderItem.tracking)
            ? orderItem.tracking.some((tracking: Record<string, any>) => Boolean(tracking.url))
            : false,
        }))
      : [];

    return {
      ok: true,
      company: this.safeCompany(companyProfile),
      envPresence,
      lookup: {
        ok: lookupResult.ok,
        found: lookupResult.found,
        requires_human: lookupResult.requires_human,
        next_action: lookupResult.next_action,
        message: lookupResult.message,
        identifiers: lookupResult.lookup_identifiers || null,
        orders,
      },
    };
  }

  private safeCompany(company: Record<string, any>) {
    return {
      id: company.id || company.companyId || company.company_id || null,
      slug: company.slug || company.companySlug || company.company_slug || null,
      name: company.name || company.displayName || company.display_name || null,
    };
  }

  private readShopifyEnvPresence() {
    return {
      SHOPIFY_SHOP: Boolean(process.env.SHOPIFY_SHOP),
      SHOPIFY_SHOP_DOMAIN: Boolean(process.env.SHOPIFY_SHOP_DOMAIN),
      SHOPIFY_STORE_DOMAIN: Boolean(process.env.SHOPIFY_STORE_DOMAIN),
      SHOPIFY_DOMAIN: Boolean(process.env.SHOPIFY_DOMAIN),
      SHOPIFY_ACCESS_TOKEN: Boolean(process.env.SHOPIFY_ACCESS_TOKEN),
      SHOPIFY_ADMIN_ACCESS_TOKEN: Boolean(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN),
      SHOPIFY_ADMIN_API_ACCESS_TOKEN: Boolean(process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN),
      SHOPIFY_API_ACCESS_TOKEN: Boolean(process.env.SHOPIFY_API_ACCESS_TOKEN),
      SHOPIFY_API_VERSION: Boolean(process.env.SHOPIFY_API_VERSION),
    };
  }
}
