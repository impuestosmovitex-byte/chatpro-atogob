import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from './supabase.service';

type IntegrationRow = {
  id: string;
  provider: string;
  integration_type: string;
  external_id: string;
  status: 'pending' | 'active' | 'disconnected' | 'error';
  config: unknown;
  credential_mode: 'environment' | 'encrypted';
  created_at: string | null;
  updated_at: string | null;
};

type JsonObject = Record<string, unknown>;

const CATALOG = [
  {
    provider: 'meta',
    integrationType: 'whatsapp',
    key: 'whatsapp',
    name: 'WhatsApp Business',
    description: 'Recibe conversaciones y permite responder desde Sofía y la Bandeja.',
    connectionReady: true,
  },
  {
    provider: 'shopify',
    integrationType: 'store',
    key: 'shopify',
    name: 'Shopify',
    description: 'Catálogo, productos, variantes y enlaces de compra de tu tienda.',
    connectionReady: true,
  },
  {
    provider: 'meta',
    integrationType: 'instagram',
    key: 'instagram',
    name: 'Instagram',
    description: 'Mensajes directos de Instagram dentro de la Bandeja.',
    connectionReady: false,
  },
  {
    provider: 'meta',
    integrationType: 'messenger',
    key: 'messenger',
    name: 'Messenger',
    description: 'Mensajes de Facebook Messenger dentro de la Bandeja.',
    connectionReady: false,
  },
] as const;

@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly supabaseService: SupabaseService) {}

  @Get()
  async list(
    @Headers('x-chatpro-inbox-key') accessKey: string | undefined,
    @Query('company') companySlug: string | undefined,
  ) {
    this.requireAccess(accessKey);
    const company = await this.getCompany(companySlug);

    const { data, error } = await this.supabaseService
      .getClient()
      .from('company_integrations')
      .select(
        'id, provider, integration_type, external_id, status, config, credential_mode, created_at, updated_at',
      )
      .eq('company_id', company.id)
      .order('created_at', { ascending: true });

    if (error) {
      throw new BadRequestException(
        `No se pudieron cargar las integraciones: ${error.message}`,
      );
    }

    const rows = (data ?? []) as IntegrationRow[];
    const known = CATALOG.map((item) => {
      const row = rows.find(
        (candidate) =>
          candidate.provider === item.provider &&
          candidate.integration_type === item.integrationType,
      );

      return row
        ? this.toIntegration(item, row)
        : {
            key: item.key,
            provider: item.provider,
            integrationType: item.integrationType,
            name: item.name,
            description: item.description,
            status: 'disconnected',
            statusLabel: 'No conectada',
            connectionReady: item.connectionReady,
            credentialMode: null,
            details: {},
            connectedAt: null,
            updatedAt: null,
          };
    });

    const extra = rows
      .filter(
        (row) =>
          !CATALOG.some(
            (item) =>
              item.provider === row.provider &&
              item.integrationType === row.integration_type,
          ),
      )
      .map((row) =>
        this.toIntegration(
          {
            key: `${row.provider}-${row.integration_type}`,
            provider: row.provider,
            integrationType: row.integration_type,
            name: `${row.provider} · ${row.integration_type}`,
            description: 'Integración configurada para esta empresa.',
            connectionReady: false,
          },
          row,
        ),
      );

    return {
      ok: true,
      company,
      integrations: [...known, ...extra],
    };
  }

  private requireAccess(accessKey: string | undefined) {
    const expected = process.env.CHATPRO_INBOX_KEY?.trim();

    if (!expected || accessKey?.trim() !== expected) {
      throw new UnauthorizedException('Acceso no autorizado.');
    }
  }

  private async getCompany(companySlug: string | undefined) {
    const slug = companySlug?.trim().toLowerCase();

    if (!slug) {
      throw new BadRequestException('Falta la empresa.');
    }

    const { data, error } = await this.supabaseService
      .getClient()
      .from('companies')
      .select('id, slug, name')
      .eq('slug', slug)
      .eq('status', 'active')
      .maybeSingle();

    if (error || !data) {
      throw new BadRequestException(
        error?.message || 'No existe una empresa activa con ese identificador.',
      );
    }

    return data as { id: string; slug: string; name: string };
  }

  private toIntegration(
    item: {
      key: string;
      provider: string;
      integrationType: string;
      name: string;
      description: string;
      connectionReady: boolean;
    },
    row: IntegrationRow,
  ) {
    const config = this.toRecord(row.config);

    return {
      id: row.id,
      key: item.key,
      provider: row.provider,
      integrationType: row.integration_type,
      name: item.name,
      description: item.description,
      status: row.status,
      statusLabel: this.statusLabel(row.status),
      connectionReady: item.connectionReady,
      credentialMode: row.credential_mode,
      details: this.safeDetails(row, config),
      connectedAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private safeDetails(row: IntegrationRow, config: JsonObject) {
    const apiVersion = this.text(config.api_version);
    const displayName =
      this.text(config.display_name) ||
      this.text(config.verified_name) ||
      this.text(config.shop_name);
    const storeUrl = this.text(config.store_url);

    return {
      displayName: displayName || null,
      storeUrl: storeUrl || null,
      apiVersion: apiVersion || null,
      setupSource:
        row.credential_mode === 'environment'
          ? 'Configuración técnica existente'
          : 'Credenciales protegidas',
    };
  }

  private statusLabel(
    status: 'pending' | 'active' | 'disconnected' | 'error',
  ) {
    const labels = {
      active: 'Activa',
      pending: 'Pendiente',
      disconnected: 'No conectada',
      error: 'Requiere revisión',
    };

    return labels[status];
  }

  private toRecord(value: unknown): JsonObject {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as JsonObject;
    }

    return {};
  }

  private text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }
}
