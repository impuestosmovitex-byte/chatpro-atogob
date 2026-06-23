import { Injectable } from '@nestjs/common';

type ShopifyTokenResponse = {
  access_token: string;
  expires_in: number;
};

type ShopifyGraphqlResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

@Injectable()
export class ShopifyService {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  async getRecentProducts() {
    const data = await this.graphql<{
      products: {
        edges: Array<{
          node: {
            id: string;
            title: string;
            handle: string;
            status: string;
            featuredImage: {
              url: string;
              altText: string | null;
            } | null;
            variants: {
              edges: Array<{
                node: {
                  id: string;
                  title: string;
                  price: string;
                };
              }>;
            };
          };
        }>;
      };
    }>(`
      {
        products(first: 5, query: "status:active", sortKey: UPDATED_AT, reverse: true) {
          edges {
            node {
              id
              title
              handle
              status
              featuredImage {
                url
                altText
              }
              variants(first: 3) {
                edges {
                  node {
                    id
                    title
                    price
                  }
                }
              }
            }
          }
        }
      }
    `);

    return data.products.edges.map(({ node }) => node);
  }

  private async getAccessToken() {
    if (
      this.accessToken &&
      Date.now() < this.tokenExpiresAt - 60_000
    ) {
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

  private async graphql<T>(query: string): Promise<T> {
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
        body: JSON.stringify({ query }),
      },
    );

    if (!response.ok) {
      throw new Error(
        `No se pudo consultar Shopify: ${await response.text()}`,
      );
    }

    const result =
      (await response.json()) as ShopifyGraphqlResponse<T>;

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