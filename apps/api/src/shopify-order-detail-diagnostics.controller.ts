import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Query,
  UnauthorizedException,
} from '@nestjs/common';

type JsonObject = Record<string, any>;

type GraphqlResponse = {
  httpStatus: number;
  ok: boolean;
  errors: unknown[];
  data: JsonObject | null;
};

@Controller('internal-diagnostics')
export class ShopifyOrderDetailDiagnosticsController {
  @Get('shopify-order-detail')
  async diagnoseOrderDetail(
    @Headers('x-chatpro-inbox-key') accessKey: string | undefined,
    @Query('companySlug') companySlug = '',
    @Query('order') order = '',
  ) {
    this.requireAccess(accessKey);

    const normalizedOrder = order.trim().replace(/^#/, '');
    if (!normalizedOrder) {
      throw new BadRequestException('Falta el pedido.');
    }

    const shop = this.cleanShop(process.env.SHOPIFY_SHOP);
    if (!shop) {
      throw new BadRequestException('Falta SHOPIFY_SHOP.');
    }

    const apiVersion = (process.env.SHOPIFY_API_VERSION || '2026-04').trim();
    const tokenResult = await this.getAccessToken(shop);

    if (!tokenResult.ok || !tokenResult.accessToken) {
      return {
        ok: false,
        companySlug: companySlug.trim().toLowerCase() || null,
        order: normalizedOrder,
        shop,
        apiVersion,
        token: {
          ok: false,
          source: tokenResult.source,
          httpStatus: tokenResult.httpStatus,
          error: tokenResult.error,
        },
      };
    }

    const searchQueries = [
      `name:#${normalizedOrder}`,
      `name:${normalizedOrder}`,
      `#${normalizedOrder}`,
      normalizedOrder,
    ];

    const searchResults: JsonObject[] = [];

    for (const query of searchQueries) {
      const result = await this.searchOrder(shop, apiVersion, tokenResult.accessToken, query);
      searchResults.push(result);

      const first = result.orders?.[0];
      if (first?.id) {
        const orderId = String(first.id);

        const basicDetail = await this.orderBasicDetail(
          shop,
          apiVersion,
          tokenResult.accessToken,
          orderId,
        );

        const fulfillmentDetail = await this.orderFulfillmentDetail(
          shop,
          apiVersion,
          tokenResult.accessToken,
          orderId,
        );

        const fulfillmentOrdersDetail = await this.orderFulfillmentOrdersDetail(
          shop,
          apiVersion,
          tokenResult.accessToken,
          orderId,
        );

        const extraDetail = await this.orderExtraDetail(
          shop,
          apiVersion,
          tokenResult.accessToken,
          orderId,
        );

        return {
          ok: true,
          companySlug: companySlug.trim().toLowerCase() || null,
          order: normalizedOrder,
          shop,
          apiVersion,
          token: {
            ok: true,
            source: tokenResult.source,
            httpStatus: tokenResult.httpStatus,
            hasAccessToken: true,
            expiresIn: tokenResult.expiresIn ?? null,
          },
          foundOrder: first,
          searchResults,
          details: {
            basic: this.summarizeBasicDetail(basicDetail),
            fulfillments: this.summarizeFulfillmentDetail(fulfillmentDetail),
            fulfillmentOrders: this.summarizeFulfillmentOrdersDetail(
              fulfillmentOrdersDetail,
            ),
            extra: this.summarizeExtraDetail(extraDetail),
          },
          rawStatus: {
            basic: this.safeStatus(basicDetail),
            fulfillments: this.safeStatus(fulfillmentDetail),
            fulfillmentOrders: this.safeStatus(fulfillmentOrdersDetail),
            extra: this.safeStatus(extraDetail),
          },
        };
      }
    }

    return {
      ok: false,
      companySlug: companySlug.trim().toLowerCase() || null,
      order: normalizedOrder,
      shop,
      apiVersion,
      token: {
        ok: true,
        source: tokenResult.source,
        httpStatus: tokenResult.httpStatus,
        hasAccessToken: true,
        expiresIn: tokenResult.expiresIn ?? null,
      },
      message: 'No encontré el pedido en Shopify con las búsquedas directas.',
      searchResults,
    };
  }

  private requireAccess(accessKey: string | undefined) {
    const expected = process.env.CHATPRO_INBOX_KEY?.trim();

    if (!expected || accessKey?.trim() !== expected) {
      throw new UnauthorizedException('Acceso no autorizado.');
    }
  }

  private cleanShop(value: string | undefined): string {
    return (value || '')
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/+$/g, '');
  }

