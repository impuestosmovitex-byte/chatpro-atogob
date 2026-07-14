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
  legacyResourceId: string;
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


export type ShopifyOrderLookupInput = {
  orderReference?: string;
  email?: string;
  phone?: string;
  limit?: number;
};

type ShopifyOrderMoney = {
  amount: string;
  currencyCode: string;
};

type ShopifyOrderTracking = {
  company: string | null;
  number: string | null;
  url: string | null;
};

type ShopifyOrderLine = {
  title: string;
  quantity: number;
  variantTitle: string | null;
  originalUnitPriceSet: {
    shopMoney: ShopifyOrderMoney;
  };
};

type ShopifyOrderFulfillment = {
  status: string | null;
  displayStatus: string | null;
  createdAt: string | null;
  deliveredAt: string | null;
  trackingInfo: ShopifyOrderTracking[];
};

type ShopifyOrderNode = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  createdAt: string | null;
  processedAt: string | null;
  cancelledAt: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  currentTotalPriceSet: {
    shopMoney: ShopifyOrderMoney;
  } | null;
  customer: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  shippingAddress: {
    name: string | null;
    phone: string | null;
    city: string | null;
    province: string | null;
    country: string | null;
    address1: string | null;
    address2: string | null;
  } | null;
  lineItems: {
    edges: Array<{ node: ShopifyOrderLine }>;
  };
  fulfillments: ShopifyOrderFulfillment[];
};

export type ShopifyCustomerOrder = {
  id: string;
  name: string;
  createdAt: string | null;
  processedAt: string | null;
  cancelledAt: string | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  total: ShopifyOrderMoney | null;
  customer: {
    name: string;
    email: string | null;
    phone: string | null;
  };
  shippingAddress: {
    name: string | null;
    phone: string | null;
    city: string | null;
    province: string | null;
    country: string | null;
    address1: string | null;
    address2: string | null;
  } | null;
  lineItems: Array<{
    title: string;
    quantity: number;
    variantTitle: string | null;
    unitPrice: ShopifyOrderMoney;
  }>;
  fulfillments: Array<{
    status: string | null;
    displayStatus: string | null;
    createdAt: string | null;
    deliveredAt: string | null;
    tracking: ShopifyOrderTracking[];
  }>;
  tracking: ShopifyOrderTracking[];
};

export type ShopifyCartLineInput = {
  variantLegacyId: string;
  quantity: number;
};

export type ShopifyCartLinks = {
  cartUrl: string;
  checkoutUrl: string;
  lines: ShopifyCartLineInput[];
};

@Injectable()
export class ShopifyService {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private storeUrl: string | null = null;

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

    const storeUrl = this.normalizeStoreUrl(data.shop.primaryDomain.url);
    this.storeUrl = storeUrl;

