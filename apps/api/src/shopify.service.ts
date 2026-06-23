import { Injectable } from '@nestjs/common';

type ShopifyTokenResponse = {
  access_token: string;
  expires_in: number;
};

type ShopifyGraphqlResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

type ShopifyVariantOption = {
  name: string;
  value: string;
};

type ShopifyProductVariant = {
  id: string;
  title: string;
  price: string;
  availableForSale: boolean;
  inventoryQuantity: number | null;
  sellableOnlineQuantity: number;
  selectedOptions: ShopifyVariantOption[];
};

type ShopifyProduct = {
  id: string;
  title: string;
  handle: string;
  status: string;
  onlineStoreUrl: string | null;
  featuredImage: {
    url: string;
    altText: string | null;
  } | null;
  variants: {
    edges: Array<{
      node: ShopifyProductVariant;
    }>;
  };
};

@Injectable()
export class ShopifyService {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  async getRecentProducts() {
    return this.searchCatalog('', 5);
  }
      async getCollections(limit = 100) {
    const data = await this.graphql<{
      shop: {
        primaryDomain: {
          url: string;
        };
      };
      collections: {
        edges: Array<{
          node: {
            id: string;
            title: string;
            handle: string;
          };
        }>;
      };
    }>(
      `
        query GetCollections($first: Int!) {
          shop {
            primaryDomain {
              url
            }
          }
          collections(first: $first, sortKey: TITLE) {
            edges {
              node {
                id
                title
                handle
              }
            }
          }
        }
      `,
      {
        first: Math.min(Math.max(limit, 1), 100),
      },
    );

    const storeUrl = data.shop.primaryDomain.url.replace(/\/$/, '');

    return data.collections.edges.map(({ node }) => ({
      ...node,
      onlineStoreUrl: `${storeUrl}/collections/${node.handle}`,
    }));
  }

  async searchCatalog(searchText: string, limit = 5) {
    const catalogQuery = ['status:active', searchText.trim()]
      .filter(Boolean)
      .join(' ');

    const data = await this.graphql<{
      products: {
        edges: Array<{ node: ShopifyProduct }>;
      };
    }>(
      `
        query SearchCatalog($first: Int!, $query: String!) {
          products(first: $first, query: $query, sortKey: RELEVANCE) {
            edges {
              node {
                id
                title
                handle
                status
                onlineStoreUrl
                featuredImage {
                  url
                  altText
                }
                variants(first: 100) {
                  edges {
                    node {
                      id
                      title
                      price
                      availableForSale
                      inventoryQuantity
                      sellableOnlineQuantity
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
        first: Math.min(Math.max(limit, 1), 10),
        query: catalogQuery,
      },
    );

    return data.products.edges
      .map(({ node }) => ({
        ...node,
        variants: {
          edges: node.variants.edges.filter(
            ({ node: variant }) => variant.availableForSale,
          ),
        },
      }))
      .filter(
        (product) =>
          product.onlineStoreUrl && product.variants.edges.length > 0,
      );
  }

  private async getAccessToken() {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.accessToken;
    }

    const shop = this.getRequiredEnv('SHOPIFY_SHOP');
    const clientId = this.getRequiredEnv('SHOPIFY_CLIENT_ID');
    const clientSecret = this.getRequiredEnv('SHOPIFY_CLIENT_SECRET');

    const response = await fetch(
      `https://${shop}/admin/oauth/access_token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(
        `No se pudo obtener el token de Shopify: ${await response.text()}`,
      );
    }

    const token = (await response.json()) as ShopifyTokenResponse;

    this.accessToken = token.access_token;
    this.tokenExpiresAt = Date.now() + token.expires_in * 1000;

    return this.accessToken;
  }

  private async graphql<T>(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    const shop = this.getRequiredEnv('SHOPIFY_SHOP');
    const apiVersion = process.env.SHOPIFY_API_VERSION ?? '2026-04';

    const response = await fetch(
      `https://${shop}/admin/api/${apiVersion}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': await this.getAccessToken(),
        },
        body: JSON.stringify({ query, variables }),
      },
    );

    if (!response.ok) {
      throw new Error(
        `No se pudo consultar Shopify: ${await response.text()}`,
      );
    }

    const result = (await response.json()) as ShopifyGraphqlResponse<T>;

    if (result.errors?.length) {
      throw new Error(
        `Error de Shopify: ${result.errors
          .map((error) => error.message)
          .join(', ')}`,
      );
    }

    if (!result.data) {
      throw new Error('Shopify no devolvió datos.');
    }

    return result.data;
  }

  private getRequiredEnv(name: string) {
    const value = process.env[name]?.trim();

    if (!value) {
      throw new Error(`Falta la variable ${name} en Railway.`);
    }

    return value.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }
}