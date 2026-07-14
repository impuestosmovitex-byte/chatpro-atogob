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



type ShopifyProductListVariant = {
  legacyResourceId: string;
  title: string;
  sku: string | null;
  price: string;
  availableForSale: boolean;
  inventoryQuantity: number | null;
  inventoryPolicy: string;
  inventoryItem: {
    tracked: boolean;
  };
};

type ShopifyProductListNode = {
  id: string;
  title: string;
  handle: string;
  status: string;
  publishedAt: string | null;
  onlineStoreUrl: string | null;
  totalInventory: number;
  tracksInventory: boolean;
  featuredImage: {
    url: string;
    altText: string | null;
  } | null;
  variantsCount: ShopifyCount;
  variants: {
    pageInfo: {
      hasNextPage: boolean;
    };
    edges: Array<{ node: ShopifyProductListVariant }>;
  };
};

export type CompanyShopifyProductListItem = {
  id: string;
  title: string;
  handle: string;
  status: string;
  publishedAt: string | null;
  onlineStoreUrl: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  totalInventory: number;
  tracksInventory: boolean;
  saleReady: boolean;
  variants: {
    total: number;
    shown: number;
    sellable: number;
    withoutStock: number;
    notTracked: number;
    hasMore: boolean;
  };
  previewVariants: Array<{
    legacyResourceId: string;
    title: string;
    sku: string | null;
    price: string;
    availableForSale: boolean;
    inventoryQuantity: number | null;
    tracked: boolean;
  }>;
};

export type CompanyShopifyProductsPage = {
  products: CompanyShopifyProductListItem[];
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
};

type ShopifyCount = {
  count: number;
  precision: string;
};

type ShopifyCatalogDiagnosticVariant = {
  availableForSale: boolean;
  inventoryQuantity: number | null;
  inventoryPolicy: string;
  inventoryItem: {
    tracked: boolean;
  };
};

type ShopifyCatalogDiagnosticProduct = {
  id: string;
  title: string;
  handle: string;
  status: string;
  publishedAt: string | null;
  onlineStoreUrl: string | null;
  totalInventory: number;
  tracksInventory: boolean;
  variantsCount: ShopifyCount;
  variants: {
    pageInfo: {
      hasNextPage: boolean;
    };
    edges: Array<{ node: ShopifyCatalogDiagnosticVariant }>;
  };
};

type CompanyShopifyCount = {
  count: number;
  precision: string;
};

export type CompanyShopifyCatalogDiagnostics = {
  counts: {
    totalProducts: CompanyShopifyCount;
    statuses: {
      active: CompanyShopifyCount;
      draft: CompanyShopifyCount;
      archived: CompanyShopifyCount;
      unlisted: CompanyShopifyCount;
    };
    onlineStore: {
      published: CompanyShopifyCount;
    };
    inventory: {
      withStock: CompanyShopifyCount;
      withoutStock: CompanyShopifyCount;
      notTracked: CompanyShopifyCount;
    };
  };
  scan: {
    scannedProducts: number;
    hasMoreProducts: boolean;
    reportedVariantsInScannedProducts: number;
    readVariants: number;
    sellableVariants: number;
    nonSellableVariants: number;
    productsWithUnreadVariants: number;
  };
  products: Array<{
    id: string;
    title: string;
    handle: string;
    status: string;
    onlineStorePublished: boolean;
    hasPublicUrl: boolean;
    totalInventory: number;
    tracksInventory: boolean;
    saleReady: boolean;
    variants: {
      total: number;
      read: number;
      sellable: number;
      nonSellable: number;
      withStock: number;
      withoutStock: number;
      notTracked: number;
      hasMore: boolean;
    };
    reasons: string[];
    note: string | null;
  }>;
};

type ShopifyCommerceVariantNode = {
  id: string;
  legacyResourceId: string;
  title: string;
  sku: string | null;
  price: string;
  availableForSale: boolean;
  inventoryQuantity: number | null;
  inventoryPolicy: string;
  inventoryItem: {
    tracked: boolean;
  };
  selectedOptions: Array<{ name: string; value: string }>;
};

