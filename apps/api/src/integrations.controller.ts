import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { IntegrationCredentialsService } from './integration-credentials.service';
import { SupabaseService } from './supabase.service';
import { WhatsappMessagingService } from './whatsapp-messaging.service';

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

type WhatsappConfigureBody = {
  phoneNumberId?: unknown;
  accessToken?: unknown;
  apiVersion?: unknown;
  displayName?: unknown;
  businessAccountId?: unknown;
};

type WhatsappTestBody = {
  to?: unknown;
  message?: unknown;
};

const CATALOG = [
  {
    provider: 'meta',
    integrationType: 'whatsapp',
    key: 'whatsapp',
    name: 'WhatsApp Business',
    description: 'Recibe conversaciones de WhatsApp y permite responder desde la Bandeja con asesor humano o agente IA cuando el plan lo permita.',
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
    description: 'Mensajes directos de Instagram dentro de la Bandeja cuando el canal esté habilitado.',
    connectionReady: false,
  },
  {
    provider: 'meta',
    integrationType: 'messenger',
    key: 'messenger',
    name: 'Messenger',
    description: 'Mensajes de Facebook Messenger dentro de la Bandeja cuando el canal esté habilitado.',
    connectionReady: false,
  },
  {
    provider: 'meta',
    integrationType: 'ads',
    key: 'meta-ads',
    name: 'Meta Ads',
    description: 'Publicidad, campañas, inversión y ROAS para reportes, alertas y análisis por empresa.',
    connectionReady: false,
  },
] as const;

@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly credentialsService: IntegrationCredentialsService,
    private readonly whatsappMessagingService: WhatsappMessagingService,
  ) {}

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

  @Post('whatsapp/configure')
  async configureWhatsapp(
    @Headers('x-chatpro-inbox-key') accessKey: string | undefined,
    @Query('company') companySlug: string | undefined,
    @Body() body: WhatsappConfigureBody,
  ) {
    this.requireAccess(accessKey);
    const company = await this.getCompany(companySlug);
    const phoneNumberId = this.digits(body.phoneNumberId);
    const accessToken = this.text(body.accessToken);
    const apiVersion = this.apiVersion(body.apiVersion);
    const displayName = this.text(body.displayName);
    const businessAccountId = this.digits(body.businessAccountId);

    if (!phoneNumberId || phoneNumberId.length < 6) {
      throw new BadRequestException('Escribe un Phone Number ID válido.');
    }

    if (!accessToken || accessToken.length < 20) {
      throw new BadRequestException('Escribe un access token válido de Meta.');
    }

    const client = this.supabaseService.getClient();

    const { data: existing, error: existingError } = await client
      .from('company_integrations')
      .select('id, company_id')
      .eq('provider', 'meta')
      .eq('integration_type', 'whatsapp')
      .eq('external_id', phoneNumberId)
      .maybeSingle();

    if (existingError) {
      throw new BadRequestException(
        `No se pudo validar el canal de WhatsApp: ${existingError.message}`,
      );
    }

    if (existing && existing.company_id !== company.id) {
      throw new BadRequestException(
        'Este Phone Number ID ya está conectado a otra empresa en Chat Pro.',
      );
    }

    const now = new Date().toISOString();

    const { error: saveError } = await client
      .from('company_integrations')
      .upsert(
        {
          company_id: company.id,
          provider: 'meta',
          integration_type: 'whatsapp',
          external_id: phoneNumberId,
          status: 'active',
          config: {
            api_version: apiVersion,
            display_name: displayName || null,
            business_account_id: businessAccountId || null,
            setup_source: 'manual_meta_whatsapp',
          },
          credential_mode: 'encrypted',
          credential_reference: {
            token_format: 'meta_whatsapp_access_token',
            phone_number_id: phoneNumberId,
          },
          credentials_encrypted: this.credentialsService.encrypt({
            access_token: accessToken,
          }),
          updated_at: now,
        },
        { onConflict: 'provider,integration_type,external_id' },
      );

    if (saveError) {
      throw new BadRequestException(
        `No se pudo guardar WhatsApp: ${saveError.message}`,
      );
    }

    const { error: disconnectError } = await client
      .from('company_integrations')
      .update({ status: 'disconnected', updated_at: now })
      .eq('company_id', company.id)
      .eq('provider', 'meta')
      .eq('integration_type', 'whatsapp')
      .neq('external_id', phoneNumberId)
      .eq('status', 'active');

    if (disconnectError) {
      throw new BadRequestException(
        `WhatsApp quedó guardado, pero no se pudo cerrar la conexión anterior: ${disconnectError.message}`,
      );
    }

    return {
      ok: true,
      message: 'WhatsApp Business quedó conectado para esta empresa.',
      company,
      whatsapp: {
        phoneNumberId,
        apiVersion,
        displayName: displayName || null,
      },
    };
  }

  @Post('whatsapp/test')
  async testWhatsapp(
    @Headers('x-chatpro-inbox-key') accessKey: string | undefined,
    @Query('company') companySlug: string | undefined,
    @Body() body: WhatsappTestBody,
  ) {
    this.requireAccess(accessKey);
    const company = await this.getCompany(companySlug);
    const recipient = this.digits(body.to);
    const message =
      this.text(body.message) ||
      `Mensaje de prueba de Chat Pro para ${company.name}. Tu canal de WhatsApp está conectado.`;

    if (!recipient || recipient.length < 8 || recipient.length > 15) {
      throw new BadRequestException(
        'Escribe el teléfono de prueba con indicativo de país.',
      );
    }

    await this.whatsappMessagingService.sendText(
      company.id,
      recipient,
      message.slice(0, 1000),
    );

    return {
      ok: true,
      message: 'Mensaje de prueba enviado por WhatsApp.',
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
      phoneNumberId:
        row.provider === 'meta' && row.integration_type === 'whatsapp'
          ? row.external_id
          : null,
      businessAccountId: this.text(config.business_account_id) || null,
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

  private digits(value: unknown): string {
    return this.text(value).replace(/\D/g, '');
  }

  private apiVersion(value: unknown): string {
    const clean = this.text(value) || 'v25.0';

    if (!/^v\d+\.\d+$/.test(clean)) {
      throw new BadRequestException('La versión de Meta debe tener formato v25.0.');
    }

    return clean;
  }
}
