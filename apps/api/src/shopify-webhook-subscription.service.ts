import { BadRequestException, Injectable } from '@nestjs/common';

type GraphqlResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

type WebhookNode = {
  id: string;
  topic: string;
  uri: string;
};

const REQUIRED_TOPICS = [
  'ORDERS_CREATE',
  'ORDERS_CANCELLED',
  'FULFILLMENTS_CREATE',
  'FULFILLMENTS_UPDATE',
] as const;

@Injectable()
export class ShopifyWebhookSubscriptionService {
  async ensureSubscriptions(input: {
    shop: string;
    accessToken: string;
    apiVersion: string;
    endpoint: string;
  }): Promise<{
    endpoint: string;
    topics: string[];
    created: string[];
    existing: string[];
  }> {
    const endpoint = this.endpoint(input.endpoint);
    const existing = await this.listSubscriptions(input, endpoint);
    const existingTopics = new Set(existing.map((item) => item.topic));
    const created: string[] = [];

    for (const topic of REQUIRED_TOPICS) {
      if (existingTopics.has(topic)) {
        continue;
      }

      await this.createSubscription(input, topic, endpoint);
      created.push(topic);
    }

    return {
      endpoint,
      topics: [...REQUIRED_TOPICS],
      created,
      existing: existing.map((item) => item.topic),
    };
  }

  private async listSubscriptions(
    input: {
      shop: string;
      accessToken: string;
      apiVersion: string;
    },
    endpoint: string,
  ): Promise<WebhookNode[]> {
    const data = await this.graphql<{
      webhookSubscriptions: {
        nodes: WebhookNode[];
      };
    }>(
      input,
      `
        query ChatProWebhookSubscriptions(
          $topics: [WebhookSubscriptionTopic!]
          $uri: String
        ) {
          webhookSubscriptions(
            first: 100
            topics: $topics
            uri: $uri
          ) {
            nodes {
              id
              topic
              uri
            }
          }
        }
      `,
      {
        topics: [...REQUIRED_TOPICS],
        uri: endpoint,
      },
    );

    return data.webhookSubscriptions.nodes ?? [];
  }

  private async createSubscription(
    input: {
      shop: string;
      accessToken: string;
      apiVersion: string;
    },
    topic: (typeof REQUIRED_TOPICS)[number],
    endpoint: string,
  ): Promise<void> {
    const data = await this.graphql<{
      webhookSubscriptionCreate: {
        webhookSubscription: WebhookNode | null;
        userErrors: Array<{
          field?: string[] | null;
          message: string;
        }>;
      };
    }>(
      input,
      `
        mutation ChatProWebhookSubscriptionCreate(
          $topic: WebhookSubscriptionTopic!
          $webhookSubscription: WebhookSubscriptionInput!
        ) {
          webhookSubscriptionCreate(
            topic: $topic
            webhookSubscription: $webhookSubscription
          ) {
            webhookSubscription {
              id
              topic
              uri
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        topic,
        webhookSubscription: {
          uri: endpoint,
        },
      },
    );

    const result = data.webhookSubscriptionCreate;

    if (result.userErrors.length || !result.webhookSubscription) {
      throw new BadRequestException(
        result.userErrors.map((item) => item.message).join(' ') ||
          `Shopify no pudo crear el evento ${topic}.`,
      );
    }
  }

  private async graphql<T>(
    input: {
      shop: string;
      accessToken: string;
      apiVersion: string;
    },
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(
      `https://${input.shop}/admin/api/${encodeURIComponent(
        input.apiVersion,
      )}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Shopify-Access-Token': input.accessToken,
        },
        body: JSON.stringify({ query, variables }),
      },
    );

    const raw = await response.text();

    if (!response.ok) {
      throw new BadRequestException(
        `Shopify rechazó la configuración de eventos (${response.status}): ${raw.slice(
          0,
          500,
        )}`,
      );
    }

    let parsed: GraphqlResponse<T>;

    try {
      parsed = JSON.parse(raw) as GraphqlResponse<T>;
    } catch {
      throw new BadRequestException(
        'Shopify devolvió una respuesta inválida al configurar eventos.',
      );
    }

    if (parsed.errors?.length) {
      throw new BadRequestException(
        parsed.errors
          .map((item) => item.message || 'Error desconocido de Shopify.')
          .join(' '),
      );
    }

    if (!parsed.data) {
      throw new BadRequestException(
        'Shopify no devolvió el resultado de los eventos.',
      );
    }

    return parsed.data;
  }

  private endpoint(value: string): string {
    try {
      const url = new URL(value);

      if (url.protocol !== 'https:') {
        throw new Error('protocol');
      }

      return url.toString().replace(/\/$/, '');
    } catch {
      throw new BadRequestException(
        'La URL pública del webhook de Shopify debe usar HTTPS.',
      );
    }
  }
}