type ShopifyCommerceProductNode = {
  id: string;
  title: string;
  handle: string;
  status: string;
  publishedAt: string | null;
  onlineStoreUrl: string | null;
  featuredImage: {
    url: string;
    altText: string | null;
  } | null;
  variants: {
    edges: Array<{ node: ShopifyCommerceVariantNode }>;
  };
};

type ShopifyCommerceVariantWithProduct = ShopifyCommerceVariantNode & {
  product: {
    id: string;
    title: string;
    handle: string;
    status: string;
    publishedAt: string | null;
    onlineStoreUrl: string | null;
  };
};


export type CompanyShopifyOrderLookupInput = {
  orderReference?: string;
  email?: string;
  phone?: string;
  limit?: number;
};

type CompanyShopifyOrderMoney = {
  amount: string;
  currencyCode: string;
};

type CompanyShopifyOrderTracking = {
  company: string | null;
  number: string | null;
  url: string | null;
};

type CompanyShopifyOrderLine = {
  title: string;
  quantity: number;
  variantTitle: string | null;
  originalUnitPriceSet: {
    shopMoney: CompanyShopifyOrderMoney;
  };
};

type CompanyShopifyOrderFulfillment = {
  status: string | null;
  displayStatus: string | null;
  createdAt: string | null;
  deliveredAt: string | null;
  trackingInfo: CompanyShopifyOrderTracking[];
};

type CompanyShopifyOrderNode = {
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
    shopMoney: CompanyShopifyOrderMoney;
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
    edges: Array<{ node: CompanyShopifyOrderLine }>;
  };
  fulfillments: CompanyShopifyOrderFulfillment[];
};

export type CompanyShopifyCustomerOrder = {
  id: string;
  name: string;
  createdAt: string | null;
  processedAt: string | null;
  cancelledAt: string | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  total: CompanyShopifyOrderMoney | null;
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
    unitPrice: CompanyShopifyOrderMoney;
  }>;
  fulfillments: Array<{
    status: string | null;
    displayStatus: string | null;
    createdAt: string | null;
    deliveredAt: string | null;
    tracking: CompanyShopifyOrderTracking[];
  }>;
  tracking: CompanyShopifyOrderTracking[];
};

export type CompanyCommerceCartLineInput = {
  variantId: string;
  quantity: number;
};

export type CompanyCommerceProduct = {
  id: string;
  title: string;
  handle: string;
  status: string;
  publishedAt: string;
  onlineStoreUrl: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  variants: Array<{
    id: string;
    legacyResourceId: string;
    title: string;
    sku: string | null;
    price: string;
    inventoryQuantity: number | null;
    inventoryPolicy: string;
    tracked: boolean;
    options: Array<{ name: string; value: string }>;
  }>;
};

export type CompanyCommerceCollection = {
  id: string;
  title: string;
  handle: string;
  onlineStoreUrl: string;
};