  private async getAccessToken(shop: string): Promise<{
    ok: boolean;
    source: string;
    accessToken?: string;
    httpStatus?: number;
    expiresIn?: number;
    error?: string;
  }> {
    const directToken = [
      process.env.SHOPIFY_ACCESS_TOKEN,
      process.env.SHOPIFY_ADMIN_ACCESS_TOKEN,
      process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN,
      process.env.SHOPIFY_API_ACCESS_TOKEN,
    ]
      .map((value) => value?.trim())
      .find((value): value is string => Boolean(value));

    if (directToken) {
      return {
        ok: true,
        source: 'direct_env',
        accessToken: directToken,
        httpStatus: 200,
      };
    }

    const clientId = process.env.SHOPIFY_CLIENT_ID?.trim();
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET?.trim();

    if (!clientId || !clientSecret) {
      return {
        ok: false,
        source: 'missing_credentials',
        error: 'No hay token directo ni credenciales client_credentials.',
      };
    }

    try {
      const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });

      const body = (await response.json().catch(() => ({}))) as JsonObject;
      const accessToken =
        typeof body.access_token === 'string' ? body.access_token.trim() : '';

      return {
        ok: response.ok && Boolean(accessToken),
        source: 'client_credentials',
        accessToken: accessToken || undefined,
        httpStatus: response.status,
        expiresIn:
          typeof body.expires_in === 'number' ? body.expires_in : undefined,
        error:
          response.ok && accessToken
            ? undefined
            : this.safeText(body.error_description || body.error || body),
      };
    } catch (error) {
      return {
        ok: false,
        source: 'client_credentials',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async searchOrder(
    shop: string,
    apiVersion: string,
    accessToken: string,
    query: string,
  ) {
    const graphql = `
      query($query: String!) {
        orders(first: 3, query: $query, sortKey: PROCESSED_AT, reverse: true) {
          edges {
            node {
              id
              name
              createdAt
              displayFinancialStatus
              displayFulfillmentStatus
            }
          }
        }
      }
    `;

    const result = await this.shopifyGraphql(shop, apiVersion, accessToken, graphql, {
      query,
    });

    const edges = result.data?.orders?.edges;
    const orders = Array.isArray(edges)
      ? edges
          .map((edge) => edge?.node)
          .filter(Boolean)
          .map((node) => ({
            id: node.id ?? null,
            name: node.name ?? null,
            createdAt: node.createdAt ?? null,
            displayFinancialStatus: node.displayFinancialStatus ?? null,
            displayFulfillmentStatus: node.displayFulfillmentStatus ?? null,
          }))
      : [];

    return {
      query,
      httpStatus: result.httpStatus,
      ok: result.ok,
      errors: result.errors,
      orders,
    };
  }

  private orderBasicDetail(
    shop: string,
    apiVersion: string,
    accessToken: string,
    orderId: string,
  ) {
    const graphql = `
      query($id: ID!) {
        node(id: $id) {
          ... on Order {
            id
            name
            email
            phone
            customer {
              firstName
              lastName
              displayName
              email
              phone
            }
            shippingAddress {
              name
              firstName
              lastName
              phone
              city
              province
              country
            }
            billingAddress {
              name
              firstName
              lastName
              phone
              city
              province
              country
            }
          }
        }
      }
    `;

    return this.shopifyGraphql(shop, apiVersion, accessToken, graphql, {
      id: orderId,
    });
  }

  private orderFulfillmentDetail(
    shop: string,
    apiVersion: string,
    accessToken: string,
    orderId: string,
  ) {
    const graphql = `
      query($id: ID!) {
        node(id: $id) {
          ... on Order {
            id
            name
            fulfillments(first: 10) {
              id
              status
              displayStatus
              createdAt
              updatedAt
              deliveredAt
              trackingInfo(first: 10) {
                company
                number
                url
              }
            }
          }
        }
      }
    `;

    return this.shopifyGraphql(shop, apiVersion, accessToken, graphql, {
      id: orderId,
    });
  }

  private orderFulfillmentOrdersDetail(
    shop: string,
    apiVersion: string,
    accessToken: string,
    orderId: string,
  ) {
    const graphql = `
      query($id: ID!) {
        node(id: $id) {
          ... on Order {
            id
            name
            fulfillmentOrders(first: 10) {
              edges {
                node {
                  id
                  status
                  requestStatus
                  assignedLocation {
                    name
                  }
                  fulfillments(first: 10) {
                    edges {
                      node {
                        id
                        status
                        displayStatus
                        createdAt
                        updatedAt
                        deliveredAt
                        trackingInfo(first: 10) {
                          company
                          number
                          url
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    return this.shopifyGraphql(shop, apiVersion, accessToken, graphql, {
      id: orderId,
    });
  }

  private orderExtraDetail(
    shop: string,
    apiVersion: string,
    accessToken: string,
    orderId: string,
  ) {
    const graphql = `
      query($id: ID!) {
        node(id: $id) {
          ... on Order {
            id
            name
            tags
            note
            metafields(first: 30) {
              edges {
                node {
                  namespace
                  key
                  type
                  value
                }
              }
            }
          }
        }
      }
    `;

    return this.shopifyGraphql(shop, apiVersion, accessToken, graphql, {
      id: orderId,
    });
  }

  private async shopifyGraphql(
    shop: string,
    apiVersion: string,
    accessToken: string,
    query: string,
    variables: JsonObject,
  ): Promise<GraphqlResponse> {
    try {
      const response = await fetch(
        `https://${shop}/admin/api/${apiVersion}/graphql.json`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-Shopify-Access-Token': accessToken,
          },
          body: JSON.stringify({
            query,
            variables,
          }),
        },
      );

      const body = (await response.json().catch(() => ({}))) as JsonObject;
      const errors = Array.isArray(body.errors) ? body.errors : [];

      return {
        httpStatus: response.status,
        ok: response.ok && errors.length === 0,
        errors,
        data: body.data ?? null,
      };
    } catch (error) {
      return {
        httpStatus: 0,
        ok: false,
        errors: [error instanceof Error ? error.message : String(error)],
        data: null,
      };
    }
  }

  private summarizeBasicDetail(result: GraphqlResponse) {
    const order = result.data?.node;

    if (!order) {
      return {
        ok: result.ok,
        errors: result.errors,
        customerName: null,
        shippingName: null,
        billingName: null,
        orderEmailPresent: false,
        orderPhonePresent: false,
        customerEmailPresent: false,
        customerPhonePresent: false,
        shippingPhonePresent: false,
      };
    }

    return {
      ok: result.ok,
      errors: result.errors,
      name: order.name ?? null,
      customerName:
        order.customer?.displayName ||
        [order.customer?.firstName, order.customer?.lastName]
          .filter(Boolean)
          .join(' ') ||
        null,
      shippingName:
        order.shippingAddress?.name ||
        [order.shippingAddress?.firstName, order.shippingAddress?.lastName]
          .filter(Boolean)
          .join(' ') ||
        null,
      billingName:
        order.billingAddress?.name ||
        [order.billingAddress?.firstName, order.billingAddress?.lastName]
          .filter(Boolean)
          .join(' ') ||
        null,
      shippingCity: order.shippingAddress?.city ?? null,
      shippingProvince: order.shippingAddress?.province ?? null,
      billingCity: order.billingAddress?.city ?? null,
      orderEmailPresent: Boolean(order.email),
      orderPhonePresent: Boolean(order.phone),
      customerEmailPresent: Boolean(order.customer?.email),
      customerPhonePresent: Boolean(order.customer?.phone),
      shippingPhonePresent: Boolean(order.shippingAddress?.phone),
    };
  }

  private summarizeFulfillmentDetail(result: GraphqlResponse) {
    const fulfillments = result.data?.node?.fulfillments;

    if (!Array.isArray(fulfillments)) {
      return {
        ok: result.ok,
        errors: result.errors,
        count: 0,
        trackingCount: 0,
        tracking: [],
      };
    }

    const tracking = fulfillments.flatMap((fulfillment) =>
      Array.isArray(fulfillment.trackingInfo)
        ? fulfillment.trackingInfo.map((item) => ({
            company: item.company ?? null,
            number: item.number ?? null,
            url: item.url ?? null,
          }))
        : [],
    );

    return {
      ok: result.ok,
      errors: result.errors,
      count: fulfillments.length,
      statuses: fulfillments.map((fulfillment) => ({
        status: fulfillment.status ?? null,
        displayStatus: fulfillment.displayStatus ?? null,
        createdAt: fulfillment.createdAt ?? null,
        deliveredAt: fulfillment.deliveredAt ?? null,
      })),
      trackingCount: tracking.length,
      tracking,
    };
  }

  private summarizeFulfillmentOrdersDetail(result: GraphqlResponse) {
    const edges = result.data?.node?.fulfillmentOrders?.edges;

    if (!Array.isArray(edges)) {
      return {
        ok: result.ok,
        errors: result.errors,
        count: 0,
        trackingCount: 0,
        tracking: [],
      };
    }

    const orders = edges.map((edge) => edge?.node).filter(Boolean);
    const tracking = orders.flatMap((fulfillmentOrder) => {
      const fulfillmentEdges = fulfillmentOrder.fulfillments?.edges;
      if (!Array.isArray(fulfillmentEdges)) {
        return [];
      }

      return fulfillmentEdges
        .map((edge) => edge?.node)
        .filter(Boolean)
        .flatMap((fulfillment) =>
          Array.isArray(fulfillment.trackingInfo)
            ? fulfillment.trackingInfo.map((item) => ({
                company: item.company ?? null,
                number: item.number ?? null,
                url: item.url ?? null,
              }))
            : [],
        );
    });

    return {
      ok: result.ok,
      errors: result.errors,
      count: orders.length,
      statuses: orders.map((fulfillmentOrder) => ({
        status: fulfillmentOrder.status ?? null,
        requestStatus: fulfillmentOrder.requestStatus ?? null,
        assignedLocation: fulfillmentOrder.assignedLocation?.name ?? null,
      })),
      trackingCount: tracking.length,
      tracking,
    };
  }

  private summarizeExtraDetail(result: GraphqlResponse) {
    const order = result.data?.node;
    const edges = order?.metafields?.edges;

    return {
      ok: result.ok,
      errors: result.errors,
      tags: Array.isArray(order?.tags) ? order.tags : [],
      notePresent: Boolean(order?.note),
      metafieldCount: Array.isArray(edges) ? edges.length : 0,
      metafields: Array.isArray(edges)
        ? edges.map((edge) => {
            const node = edge?.node ?? {};
            return {
              namespace: node.namespace ?? null,
              key: node.key ?? null,
              type: node.type ?? null,
              valuePreview:
                typeof node.value === 'string'
                  ? node.value.slice(0, 120)
                  : null,
            };
          })
        : [],
    };
  }

  private safeStatus(result: GraphqlResponse) {
    return {
      httpStatus: result.httpStatus,
      ok: result.ok,
      errors: result.errors,
      hasData: Boolean(result.data),
    };
  }

  private safeText(value: unknown): string {
    if (typeof value === 'string') {
      return value.slice(0, 300);
    }

    try {
      return JSON.stringify(value).slice(0, 300);
    } catch {
      return String(value).slice(0, 300);
    }
  }
}