    return data.collections.edges.map(({ node }) => ({
      ...node,
      onlineStoreUrl: `${storeUrl}/collections/${node.handle}`,
    }));
  }

  async getProductFromUrl(value: string) {
    const handle = this.extractProductHandle(value);

    if (!handle) {
      return null;
    }

    return this.getProductByHandle(handle);
  }

  async getProductByHandle(handle: string) {
    const cleanHandle = handle.trim().toLowerCase();

    if (!cleanHandle) {
      return null;
    }

    const data = await this.graphql<{
      productByHandle: ShopifyProduct | null;
    }>(
      `
        query ProductByHandle($handle: String!) {
          productByHandle(handle: $handle) {
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
                  legacyResourceId
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
      `,
      {
        handle: cleanHandle,
      },
    );

    const product = data.productByHandle;

    if (!product || !product.onlineStoreUrl) {
      return null;
    }

    const availableVariants = product.variants.edges.filter(
      ({ node }) => node.availableForSale,
    );

    if (!availableVariants.length) {
      return null;
    }

    return {
      ...product,
      variants: {
        edges: availableVariants,
      },
    };
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
                      legacyResourceId
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


  async lookupCustomerOrders(
    input: ShopifyOrderLookupInput,
  ): Promise<ShopifyCustomerOrder[]> {
    const queries = this.buildOrderSearchQueries(input);
    const limit = Math.min(Math.max(Number(input.limit ?? 3), 1), 5);
    const seen = new Set<string>();
    const orders: ShopifyCustomerOrder[] = [];

    for (const query of queries) {
      const found = await this.lookupOrdersByQuery(query, limit);

      for (const order of found) {
        if (seen.has(order.id)) {
          continue;
        }

        seen.add(order.id);
        orders.push(order);

        if (orders.length >= limit) {
          return orders;
        }
      }
    }

    return orders;
  }

  // Consulta base de pedidos intencionalmente simple: evita campos de cliente/envío/fulfillment
  // para no romper por permisos de datos protegidos. Guías se agregan en un bloque separado.
  private async lookupOrdersByQuery(
    query: string,
    limit: number,
  ): Promise<ShopifyCustomerOrder[]> {
    const data = await this.graphql<{
      orders: {
        edges: Array<{ node: ShopifyOrderNode }>;
      };
    }>(
      `
        query ChatProLookupOrders($first: Int!, $query: String!) {
          orders(first: $first, query: $query, sortKey: PROCESSED_AT, reverse: true) {
            edges {
              node {
                id
                name
                createdAt
                processedAt
                cancelledAt
                displayFinancialStatus
                displayFulfillmentStatus
                currentTotalPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                lineItems(first: 20) {
                  edges {
                    node {
                      title
                      quantity
                      variantTitle
                      originalUnitPriceSet {
                        shopMoney {
                          amount
                          currencyCode
                        }
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
        first: limit,
        query,
      },
    );

    return data.orders.edges.map(({ node }) => this.toCustomerOrder(node));
  }

  private buildOrderSearchQueries(input: ShopifyOrderLookupInput): string[] {
    const queries: string[] = [];
    const rawReference = String(input.orderReference ?? '').trim();
    const email = String(input.email ?? '').trim().toLowerCase();
    const phone = this.normalizeOrderPhone(input.phone);

    if (rawReference) {
      const clean = rawReference.replace(/^#/, '').trim();
      const compact = clean.replace(/\s+/g, '');
      const digits = compact.replace(/\D/g, '');

      if (compact) {
        queries.push(`name:#${compact}`);
        queries.push(`name:${compact}`);
        queries.push(compact);
        queries.push(`#${compact}`);
      }

      if (digits) {
        queries.push(`name:#${digits}`);
        queries.push(`name:${digits}`);
        queries.push(digits);
        queries.push(`#${digits}`);
      }
    }

    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      queries.push(`email:${email}`);
    }

    if (phone) {
      queries.push(`phone:${phone}`);

      if (phone.length > 10) {
        queries.push(`phone:${phone.slice(-10)}`);
      }
    }

    return Array.from(new Set(queries)).slice(0, 8);
  }

  private normalizeOrderPhone(value: unknown): string {
    return String(value ?? '').replace(/\D/g, '').slice(0, 20);
  }

  private toCustomerOrder(node: ShopifyOrderNode): ShopifyCustomerOrder {
    const customerName = [
      node.customer?.firstName,
      node.customer?.lastName,
    ]
      .filter(Boolean)
      .join(' ')
      .trim();

    const fulfillments = (node.fulfillments ?? []).map((fulfillment) => ({
      status: fulfillment.status ?? null,
      displayStatus: fulfillment.displayStatus ?? null,
      createdAt: fulfillment.createdAt ?? null,
      deliveredAt: fulfillment.deliveredAt ?? null,
      tracking: (fulfillment.trackingInfo ?? []).map((tracking) => ({
        company: tracking.company ?? null,
        number: tracking.number ?? null,
        url: tracking.url ?? null,
      })),
    }));

    return {
      id: node.id,
      name: node.name,
      createdAt: node.createdAt ?? null,
      processedAt: node.processedAt ?? null,
      cancelledAt: node.cancelledAt ?? null,
      financialStatus: node.displayFinancialStatus ?? null,
      fulfillmentStatus: node.displayFulfillmentStatus ?? null,
      total: node.currentTotalPriceSet?.shopMoney ?? null,
      customer: {
        name: customerName || node.shippingAddress?.name || '',
        email: node.customer?.email ?? node.email ?? null,
        phone: node.customer?.phone ?? node.phone ?? null,
      },
      shippingAddress: node.shippingAddress
        ? {
            name: node.shippingAddress.name ?? null,
            phone: node.shippingAddress.phone ?? null,
            city: node.shippingAddress.city ?? null,
            province: node.shippingAddress.province ?? null,
            country: node.shippingAddress.country ?? null,
            address1: node.shippingAddress.address1 ?? null,
            address2: node.shippingAddress.address2 ?? null,
          }
        : null,
      lineItems: node.lineItems.edges.map(({ node: line }) => ({
        title: line.title,
        quantity: line.quantity,
        variantTitle: line.variantTitle ?? null,
        unitPrice: line.originalUnitPriceSet.shopMoney,
      })),
      fulfillments,
      tracking: fulfillments.flatMap((fulfillment) => fulfillment.tracking),
    };
  }

  async buildCartLinks(
    lines: ShopifyCartLineInput[],
  ): Promise<ShopifyCartLinks> {
    const normalizedLines = this.normalizeCartLines(lines);
    const storeUrl = await this.getStoreUrl();

    const cartPath = normalizedLines
      .map((line) => `${line.variantLegacyId}:${line.quantity}`)
      .join(',');

    return {
      cartUrl: `${storeUrl}/cart/${cartPath}?storefront=true`,
      checkoutUrl: `${storeUrl}/cart/${cartPath}`,
      lines: normalizedLines,
    };
  }

  private normalizeCartLines(
    lines: ShopifyCartLineInput[],
  ): ShopifyCartLineInput[] {
    const mergedLines = new Map<string, number>();

    for (const line of lines) {
      const variantLegacyId = String(line.variantLegacyId ?? '').trim();
      const quantity = Number(line.quantity);

      if (!/^\d+$/.test(variantLegacyId)) {
        throw new Error('La variante no tiene un ID válido para el carrito.');
      }

      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new Error('La cantidad debe ser un número entero mayor a cero.');
      }

      mergedLines.set(
        variantLegacyId,
        (mergedLines.get(variantLegacyId) ?? 0) + quantity,
      );
    }

    if (!mergedLines.size) {
      throw new Error('No hay productos para agregar al carrito.');
    }

    return Array.from(mergedLines.entries()).map(
      ([variantLegacyId, quantity]) => ({
        variantLegacyId,
        quantity,
      }),
    );
  }

  private async getStoreUrl() {
    if (this.storeUrl) {
      return this.storeUrl;
    }

    const data = await this.graphql<{
      shop: {
        primaryDomain: {
          url: string;
        };
      };
    }>(
      `
        query GetStoreDomain {
          shop {
            primaryDomain {
              url
            }
          }
        }
      `,
    );

    this.storeUrl = this.normalizeStoreUrl(data.shop.primaryDomain.url);

    return this.storeUrl;
  }

  private normalizeStoreUrl(url: string) {
    return url.trim().replace(/\/$/, '');
  }