export type CompanyCommerceCartLinks = {
  cartUrl: string;
  checkoutUrl: string;
  lines: Array<{
    productId: string;
    productTitle: string;
    productHandle: string;
    productUrl: string;
    variantId: string;
    variantLegacyId: string;
    variantTitle: string;
    sku: string | null;
    unitPrice: string;
    options: Array<{ name: string; value: string }>;
    quantity: number;
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


  async getStorefrontUrl(companyId: string): Promise<string> {
    const data = await this.graphql<{
      shop: {
        primaryDomain: {
          url: string;
        };
      };
    }>(
      companyId,
      `
        query ChatProCompanyStorefront {
          shop {
            primaryDomain {
              url
            }
          }
        }
      `,
    );

    return this.normalizeCommerceStoreUrl(data.shop.primaryDomain.url);
  }

  async listCommerceCollections(
    companyId: string,
    limit = 100,
  ): Promise<CompanyCommerceCollection[]> {
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
      companyId,
      `
        query ChatProCompanyCollections($first: Int!) {
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

    const storeUrl = this.normalizeCommerceStoreUrl(
      data.shop.primaryDomain.url,
    );

    return data.collections.edges
      .map(({ node }) => ({
        id: node.id,
        title: node.title,
        handle: node.handle,
        onlineStoreUrl: `${storeUrl}/collections/${node.handle}`,
      }))
      .filter((collection) => Boolean(collection.handle));
  }



  async lookupCustomerOrders(
    companyId: string,
    input: CompanyShopifyOrderLookupInput,
  ): Promise<CompanyShopifyCustomerOrder[]> {
    const queries = this.buildOrderSearchQueries(input);
    const limit = Math.min(Math.max(Number(input.limit ?? 3), 1), 5);
    const seen = new Set<string>();
    const orders: CompanyShopifyCustomerOrder[] = [];

    for (const query of queries) {
      const found = await this.lookupOrdersByQuery(companyId, query, limit);

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
    companyId: string,
    query: string,
    limit: number,
  ): Promise<CompanyShopifyCustomerOrder[]> {
    const data = await this.graphql<{
      orders: {
        edges: Array<{ node: CompanyShopifyOrderNode }>;
      };
    }>(
      companyId,
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

  private buildOrderSearchQueries(input: CompanyShopifyOrderLookupInput): string[] {
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

  private toCustomerOrder(node: CompanyShopifyOrderNode): CompanyShopifyCustomerOrder {
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

  async listProducts(
    companyId: string,
    options: {
      searchText?: string;
      status?: string;
      after?: string | null;
      limit?: number;
    } = {},
  ): Promise<CompanyShopifyProductsPage> {
    const first = Math.min(Math.max(options.limit ?? 20, 1), 20);
    const status = this.normalizeProductStatus(options.status || '');
    const searchText = this.normalizeProductSearch(options.searchText || '');
    const query = [
      status ? `status:${status.toLowerCase()}` : '',
      searchText,
    ]
      .filter(Boolean)
      .join(' ');

    const data = await this.graphql<{
      products: {
        pageInfo: {
          hasNextPage: boolean;
          endCursor: string | null;
        };
        edges: Array<{ node: ShopifyProductListNode }>;
      };
    }>(
      companyId,
      `
        query ChatProCompanyProducts(
          $first: Int!
          $after: String
          $query: String!
        ) {
          products(
            first: $first
            after: $after
            query: $query
            sortKey: UPDATED_AT
            reverse: true
          ) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                id
                title
                handle
                status
                publishedAt
                onlineStoreUrl
                totalInventory
                tracksInventory
                featuredImage {
                  url
                  altText
                }
                variantsCount {
                  count
                  precision
                }
                variants(first: 5) {
                  pageInfo {
                    hasNextPage
                  }
                  edges {
                    node {
                      legacyResourceId
                      title
                      sku
                      price
                      availableForSale
                      inventoryQuantity
                      inventoryPolicy
                      inventoryItem {
                        tracked
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
        first,
        after: this.text(options.after || '') || null,
        query,
      },
    );

    return {
      products: data.products.edges.map(({ node }) => {
        const variants = node.variants.edges.map(({ node: variant }) => variant);
        const sellable = variants.filter(
          (variant) => variant.availableForSale,
        ).length;
        const withoutStock = variants.filter(
          (variant) =>
            variant.inventoryItem.tracked &&
            (variant.inventoryQuantity ?? 0) <= 0 &&
            variant.inventoryPolicy !== 'CONTINUE',
        ).length;
        const notTracked = variants.filter(
          (variant) => !variant.inventoryItem.tracked,
        ).length;
        const status = node.status.toUpperCase();
        const published = Boolean(node.publishedAt);
        const hasPublicUrl = Boolean(node.onlineStoreUrl);

        return {
          id: node.id,
          title: node.title,
          handle: node.handle,
          status,
          publishedAt: node.publishedAt,
          onlineStoreUrl: node.onlineStoreUrl,
          imageUrl: node.featuredImage?.url || null,
          imageAlt: node.featuredImage?.altText || null,
          totalInventory: node.totalInventory,
          tracksInventory: node.tracksInventory,
          saleReady:
            status === 'ACTIVE' &&
            published &&
            hasPublicUrl &&
            sellable > 0,
          variants: {
            total: node.variantsCount.count,
            shown: variants.length,
            sellable,
            withoutStock,
            notTracked,
            hasMore: node.variants.pageInfo.hasNextPage,
          },
          previewVariants: variants.map((variant) => ({
            legacyResourceId: variant.legacyResourceId,
            title: variant.title,
            sku: variant.sku,
            price: variant.price,
            availableForSale: variant.availableForSale,
            inventoryQuantity: variant.inventoryQuantity,
            tracked: variant.inventoryItem.tracked,
          })),
        };
      }),
      pageInfo: {
        hasNextPage: data.products.pageInfo.hasNextPage,
        endCursor: data.products.pageInfo.endCursor,
      },
    };
  }

  async getCatalogDiagnostics(
    companyId: string,
    productLimit = 20,
  ): Promise<CompanyShopifyCatalogDiagnostics> {
    const first = Math.min(Math.max(productLimit, 1), 20);
    const variantsFirst = 25;

    const [countData, catalogData] = await Promise.all([
      this.graphql<{
        total: ShopifyCount;
        active: ShopifyCount;
        draft: ShopifyCount;
        archived: ShopifyCount;
        unlisted: ShopifyCount;
        onlineStorePublished: ShopifyCount;
        withStock: ShopifyCount;
        withoutStock: ShopifyCount;
        notTracked: ShopifyCount;
      }>(
        companyId,
        `
          query ChatProCatalogDiagnosticCounts {
            total: productsCount(limit: null) {
              count
              precision
            }
            active: productsCount(query: "status:active", limit: null) {
              count
              precision
            }
            draft: productsCount(query: "status:draft", limit: null) {
              count
              precision
            }
            archived: productsCount(query: "status:archived", limit: null) {
              count
              precision
            }
            unlisted: productsCount(query: "status:unlisted", limit: null) {
              count
              precision
            }
            onlineStorePublished: productsCount(
              query: "published_status:published"
              limit: null
            ) {
              count
              precision
            }
            withStock: productsCount(query: "inventory_total:>0", limit: null) {
              count
              precision
            }
            withoutStock: productsCount(query: "inventory_total:<=0", limit: null) {
              count
              precision
            }
            notTracked: productsCount(query: "tracks_inventory:false", limit: null) {
              count
              precision
            }
          }
        `,
      ),
      this.graphql<{
        products: {
          pageInfo: {
            hasNextPage: boolean;
          };
          edges: Array<{ node: ShopifyCatalogDiagnosticProduct }>;
        };
      }>(
        companyId,
        `
          query ChatProCatalogDiagnostics($first: Int!, $variantsFirst: Int!) {
            products(first: $first, sortKey: UPDATED_AT, reverse: true) {
              pageInfo {
                hasNextPage
              }
              edges {
                node {
                  id
                  title
                  handle
                  status
                  publishedAt
                  onlineStoreUrl
                  totalInventory
                  tracksInventory
                  variantsCount {
                    count
                    precision
                  }
                  variants(first: $variantsFirst) {
                    pageInfo {
                      hasNextPage
                    }
                    edges {
                      node {
                        availableForSale
                        inventoryQuantity
                        inventoryPolicy
                        inventoryItem {
                          tracked
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        `,
        { first, variantsFirst },
      ),
    ]);

    let reportedVariantsInScannedProducts = 0;
    let readVariants = 0;
    let sellableVariants = 0;
    let nonSellableVariants = 0;
    let productsWithUnreadVariants = 0;

    const products = catalogData.products.edges.map(({ node }) => {
      const variants = node.variants.edges.map(({ node: variant }) => variant);
      const totalVariants = node.variantsCount.count;
      const sellable = variants.filter(
        (variant) => variant.availableForSale,
      ).length;
      const nonSellable = variants.length - sellable;
      const withStock = variants.filter(
        (variant) =>
          variant.inventoryItem.tracked &&
          (variant.inventoryQuantity ?? 0) > 0,
      ).length;
      const withoutStock = variants.filter(
        (variant) =>
          variant.inventoryItem.tracked &&
          (variant.inventoryQuantity ?? 0) <= 0,
      ).length;
      const notTracked = variants.filter(
        (variant) => !variant.inventoryItem.tracked,
      ).length;
      const onlineStorePublished = Boolean(node.publishedAt);
      const hasPublicUrl = Boolean(node.onlineStoreUrl);
      const status = node.status.toUpperCase();
      const allReadVariantsAreOutOfStock =
        !node.variants.pageInfo.hasNextPage &&
        variants.length > 0 &&
        variants.every(
          (variant) =>
            variant.inventoryItem.tracked &&
            (variant.inventoryQuantity ?? 0) <= 0 &&
            variant.inventoryPolicy !== 'CONTINUE',
        );
      const saleReady =
        status === 'ACTIVE' &&
        onlineStorePublished &&
        hasPublicUrl &&
        sellable > 0;

      const reasons: string[] = [];

      if (status !== 'ACTIVE') {
        reasons.push(
          `El producto está ${this.catalogStatusLabel(status).toLowerCase()}.`,
        );
      }

      if (!onlineStorePublished) {
        reasons.push('No está publicado en la tienda online.');
      }

      if (!hasPublicUrl) {
        reasons.push('Shopify no expone una URL pública para el producto.');
      }

      if (totalVariants === 0) {
        reasons.push('No tiene variantes configuradas.');
      } else if (sellable === 0) {
        reasons.push(
          allReadVariantsAreOutOfStock
            ? 'Todas las variantes están sin inventario y no permiten seguir vendiendo.'
            : 'Shopify no marca ninguna variante como disponible para venta.',
        );
      }

      if (reasons.length === 0) {
        reasons.push('Disponible para venta según la información actual de Shopify.');
      }

      reportedVariantsInScannedProducts += totalVariants;
      readVariants += variants.length;
      sellableVariants += sellable;
      nonSellableVariants += nonSellable;

      if (node.variants.pageInfo.hasNextPage) {
        productsWithUnreadVariants += 1;
      }

      return {
        id: node.id,
        title: node.title,
        handle: node.handle,
        status,
        onlineStorePublished,
        hasPublicUrl,
        totalInventory: node.totalInventory,
        tracksInventory: node.tracksInventory,
        saleReady,
        variants: {
          total: totalVariants,
          read: variants.length,
          sellable,
          nonSellable,
          withStock,
          withoutStock,
          notTracked,
          hasMore: node.variants.pageInfo.hasNextPage,
        },
        reasons,
        note: node.variants.pageInfo.hasNextPage
          ? 'Este producto tiene más de 25 variantes; se analizaron las primeras 25.'
          : null,
      };
    });

    return {
      counts: {
        totalProducts: this.toCount(countData.total),
        statuses: {
          active: this.toCount(countData.active),
          draft: this.toCount(countData.draft),
          archived: this.toCount(countData.archived),
          unlisted: this.toCount(countData.unlisted),
        },
        onlineStore: {
          published: this.toCount(countData.onlineStorePublished),
        },
        inventory: {
          withStock: this.toCount(countData.withStock),
          withoutStock: this.toCount(countData.withoutStock),
          notTracked: this.toCount(countData.notTracked),
        },
      },
      scan: {
        scannedProducts: products.length,
        hasMoreProducts: catalogData.products.pageInfo.hasNextPage,
        reportedVariantsInScannedProducts,
        readVariants,
        sellableVariants,
        nonSellableVariants,
        productsWithUnreadVariants,
      },
      products,
    };
  }


async searchCommerceProducts(
    companyId: string,
    searchText = '',
    limit = 8,
  ): Promise<CompanyCommerceProduct[]> {
    const query = [
      'status:active',
      this.normalizeProductSearch(searchText),
    ]
      .filter(Boolean)
      .join(' ');

    const data = await this.graphql<{
      products: {
        edges: Array<{ node: ShopifyCommerceProductNode }>;
      };
    }>(
      companyId,
      `
        query ChatProCommerceSearch($first: Int!, $query: String!) {
          products(first: $first, query: $query, sortKey: RELEVANCE) {
            edges {
              node {
                id
                title
                handle
                status
                publishedAt
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
                      sku
                      price
                      availableForSale
                      inventoryQuantity
                      inventoryPolicy
                      inventoryItem {
                        tracked
                      }
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
        query,
      },
    );

    return data.products.edges
      .map(({ node }) => this.toCommerceProduct(node))
      .filter(
        (product): product is CompanyCommerceProduct => product !== null,
      );
  }

  async getCommerceProductByHandle(
    companyId: string,
    handle: string,
  ): Promise<CompanyCommerceProduct | null> {
    const cleanHandle = this.text(handle).toLowerCase();

    if (!cleanHandle) {
      return null;
    }

    const data = await this.graphql<{
      productByHandle: ShopifyCommerceProductNode | null;
    }>(
      companyId,
      `
        query ChatProCommerceProduct($handle: String!) {
          productByHandle(handle: $handle) {
            id
            title
            handle
            status
            publishedAt
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
                  sku
                  price
                  availableForSale
                  inventoryQuantity
                  inventoryPolicy
                  inventoryItem {
                    tracked
                  }
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
      { handle: cleanHandle },
    );

    return data.productByHandle
      ? this.toCommerceProduct(data.productByHandle)
      : null;
  }

  async buildCommerceCartLinks(
    companyId: string,
    requestedLines: CompanyCommerceCartLineInput[],
  ): Promise<CompanyCommerceCartLinks> {
    const lines = this.normalizeCommerceCartLines(requestedLines);

    const data = await this.graphql<{
      nodes: Array<ShopifyCommerceVariantWithProduct | null>;
      shop: {
        primaryDomain: {
          url: string;
        };
      };
    }>(
      companyId,
      `
        query ChatProCommerceCartValidation($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on ProductVariant {
              id
              legacyResourceId
              title
              sku
              price
              availableForSale
              inventoryQuantity
              inventoryPolicy
              inventoryItem {
                tracked
              }
              selectedOptions {
                name
                value
              }
              product {
                id
                title
                handle
                status
                publishedAt
                onlineStoreUrl
              }
            }
          }
          shop {
            primaryDomain {
              url
            }
          }
        }
      `,
      {
        ids: lines.map((line) => line.variantId),
      },
    );

    const variants = new Map(
      data.nodes
        .filter(
          (node): node is ShopifyCommerceVariantWithProduct => Boolean(node),
        )
        .map((node) => [node.id, node]),
    );

    const validatedLines = lines.map((line) => {
      const variant = variants.get(line.variantId);

      if (!variant) {
        throw new Error(
          'Una variante del carrito ya no existe en la tienda de esta empresa.',
        );
      }

      const product = variant.product;
      const active = product.status.toUpperCase() === 'ACTIVE';
      const published = Boolean(product.publishedAt);
      const productUrl = product.onlineStoreUrl || '';

      if (!active || !published) {
        throw new Error(
          `El producto "${product.title}" ya no está disponible para vender en la tienda online.`,
        );
      }

      if (!variant.availableForSale) {
        throw new Error(
          `La variante "${variant.title}" ya no está disponible para vender.`,
        );
      }

      const availableQuantity = Math.max(
        variant.inventoryQuantity ?? 0,
        0,
      );

      if (
        variant.inventoryItem.tracked &&
        variant.inventoryPolicy !== 'CONTINUE' &&
        line.quantity > availableQuantity
      ) {
        throw new Error(
          `No hay inventario suficiente para la variante "${variant.title}".`,
        );
      }

      return {
        productId: product.id,
        productTitle: product.title,
        productHandle: product.handle,
        productUrl,
        variantId: variant.id,
        variantLegacyId: variant.legacyResourceId,
        variantTitle: variant.title,
        sku: variant.sku,
        unitPrice: variant.price,
        options: variant.selectedOptions.map((option) => ({ ...option })),
        quantity: line.quantity,
      };
    });

    const storeUrl = this.normalizeCommerceStoreUrl(
      data.shop.primaryDomain.url,
    );

    const cartPath = validatedLines
      .map((line) => `${line.variantLegacyId}:${line.quantity}`)
      .join(',');

    return {
      cartUrl: `${storeUrl}/cart/${cartPath}?storefront=true`,
      checkoutUrl: `${storeUrl}/cart/${cartPath}`,
      lines: validatedLines,
    };
  }

  private toCommerceProduct(
    product: ShopifyCommerceProductNode,
  ): CompanyCommerceProduct | null {
    const status = this.text(product.status).toUpperCase();
    const publishedAt = product.publishedAt || null;
    const onlineStoreUrl = product.onlineStoreUrl || null;

    if (status !== 'ACTIVE' || !publishedAt) {
      return null;
    }

    const variants = product.variants.edges
      .map(({ node }) => node)
      .filter((variant) => variant.availableForSale)
      .map((variant) => ({
        id: variant.id,
        legacyResourceId: variant.legacyResourceId,
        title: variant.title,
        sku: variant.sku,
        price: variant.price,
        inventoryQuantity: variant.inventoryQuantity,
        inventoryPolicy: variant.inventoryPolicy,
        tracked: variant.inventoryItem.tracked,
        options: variant.selectedOptions.map((option) => ({ ...option })),
      }));

    if (!variants.length) {
      return null;
    }

    return {
      id: product.id,
      title: product.title,
      handle: product.handle,
      status,
      publishedAt,
      onlineStoreUrl,
      imageUrl: product.featuredImage?.url || null,
      imageAlt: product.featuredImage?.altText || null,
      variants,
    };
  }

  private normalizeCommerceCartLines(
    lines: CompanyCommerceCartLineInput[],
  ): CompanyCommerceCartLineInput[] {
    if (!Array.isArray(lines) || !lines.length) {
      throw new Error('No hay productos para agregar al carrito.');
    }

    const merged = new Map<string, number>();

    for (const line of lines) {
      const variantId = this.text(line?.variantId);
      const quantity = Number(line?.quantity);

      if (!variantId.startsWith('gid://shopify/ProductVariant/')) {
        throw new Error('La variante no tiene un identificador Shopify válido.');
      }

      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new Error(
          'La cantidad debe ser un número entero mayor a cero.',
        );
      }

      merged.set(variantId, (merged.get(variantId) || 0) + quantity);
    }

    return Array.from(merged.entries()).map(([variantId, quantity]) => ({
      variantId,
      quantity,
    }));
  }

  private normalizeCommerceStoreUrl(value: string): string {
    const raw = this.text(value);

    if (!raw) {
      throw new Error('Shopify no devolvió el dominio de la tienda.');
    }

    try {
      const url = new URL(
        /^https?:\/\//i.test(raw) ? raw : `https://${raw}`,
      );

      return url.origin;
    } catch {
      throw new Error('El dominio Shopify de la empresa no es válido.');
    }
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


  private toCount(value: ShopifyCount): CompanyShopifyCount {
    return {
      count: value.count,
      precision: value.precision,
    };
  }

  private catalogStatusLabel(status: string): string {
    if (status === 'DRAFT') return 'Borrador';
    if (status === 'ARCHIVED') return 'Archivado';
    if (status === 'UNLISTED') return 'No listado';
    if (status === 'ACTIVE') return 'Activo';
    return status;
  }



  private normalizeProductStatus(value: string): string {
    const status = this.text(value).toUpperCase();

    return ['ACTIVE', 'DRAFT', 'ARCHIVED', 'UNLISTED'].includes(status)
      ? status
      : '';
  }

  private normalizeProductSearch(value: string): string {
    return this.text(value)
      .replace(/["'():]/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 120);
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
