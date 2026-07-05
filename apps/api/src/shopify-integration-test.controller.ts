import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { IntegrationCredentialsService } from './integration-credentials.service';
import { SupabaseService } from './supabase.service';

type TestBody = { company?: unknown };

type IntegrationRow = {
  external_id: string;
  config: unknown;
  credentials_encrypted: string | null;
  credential_mode: 'environment' | 'encrypted';
};

type GraphqlResponse = {
  data?: {
    shop?: { name?: string | null; myshopifyDomain?: string | null };
    productsCount?: { count?: number | null; precision?: string | null };
  };
  errors?: Array<{ message?: string }>;
};

@Controller('integrations/shopify')
export class ShopifyIntegrationTestController {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly credentialsService: IntegrationCredentialsService,
  ) {}

  @Post('test')
  async test(
    @Headers('x-chatpro-inbox-key') accessKey: string | undefined,
    @Body() body: TestBody,
  ) {
    this.requireAccess(accessKey);

    const slug =
      typeof body.company === 'string' ? body.company.trim().toLowerCase() : '';

    if (!slug) {
      throw new BadRequestException('Falta la empresa.');
    }

    const { data: company, error: companyError } = await this.supabaseService
      .getClient()
      .from('companies')
      .select('id')
      .eq('slug', slug)
      .eq('status', 'active')
      .maybeSingle();

    if (companyError || !company) {
      throw new BadRequestException(
        companyError?.message || 'Empresa activa no encontrada.',
      );
    }

    const { data, error } = await this.supabaseService
      .getClient()
      .from('company_integrations')
      .select('external_id, config, credentials_encrypted, credential_mode')
      .eq('company_id', company.id)
      .eq('provider', 'shopify')
      .eq('integration_type', 'store')
      .eq('status', 'active')
      .maybeSingle();

    if (error || !data) {
      throw new BadRequestException(
        error?.message || 'No hay una tienda Shopify activa para esta empresa.',
      );
    }

    const integration = data as IntegrationRow;

    if (
      integration.credential_mode !== 'encrypted' ||
      !integration.credentials_encrypted
    ) {
      throw new BadRequestException(
        'Esta conexión todavía no usa credenciales protegidas por empresa.',
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
      throw new BadRequestException(
        'La conexión Shopify no contiene un token válido.',
      );
    }

    const config = this.toRecord(integration.config);
    const version = this.text(config.api_version) || '2026-04';
    const shop = this.normalizeShop(integration.external_id);

    const response = await fetch(
      `https://${shop}/admin/api/${encodeURIComponent(version)}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({
          query: `query ChatProConnectionTest {
            shop { name myshopifyDomain }
            productsCount { count precision }
          }`,
        }),
      },
    );

    if (!response.ok) {
      throw new BadRequestException(
        `Shopify rechazó la prueba de conexión (${response.status}).`,
      );
    }

    const payload = (await response.json()) as GraphqlResponse;

    if (payload.errors?.length) {
      throw new BadRequestException(
        payload.errors
          .map((item) => item.message || 'Error desconocido de Shopify.')
          .join(' '),
      );
    }

    return {
      ok: true,
      testedAt: new Date().toISOString(),
      shop: {
        name: this.text(payload.data?.shop?.name) || 'Tienda Shopify',
        domain: this.text(payload.data?.shop?.myshopifyDomain) || shop,
      },
      products: {
        count:
          typeof payload.data?.productsCount?.count === 'number'
            ? payload.data.productsCount.count
            : 0,
        precision: this.text(payload.data?.productsCount?.precision) || null,
      },
    };
  }

  private requireAccess(value: string | undefined) {
    const expected = process.env.CHATPRO_INBOX_KEY?.trim();
    if (!expected || value?.trim() !== expected) {
      throw new UnauthorizedException('No autorizado.');
    }
  }

  private normalizeShop(value: string): string {
    const shop = value
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '')
      .toLowerCase();

    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
      throw new BadRequestException('La tienda Shopify guardada no es válida.');
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
