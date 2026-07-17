import { Injectable } from '@nestjs/common';
import { CompanyIntegrationService } from './company-integration.service';
import { IntegrationCredentialsService } from './integration-credentials.service';
import { SupabaseService } from './supabase.service';

type JsonObject = Record<string, unknown>;

export const TEMPLATE_EVENT_DEFINITIONS = [
  {
    key: 'abandoned_cart_step_1',
    label: 'Carrito abandonado · mensaje 1',
    description: 'Primer contacto de recuperación del carrito.',
    variables: [
      'customer.first_name',
      'customer.full_name',
      'checkout.items_summary',
      'checkout.total',
      'checkout.recovery_url',
    ],
  },
  {
    key: 'abandoned_cart_step_2',
    label: 'Carrito abandonado · mensaje 2',
    description: 'Segundo contacto de recuperación del carrito.',
    variables: [
      'customer.first_name',
      'customer.full_name',
      'checkout.items_summary',
      'checkout.total',
      'checkout.recovery_url',
      'promotion.code',
      'promotion.duration',
    ],
  },
  {
    key: 'abandoned_cart_step_3',
    label: 'Carrito abandonado · mensaje 3',
    description: 'Último contacto de recuperación del carrito.',
    variables: [
      'customer.first_name',
      'customer.full_name',
      'checkout.items_summary',
      'checkout.total',
      'checkout.recovery_url',
      'promotion.code',
      'promotion.duration',
    ],
  },
  {
    key: 'order_created',
    label: 'Pedido creado',
    description: 'Confirmación inicial de un pedido.',
    variables: [
      'customer.first_name',
      'customer.full_name',
      'order.number',
      'order.items_summary',
      'order.total',
      'order.payment_method',
      'order.status_url',
    ],
  },
  {
    key: 'fulfillment_created',
    label: 'Pedido despachado',
    description: 'Transportadora, guía y seguimiento del envío.',
    variables: [
      'customer.first_name',
      'customer.full_name',
      'order.number',
      'fulfillment.carrier',
      'fulfillment.tracking_number',
      'fulfillment.tracking_url',
    ],
  },
  {
    key: 'cod_order_created',
    label: 'Pedido contraentrega',
    description: 'Confirmación de un pedido con pago al recibir.',
    variables: [
      'customer.first_name',
      'customer.full_name',
      'order.number',
      'order.total',
      'order.payment_method',
    ],
  },
  {
    key: 'order_cancelled',
    label: 'Pedido cancelado',
    description: 'Aviso de cancelación y opciones posteriores.',
    variables: [
      'customer.first_name',
      'customer.full_name',
      'order.number',
      'storefront.url',
    ],
  },
  {
    key: 'payment_pending',
    label: 'Pago pendiente',
    description: 'Recordatorio para completar el pago.',
    variables: [
      'customer.first_name',
      'customer.full_name',
      'order.number',
      'order.total',
      'order.payment_method',
      'order.payment_url',
    ],
  },
  {
    key: 'interest_product',
    label: 'Interés en producto',
    description: 'Contacto comercial iniciado por un asesor.',
    variables: [
      'customer.first_name',
      'customer.full_name',
      'product.name',
      'product.url',
    ],
  },
  {
    key: 'post_purchase_bonus',
    label: 'Beneficio posterior a la compra',
    description: 'Beneficio comercial configurable por empresa.',
    variables: [
      'customer.first_name',
      'customer.full_name',
      'promotion.code',
      'promotion.amount',
      'promotion.duration',
      'storefront.url',
    ],
  },
] as const;

export const TEMPLATE_BUTTON_ACTIONS = [
  {
    key: 'none',
    label: 'Sin acción automática',
  },
  {
    key: 'tracking_information',
    label: 'Enviar información de seguimiento',
  },
  {
    key: 'confirm_cod_order',
    label: 'Confirmar pedido contraentrega',
  },
  {
    key: 'payment_assistance',
    label: 'Ayudar a completar el pago',
  },
  {
    key: 'request_human_agent',
    label: 'Solicitar un asesor',
  },
  {
    key: 'accept_order_updates',
    label: 'Aceptar actualizaciones del pedido',
  },
  {
    key: 'open_commercial_conversation',
    label: 'Abrir conversación comercial',
  },
  {
    key: 'stop_commercial_followup',
    label: 'Detener seguimiento comercial',
  },
] as const;

