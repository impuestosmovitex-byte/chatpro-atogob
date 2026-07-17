import { Injectable } from '@nestjs/common';
import { CompanyIntegrationService } from './company-integration.service';
import { IntegrationCredentialsService } from './integration-credentials.service';

type JsonObject = Record<string, unknown>;

export type WhatsappSendResult = {
  messageId: string;
  recipient: string | null;
};

@Injectable()
export class WhatsappMessagingService {
  constructor(
    private readonly companyIntegrationService: CompanyIntegrationService,
    private readonly credentialsService: IntegrationCredentialsService,
  ) {}

  async sendText(
    companyId: string,
    to: string,
    body: string,
  ): Promise<WhatsappSendResult> {
    const channel = await this.resolveChannel(companyId);

    return this.send(channel, {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    });
  }

  async sendTemplate(
    companyId: string,
    to: string,
    templateName: string,
    languageCode: string,
    bodyParameters: string[] = [],
  ): Promise<WhatsappSendResult> {
    const channel = await this.resolveChannel(companyId);
    const template: {
      name: string;
      language: { code: string };
      components?: Array<{
        type: 'body';
        parameters: Array<{ type: 'text'; text: string }>;
      }>;
    } = {
      name: templateName,
      language: { code: languageCode },
    };

    if (bodyParameters.length) {
      template.components = [
        {
          type: 'body',
          parameters: bodyParameters.map((text) => ({
            type: 'text',
            text,
          })),
        },
      ];
    }

    return this.send(channel, {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template,
    });
  }

  private async resolveChannel(companyId: string): Promise<{
    phoneNumberId: string;
    accessToken: string;
    apiVersion: string;
  }> {
    const integration =
      await this.companyIntegrationService.getActiveIntegration(
        companyId,
        'meta',
        'whatsapp',
      );

    if (!integration) {
      throw new Error(
        'Esta empresa no tiene un canal de WhatsApp activo configurado.',
      );
    }

    const phoneNumberId = integration.externalId.trim();

    if (!phoneNumberId) {
      throw new Error(
        'La integración de WhatsApp no tiene Phone Number ID configurado.',
      );
    }

    let accessToken = '';

    if (integration.credentialMode === 'environment') {
      const reference = integration.credentialReference as JsonObject;
      const tokenEnv = this.readText(reference.access_token_env);

      if (!tokenEnv) {
        throw new Error(
          'La integración de WhatsApp no tiene definida la referencia segura del token.',
        );
      }

      accessToken = process.env[tokenEnv]?.trim() ?? '';

      if (!accessToken) {
        throw new Error(
          `Falta la variable segura ${tokenEnv} para el WhatsApp de esta empresa.`,
        );
      }
    } else if (integration.credentialMode === 'encrypted') {
      if (!integration.credentialsEncrypted) {
        throw new Error(
          'La integración de WhatsApp no tiene credenciales cifradas.',
        );
      }

      const credentials = this.credentialsService.decrypt(
        integration.credentialsEncrypted,
      );
      accessToken = this.readText(credentials.access_token);

      if (!accessToken) {
        throw new Error(
          'No se encontró un token válido para el WhatsApp de esta empresa.',
        );
      }
    }

    const config = integration.config as JsonObject;
    const apiVersion = this.readText(config.api_version) || 'v25.0';

    return { phoneNumberId, accessToken, apiVersion };
  }

  private async send(
    channel: {
      phoneNumberId: string;
      accessToken: string;
      apiVersion: string;
    },
    payload: Record<string, unknown>,
  ): Promise<WhatsappSendResult> {
    const response = await fetch(
      `https://graph.facebook.com/${channel.apiVersion}/${channel.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${channel.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
    );

    const rawResponse = await response.text();
    let data: JsonObject = {};

    try {
      data = rawResponse
        ? (JSON.parse(rawResponse) as JsonObject)
        : {};
    } catch {
      data = {};
    }

    if (!response.ok) {
      throw new Error(
        `Meta no aceptó el mensaje: ${rawResponse}`,
      );
    }

    const messages = Array.isArray(data.messages)
      ? data.messages
      : [];
    const contacts = Array.isArray(data.contacts)
      ? data.contacts
      : [];
    const message = this.object(messages[0]);
    const contact = this.object(contacts[0]);
    const messageId = this.readText(message.id);

    if (!messageId) {
      throw new Error(
        'Meta aceptó la solicitud, pero no devolvió el identificador del mensaje.',
      );
    }

    return {
      messageId,
      recipient: this.readText(contact.wa_id) || null,
    };
  }

  private object(value: unknown): JsonObject {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as JsonObject)
      : {};
  }

  private readText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }
}