async getOpenAbandonedCheckoutsCount() {
  const data = await this.graphql<{
    abandonedCheckoutsCount: {
      count: number;
      precision: string;
    };
  }>(
    `
      query OpenAbandonedCheckoutsCount($query: String!) {
        abandonedCheckoutsCount(query: $query) {
          count
          precision
        }
      }
    `,
    {
      query: 'status:open recovery_state:not_recovered',
    },
  );

  return data.abandonedCheckoutsCount;
}
  async getOpenAbandonedCheckoutsPreview(limit = 3) {
    const data = await this.graphql<{
      abandonedCheckouts: {
        edges: Array<{
          node: {
            createdAt: string;
            updatedAt: string;
            abandonedCheckoutUrl: string;
            shippingAddress: {
  phone: string | null;
} | null;
billingAddress: {
  phone: string | null;
} | null;
            totalPriceSet: {
              shopMoney: {
                amount: string;
                currencyCode: string;
              };
            };
            lineItems: {
              edges: Array<{
                node: {
                  title: string | null;
                  variantTitle: string | null;
                  quantity: number;
                  originalUnitPriceSet: {
                    shopMoney: {
                      amount: string;
                      currencyCode: string;
                    };
                  };
                };
              }>;
            };
          };
        }>;
      };
    }>(
      `
        query OpenAbandonedCheckoutsPreview($first: Int!, $query: String!) {
          abandonedCheckouts(
            first: $first
            query: $query
            sortKey: CREATED_AT
            reverse: true
          ) {
            edges {
              node {
                createdAt
                updatedAt
                abandonedCheckoutUrl
                                shippingAddress {
                  phone
                }
                billingAddress {
                  phone
                }
                totalPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                lineItems(first: 50) {
                  edges {
                    node {
                      title
                      variantTitle
                      quantity
                      originalUnitPriceSet {
                        shopMoney {
                          amount
                          currencyCode
                        }
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
        first: Math.min(Math.max(limit, 1), 3),
        query: 'status:open recovery_state:not_recovered',
      },
    );

    return data.abandonedCheckouts.edges.map(({ node }) => ({
      created_at: node.createdAt,
      updated_at: node.updatedAt,
      total: node.totalPriceSet.shopMoney,
      products: node.lineItems.edges.map(({ node: line }) => ({
        title: line.title,
        variant_title: line.variantTitle,
        quantity: line.quantity,
        unit_price: line.originalUnitPriceSet.shopMoney,
      })),
      has_recovery_url: Boolean(node.abandonedCheckoutUrl),
            has_phone: Boolean(
        node.shippingAddress?.phone || node.billingAddress?.phone,
      ),
    }));
  }
    async listOpenAbandonedCheckoutsCreatedSince(
    createdSince: string,
    limit = 50,
  ) {
    const normalizedCreatedSince = new Date(createdSince).toISOString();
    const data = await this.graphql<{
      abandonedCheckouts: {
        edges: Array<{
          node: {
            id: string;
            createdAt: string;
            updatedAt: string;
            abandonedCheckoutUrl: string;
            shippingAddress: {
              firstName: string | null;
              lastName: string | null;
              phone: string | null;
            } | null;
            billingAddress: {
              firstName: string | null;
              lastName: string | null;
              phone: string | null;
            } | null;
            totalPriceSet: {
              shopMoney: {
                amount: string;
                currencyCode: string;
              };
            };
            lineItems: {
              edges: Array<{
                node: {
                  title: string | null;
                  variantTitle: string | null;
                  quantity: number;
                  product: {
                    id: string;
                    handle: string;
                    title: string;
                    onlineStoreUrl: string | null;
                  } | null;
                  variant: {
                    id: string;
                    legacyResourceId: string;
                    title: string;
                    price: string;
                    selectedOptions: Array<{
                      name: string;
                      value: string;
                    }>;
                  } | null;
                  originalUnitPriceSet: {
                    shopMoney: {
                      amount: string;
                      currencyCode: string;
                    };
                  };
                };
              }>;
            };
          };
        }>;
      };
    }>(
      `
        query OpenAbandonedCheckoutsForRecovery(
          $first: Int!
          $query: String!
        ) {
          abandonedCheckouts(
            first: $first
            query: $query
            sortKey: CREATED_AT
            reverse: false
          ) {
            edges {
              node {
                id
                createdAt
                updatedAt
                abandonedCheckoutUrl
                shippingAddress {
                  firstName
                  lastName
                  phone
                }
                billingAddress {
                  firstName
                  lastName
                  phone
                }
                totalPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                lineItems(first: 50) {
                  edges {
                    node {
                      title
                      variantTitle
                      quantity
                      product {
                        id
                        handle
                        title
                        onlineStoreUrl
                      }
                      variant {
                        id
                        legacyResourceId
                        title
                        price
                        selectedOptions {
                          name
                          value
                        }
                      }
                      originalUnitPriceSet {
                        shopMoney {
                          amount
                          currencyCode
                        }
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
        first: Math.min(Math.max(limit, 1), 50),
        query: [
          'status:open',
          'recovery_state:not_recovered',
          `created_at:>='${normalizedCreatedSince}'`,
        ].join(' '),
      },
    );

    return data.abandonedCheckouts.edges.map(({ node }) => {
      const nameFrom = (
        address:
          | {
              firstName: string | null;
              lastName: string | null;
            }
          | null
          | undefined,
      ) =>
        [address?.firstName, address?.lastName]
          .filter(
            (value): value is string =>
              typeof value === 'string' && Boolean(value.trim()),
          )
          .join(' ')
          .trim();

      const shippingName = nameFrom(node.shippingAddress);
      const billingName = nameFrom(node.billingAddress);

      return {
        externalId: node.id,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
        checkoutUrl: node.abandonedCheckoutUrl,
        customerPhone:
          node.shippingAddress?.phone ||
          node.billingAddress?.phone ||
          null,
        customerName: shippingName || billingName || null,
        customerEmail: null,
        total: node.totalPriceSet.shopMoney,
        lines: node.lineItems.edges.map(({ node: line }) => ({
          title: line.title,
          variantTitle: line.variantTitle,
          quantity: line.quantity,
          product: line.product
            ? {
                id: line.product.id,
                handle: line.product.handle,
                title: line.product.title,
                url: line.product.onlineStoreUrl,
              }
            : null,
          variant: line.variant
            ? {
                id: line.variant.id,
                legacyResourceId: line.variant.legacyResourceId,
                title: line.variant.title,
                price: line.variant.price,
                options: line.variant.selectedOptions,
              }
            : null,
          unitPrice: line.originalUnitPriceSet.shopMoney,
        })),
      };
    });
  }

  private extractProductHandle(value: string): string | null {
    const match = value.trim().match(/\/products\/([^/?#]+)/i);

    if (!match?.[1]) {
      return null;
    }

    return decodeURIComponent(match[1]).trim().toLowerCase();
  }

  private async getAccessToken(): Promise<string> {
    const directToken =
      process.env.SHOPIFY_ACCESS_TOKEN?.trim() ||
      process.env.SHOPIFY_ADMIN_ACCESS_TOKEN?.trim() ||
      process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN?.trim() ||
      process.env.SHOPIFY_API_ACCESS_TOKEN?.trim() ||
      '';

    if (directToken) {
      return directToken;
    }

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
