import {
  Controller,
  Get,
  Headers,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ConversationMemoryService } from './conversation-memory.service';
import { CustomerOrderService } from './customer-order.service';

type ShopifyGraphqlResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string; [key: string]: unknown }>;
};

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
    const directShopify = await this.runDirectShopifyDiagnostics(orderReference);

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
        directShopify,
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
      directShopify,
      lookup: {
        ok: lookupResult.ok,
        found: lookupResult.found,
        requires_human: lookupResult.requires_human,
        next_action: lookupResult.next_action,
        message: lookupResult.message,
        error: lookupResult.error || null,
        identifiers: lookupResult.lookup_identifiers || null,
        orders,
      },
    };
  }

  private async runDirectShopifyDiagnostics(orderReference: string) {
    const rawShop = this.firstEnv([
      'SHOPIFY_SHOP',
      'SHOPIFY_SHOP_DOMAIN',
      'SHOPIFY_STORE_DOMAIN',
      'SHOPIFY_DOMAIN',
    ]);
    const shop = this.cleanShop(rawShop);
    const apiVersion = process.env.SHOPIFY_API_VERSION?.trim() || '2026-04';
    const clientId = process.env.SHOPIFY_CLIENT_ID?.trim() || '';
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET?.trim() || '';
    const directToken = this.firstEnv([
      'SHOPIFY_ACCESS_TOKEN',
      'SHOPIFY_ADMIN_ACCESS_TOKEN',
      'SHOPIFY_ADMIN_API_ACCESS_TOKEN',
      'SHOPIFY_API_ACCESS_TOKEN',
    ]);

    const base: Record<string, any> = {
      shop: shop || null,
      apiVersion,
      hasDirectToken: Boolean(directToken),
      hasClientId: Boolean(clientId),
      hasClientSecret: Boolean(clientSecret),
      tokenSource: directToken ? 'direct_env_token' : 'client_credentials',
    };

    if (!shop) {
      return {
        ...base,
        ok: false,
        step: 'env',
        error: 'MISSING_SHOP',
      };
    }

    const tokenResult: Record<string, any> = await this.obtainShopifyToken(
      shop,
      clientId,
      clientSecret,
      directToken,
    );

    if (!tokenResult.ok || !tokenResult.token) {
      return {
        ...base,
        ok: false,
        step: 'token',
        token: {
          ok: tokenResult.ok,
          source: tokenResult.source,
          httpStatus: tokenResult.httpStatus,
          hasAccessToken: false,
          expiresIn: tokenResult.expiresIn || null,
          error: tokenResult.error || null,
          bodyPreview: tokenResult.bodyPreview || null,
        },
      };
    }

    const shopQuery = await this.shopifyGraphql<Record<string, any>>(
      shop,
      apiVersion,
      String(tokenResult.token),
      `
        query {
          shop {
            name
            myshopifyDomain
            primaryDomain { url }
          }
          currentAppInstallation {
            accessScopes { handle }
          }
        }
      `,
    );

    const recentOrders = await this.shopifyGraphql<Record<string, any>>(
      shop,
      apiVersion,
      String(tokenResult.token),
      `
        query {
          orders(first: 5, reverse: true, sortKey: CREATED_AT) {
            edges {
              node {
                name
                createdAt
                displayFinancialStatus
                displayFulfillmentStatus
              }
            }
          }
        }
      `,
    );

    const searchResults: Array<Record<string, any>> = [];

    for (const query of this.buildOrderSearchQueries(orderReference)) {
      const result = await this.shopifyGraphql<Record<string, any>>(
        shop,
        apiVersion,
        String(tokenResult.token),
        `
          query($query: String!) {
            orders(first: 5, query: $query) {
              edges {
                node {
                  name
                  createdAt
                  displayFinancialStatus
                  displayFulfillmentStatus
                }
              }
            }
          }
        `,
        { query },
      );

      searchResults.push({
        query,
        httpStatus: result.httpStatus,
        ok: result.ok,
        errors: result.errors,
        orders: this.safeOrderEdges(result.data?.orders?.edges),
      });
    }

    return {
      ...base,
      ok: true,
      token: {
        ok: true,
        source: tokenResult.source,
        httpStatus: tokenResult.httpStatus,
        hasAccessToken: true,
        expiresIn: tokenResult.expiresIn || null,
      },
      shopQuery: {
        httpStatus: shopQuery.httpStatus,
        ok: shopQuery.ok,
        errors: shopQuery.errors,
        shop: shopQuery.data?.shop
          ? {
              name: shopQuery.data.shop.name || null,
              myshopifyDomain: shopQuery.data.shop.myshopifyDomain || null,
              primaryDomain: shopQuery.data.shop.primaryDomain?.url || null,
            }
          : null,
        scopes:
          shopQuery.data?.currentAppInstallation?.accessScopes?.map(
            (scope: Record<string, any>) => scope.handle,
          ) || [],
      },
      recentOrders: {
        httpStatus: recentOrders.httpStatus,
        ok: recentOrders.ok,
        errors: recentOrders.errors,
        orders: this.safeOrderEdges(recentOrders.data?.orders?.edges),
      },
      searchResults,
    };
  }

  private async obtainShopifyToken(
    shop: string,
    clientId: string,
    clientSecret: string,
    directToken: string,
  ) {
    if (directToken) {
      return {
        ok: true,
        source: 'direct_env_token',
        token: directToken,
        httpStatus: null,
        expiresIn: null,
      };
    }

    if (!clientId || !clientSecret) {
      return {
        ok: false,
        source: 'client_credentials',
        httpStatus: null,
        error: 'MISSING_CLIENT_ID_OR_SECRET',
      };
    }

    try {
      const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });

      const body = await response.text();
      let parsed: Record<string, any> = {};

      try {
        parsed = JSON.parse(body) as Record<string, any>;
      } catch {
        parsed = {};
      }

      return {
        ok: response.ok && Boolean(parsed.access_token),
        source: 'client_credentials',
        token: typeof parsed.access_token === 'string' ? parsed.access_token : '',
        httpStatus: response.status,
        expiresIn: parsed.expires_in || null,
        error: response.ok ? null : this.truncate(body),
        bodyPreview: response.ok ? null : this.truncate(body),
      };
    } catch (error) {
      return {
        ok: false,
        source: 'client_credentials',
        httpStatus: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async shopifyGraphql<T>(
    shop: string,
    apiVersion: string,
    token: string,
    query: string,
    variables: Record<string, unknown> = {},
  ) {
    try {
      const response = await fetch(
        `https://${shop}/admin/api/${apiVersion}/graphql.json`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': token,
          },
          body: JSON.stringify({ query, variables }),
        },
      );

      const body = await response.text();
      let parsed: ShopifyGraphqlResponse<T>;

      try {
        parsed = JSON.parse(body) as ShopifyGraphqlResponse<T>;
      } catch {
        parsed = {
          errors: [{ message: this.truncate(body) }],
        };
      }

      return {
        httpStatus: response.status,
        ok: response.ok && !parsed.errors?.length,
        data: parsed.data,
        errors: parsed.errors?.map((error) => ({
          message: error.message || 'Unknown Shopify error',
        })) || [],
      };
    } catch (error) {
      return {
        httpStatus: null,
        ok: false,
        data: undefined,
        errors: [
          {
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
  }

  private safeOrderEdges(edges: unknown) {
    if (!Array.isArray(edges)) {
      return [];
    }

    return edges.map((edge: Record<string, any>) => {
      const order = edge.node || {};

      return {
        name: order.name || null,
        createdAt: order.createdAt || null,
        displayFinancialStatus: order.displayFinancialStatus || null,
        displayFulfillmentStatus: order.displayFulfillmentStatus || null,
      };
    });
  }

  private buildOrderSearchQueries(value: string) {
    const compact = value.trim().replace(/\s+/g, '');
    const digits = compact.replace(/\D/g, '');
    const queries: string[] = [];

    if (compact) {
      queries.push(`name:#${compact}`);
      queries.push(`name:${compact}`);
      queries.push(`#${compact}`);
      queries.push(compact);
    }

    if (digits && digits !== compact) {
      queries.push(`name:#${digits}`);
      queries.push(`name:${digits}`);
      queries.push(`#${digits}`);
      queries.push(digits);
    }

    return [...new Set(queries)];
  }

  private firstEnv(names: string[]) {
    for (const name of names) {
      const value = process.env[name]?.trim();

      if (value) {
        return value;
      }
    }

    return '';
  }

  private cleanShop(value: string) {
    return value
      .replace(/^https?:\/\//, '')
      .replace(/^admin\.shopify\.com\/store\//, '')
      .replace(/\/.*$/, '')
      .trim();
  }

  private truncate(value: string) {
    return value.length > 700 ? `${value.slice(0, 700)}...` : value;
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
      SHOPIFY_CLIENT_ID: Boolean(process.env.SHOPIFY_CLIENT_ID),
      SHOPIFY_CLIENT_SECRET: Boolean(process.env.SHOPIFY_CLIENT_SECRET),
      SHOPIFY_ACCESS_TOKEN: Boolean(process.env.SHOPIFY_ACCESS_TOKEN),
      SHOPIFY_ADMIN_ACCESS_TOKEN: Boolean(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN),
      SHOPIFY_ADMIN_API_ACCESS_TOKEN: Boolean(process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN),
      SHOPIFY_API_ACCESS_TOKEN: Boolean(process.env.SHOPIFY_API_ACCESS_TOKEN),
      SHOPIFY_API_VERSION: Boolean(process.env.SHOPIFY_API_VERSION),
    };
  }
}
