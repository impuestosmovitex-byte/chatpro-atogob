import { Injectable } from '@nestjs/common';
import { IntegrationCredentialsService } from './integration-credentials.service';
import { SupabaseService } from './supabase.service';

type IntegrationRow = {
  external_id: string;
  config: unknown;
  credentials_encrypted: string | null;
  credential_mode: 'environment' | 'encrypted';
};

type ShopifyGraphqlResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

type ShopifyVariant = {
  legacyResourceId: string;
  title: string;
  price: string;
  availableForSale: boolean;
  selectedOptions: Array<{ name: string; value: string }>;
};

type ShopifyProduct = {
  id: string;
  title: string;
  handle: string;
  onlineStoreUrl: string | null;
  featuredImage: {
    url: string;
    altText: string | null;
  } | null;
  variants: {
    edges: Array<{ node: ShopifyVariant }>;
  };
};

export type CompanyShopifyCatalogItem = {
  id: string;
  title: string;
  handle: string;
  onlineStoreUrl: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  variants: Array<{
    legacyResourceId: string;
    title: string;
    price: string;
    options: Array<{ name: string; value: string }>;
  }>;
};

@Injectable()
export class CompanyShopifyService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly credentialsService: IntegrationCredentialsService,
  ) {}

  async listCatalog(
    companyId: string,
    searchText = '',
    limit = 10,
  ): Promise<CompanyShopifyCatalogItem[]> {
    const catalogQuery = ['status:active', searchText.trim()]
      .filter(Boolean)
      .join(' ');

    const data = await this.graphql<{
      products: { edges: Array<{ node: ShopifyProduct }> };
    }>(
      companyId,
      `
        query ChatProCompanyCatalog($first: Int!, $query: String!) {
          products(first: $first, query: $query, sortKey: RELEVANCE) {
            edges {
              node {
                id
                title
                handle
                onlineStoreUrl
                featuredImage {
                  url
                  altText
                }
                variants(first: 100) {
                  edges {
                    node {
                      legacyResourceId
                      title
                      price
                      availableForSale
                      selectedOptions {
                        name
                        value
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `,
      {
        first: Math.min(Math.max(limit, 1), 20),
        query: catalogQuery,
      },
    );

    return data.products.edges
      .map(({ node }) => {
        const availableVariants = node.variants.edges
          .map(({ node: variant }) => variant)
          .filter((variant) => variant.availableForSale);

        return {
          id: node.id,
          title: node.title,
          handle: node.handle,
          onlineStoreUrl: node.onlineStoreUrl,
          imageUrl: node.featuredImage?.url || null,
          imageAlt: node.featuredImage?.altText || null,
          variants: availableVariants.map((variant) => ({
            legacyResourceId: variant.legacyResourceId,
            title: variant.title,
            price: variant.price,
            options: variant.selectedOptions,
          })),
        };
      })
      .filter(
        (product) =>
          Boolean(product.onlineStoreUrl) && product.variants.length > 0,
      );
  }

  private async graphql<T>(
    companyId: string,
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    const connection = await this.getConnection(companyId);

    const response = await fetch(
      `https://${connection.shop}/admin/api/${encodeURIComponent(connection.apiVersion)}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Shopify-Access-Token': connection.accessToken,
        },
        body: JSON.stringify({ query, variables }),
      },
    );

    if (!response.ok) {
      throw new Error(
        `Shopify rechazó la consulta de catálogo (${response.status}).`,
      );
    }

    const result = (await response.json()) as ShopifyGraphqlResponse<T>;

    if (result.errors?.length) {
      throw new Error(
        result.errors
          .map((item) => item.message || 'Error desconocido de Shopify.')
          .join(' '),
      );
    }

    if (!result.data) {
      throw new Error('Shopify no devolvió datos de catálogo.');
    }

    return result.data;
  }

  private async getConnection(companyId: string): Promise<{
    shop: string;
    apiVersion: string;
    accessToken: string;
  }> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('company_integrations')
      .select('external_id, config, credentials_encrypted, credential_mode')
      .eq('company_id', companyId)
      .eq('provider', 'shopify')
      .eq('integration_type', 'store')
      .eq('status', 'active')
      .maybeSingle();

    if (error || !data) {
      throw new Error(
        error?.message ||
          'No hay una conexión Shopify activa para esta empresa.',
      );
    }

    const integration = data as IntegrationRow;

    if (
      integration.credential_mode !== 'encrypted' ||
      !integration.credentials_encrypted
    ) {
      throw new Error(
        'Esta tienda todavía usa una integración anterior y no puede usar el catálogo por empresa.',
      );
    }

    const credentials = this.credentialsService.decrypt(
      integration.credentials_encrypted,
    );
    const accessToken =
      typeof credentials.access_token === 'string'
        ? credentials.access_token.trim()
        : '';

    if (!accessToken) {
      throw new Error('No se encontró un token Shopify válido para esta empresa.');
    }

    const config = this.toRecord(integration.config);

    return {
      shop: this.normalizeShop(integration.external_id),
      apiVersion: this.text(config.api_version) || '2026-04',
      accessToken,
    };
  }

  private normalizeShop(value: string): string {
    const shop = value
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '')
      .toLowerCase();

    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
      throw new Error('La tienda Shopify configurada no tiene un dominio válido.');
    }

    return shop;
  }

  private toRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }
}