@Injectable()
export class WhatsappTemplateService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly companyIntegrationService: CompanyIntegrationService,
    private readonly credentialsService: IntegrationCredentialsService,
  ) {}

  async dashboard(companyId: string) {
    const client = this.supabaseService.getClient();
    const [templatesResult, bindingsResult] = await Promise.all([
      client
        .from('company_whatsapp_templates')
        .select(
          'id,meta_template_id,name,language,category,status,components,quality_score,synced_at,updated_at',
        )
        .eq('company_id', companyId)
        .order('name', { ascending: true }),
      client
        .from('company_template_bindings')
        .select(
          'id,event_key,template_id,enabled,variable_mapping,button_actions,config,updated_at',
        )
        .eq('company_id', companyId)
        .order('event_key', { ascending: true }),
    ]);

    if (templatesResult.error) {
      throw new Error(
        `No se pudieron consultar las plantillas: ${templatesResult.error.message}`,
      );
    }

    if (bindingsResult.error) {
      throw new Error(
        `No se pudieron consultar las asignaciones: ${bindingsResult.error.message}`,
      );
    }

    return {
      templates: (templatesResult.data ?? []).map((row: any) =>
        this.mapTemplate(row),
      ),
      bindings: (bindingsResult.data ?? []).map((row: any) => ({
        id: String(row.id),
        eventKey: String(row.event_key),
        templateId:
          typeof row.template_id === 'string' ? row.template_id : null,
        enabled: row.enabled === true,
        variableMapping: this.object(row.variable_mapping),
        buttonActions: this.object(row.button_actions),
        config: this.object(row.config),
        updatedAt:
          typeof row.updated_at === 'string' ? row.updated_at : null,
      })),
      eventDefinitions: TEMPLATE_EVENT_DEFINITIONS,
      buttonActionDefinitions: TEMPLATE_BUTTON_ACTIONS,
    };
  }

  async sync(companyId: string) {
    const connection = await this.resolveManagementConnection(companyId);
    const templates = await this.fetchAllTemplates(connection);
    const now = new Date().toISOString();
    const rows = templates
      .map((template) => this.normalizeMetaTemplate(template))
      .filter((template) => template.name && template.language)
      .map((template) => ({
        company_id: companyId,
        integration_id: connection.integrationId,
        meta_template_id: template.id || null,
        name: template.name,
        language: template.language,
        category: template.category,
        status: template.status,
        components: template.components,
        quality_score: template.qualityScore,
        synced_at: now,
        updated_at: now,
      }));

    if (rows.length) {
      const { error } = await this.supabaseService
        .getClient()
        .from('company_whatsapp_templates')
        .upsert(rows, {
          onConflict: 'company_id,name,language',
        });

      if (error) {
        throw new Error(
          `No se pudieron guardar las plantillas sincronizadas: ${error.message}`,
        );
      }
    }

    return {
      synced: rows.length,
      approved: rows.filter((row) => row.status === 'APPROVED').length,
      pending: rows.filter((row) =>
        ['PENDING', 'IN_APPEAL'].includes(row.status),
      ).length,
      rejected: rows.filter((row) =>
        ['REJECTED', 'DISABLED', 'PAUSED'].includes(row.status),
      ).length,
      businessAccountId: connection.businessAccountId,
      syncedAt: now,
    };
  }

  async saveBinding(
    companyId: string,
    eventKey: string,
    body: JsonObject,
  ) {
    const definition = TEMPLATE_EVENT_DEFINITIONS.find(
      (item) => item.key === eventKey,
    );

    if (!definition) {
      throw new Error('El evento de plantilla no es válido.');
    }

    const templateId = this.text(body.templateId);
    const enabled = body.enabled === true;
    const variableMapping = this.cleanRecord(
      body.variableMapping,
      80,
      180,
    );
    const buttonActions = this.cleanRecord(
      body.buttonActions,
      80,
      120,
    );
    const config = this.cleanRecord(body.config, 80, 500);

    if (enabled && !templateId) {
      throw new Error(
        'Selecciona una plantilla antes de activar esta asignación.',
      );
    }

    if (templateId) {
      const { data: template, error } = await this.supabaseService
        .getClient()
        .from('company_whatsapp_templates')
        .select('id,status')
        .eq('company_id', companyId)
        .eq('id', templateId)
        .maybeSingle();

      if (error) {
        throw new Error(
          `No se pudo validar la plantilla: ${error.message}`,
        );
      }

      if (!template) {
        throw new Error(
          'La plantilla seleccionada no pertenece a esta empresa.',
        );
      }

      if (enabled && template.status !== 'APPROVED') {
        throw new Error(
          'Solo se pueden activar plantillas aprobadas por Meta.',
        );
      }
    }

    const now = new Date().toISOString();
    const { data, error } = await this.supabaseService
      .getClient()
      .from('company_template_bindings')
      .upsert(
        {
          company_id: companyId,
          event_key: eventKey,
          template_id: templateId || null,
          enabled,
          variable_mapping: variableMapping,
          button_actions: buttonActions,
          config,
          updated_at: now,
        },
        {
          onConflict: 'company_id,event_key',
        },
      )
      .select(
        'id,event_key,template_id,enabled,variable_mapping,button_actions,config,updated_at',
      )
      .single();

    if (error) {
      throw new Error(
        `No se pudo guardar la asignación: ${error.message}`,
      );
    }

    return {
      id: String(data.id),
      eventKey: String(data.event_key),
      templateId:
        typeof data.template_id === 'string' ? data.template_id : null,
      enabled: data.enabled === true,
      variableMapping: this.object(data.variable_mapping),
      buttonActions: this.object(data.button_actions),
      config: this.object(data.config),
      updatedAt:
        typeof data.updated_at === 'string' ? data.updated_at : null,
    };
  }

  private async resolveManagementConnection(companyId: string) {
    const integration =
      await this.companyIntegrationService.getActiveIntegration(
        companyId,
        'meta',
        'whatsapp',
      );

    if (!integration) {
      throw new Error(
        'Esta empresa no tiene una integración activa de WhatsApp.',
      );
    }

    const config = integration.config;
    const businessAccountId =
      this.text(config.business_account_id) ||
      this.text(config.businessAccountId) ||
      this.text(config.whatsapp_business_account_id) ||
      this.text(config.waba_id);

    if (!businessAccountId) {
      throw new Error(
        'Falta el ID de la cuenta de WhatsApp Business en la integración de esta empresa.',
      );
    }

    let accessToken = '';

    if (integration.credentialMode === 'environment') {
      const tokenEnv = this.text(
        integration.credentialReference.access_token_env,
      );

      if (!tokenEnv) {
        throw new Error(
          'La integración no tiene configurada la referencia segura del token.',
        );
      }

      accessToken = process.env[tokenEnv]?.trim() ?? '';
    } else if (
      integration.credentialMode === 'encrypted' &&
      integration.credentialsEncrypted
    ) {
      const credentials = this.credentialsService.decrypt(
        integration.credentialsEncrypted,
      );
      accessToken = this.text(credentials.access_token);
    }

    if (!accessToken) {
      throw new Error(
        'No se encontró un token válido para sincronizar las plantillas.',
      );
    }

    return {
      integrationId: integration.id,
      businessAccountId,
      accessToken,
      apiVersion: this.text(config.api_version) || 'v25.0',
    };
  }

  private async fetchAllTemplates(connection: {
    businessAccountId: string;
    accessToken: string;
    apiVersion: string;
  }): Promise<JsonObject[]> {
    const templates: JsonObject[] = [];
    let nextUrl =
      `https://graph.facebook.com/${connection.apiVersion}/` +
      `${encodeURIComponent(connection.businessAccountId)}/message_templates` +
      '?fields=id,name,status,category,language,components,quality_score&limit=250';

    for (let page = 0; page < 20 && nextUrl; page += 1) {
      const response = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${connection.accessToken}`,
        },
        signal: AbortSignal.timeout(20000),
        cache: 'no-store',
      });
      const raw = await response.text();
      let payload: JsonObject = {};

      try {
        payload = raw ? (JSON.parse(raw) as JsonObject) : {};
      } catch {
        payload = {};
      }

      if (!response.ok) {
        const error = this.object(payload.error);
        const detail =
          this.text(error.message) ||
          `Meta rechazó la sincronización (${response.status}).`;

        throw new Error(detail);
      }

      const data = Array.isArray(payload.data) ? payload.data : [];

      for (const item of data) {
        const template = this.object(item);

        if (Object.keys(template).length) {
          templates.push(template);
        }
      }

      const paging = this.object(payload.paging);
      nextUrl = this.text(paging.next);
    }

    return templates;
  }

  private normalizeMetaTemplate(value: JsonObject) {
    const qualityScore = this.object(value.quality_score);

    return {
      id: this.text(value.id),
      name: this.text(value.name),
      language: this.text(value.language),
      category: this.text(value.category).toUpperCase(),
      status: this.text(value.status).toUpperCase(),
      components: Array.isArray(value.components)
        ? value.components
        : [],
      qualityScore,
    };
  }

  private mapTemplate(row: any) {
    return {
      id: String(row.id),
      metaTemplateId:
        typeof row.meta_template_id === 'string'
          ? row.meta_template_id
          : null,
      name: String(row.name),
      language: String(row.language),
      category: String(row.category ?? ''),
      status: String(row.status ?? ''),
      components: Array.isArray(row.components)
        ? row.components
        : [],
      qualityScore: this.object(row.quality_score),
      syncedAt:
        typeof row.synced_at === 'string' ? row.synced_at : null,
      updatedAt:
        typeof row.updated_at === 'string' ? row.updated_at : null,
    };
  }

  private cleanRecord(
    value: unknown,
    maxKey: number,
    maxValue: number,
  ): JsonObject {
    const source = this.object(value);
    const clean: JsonObject = {};

    for (const [rawKey, rawValue] of Object.entries(source)) {
      const key = rawKey.trim().slice(0, maxKey);
      const text = this.text(rawValue).slice(0, maxValue);

      if (key && text) {
        clean[key] = text;
      }
    }

    return clean;
  }

  private object(value: unknown): JsonObject {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as JsonObject)
      : {};
  }

  private text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }
}
