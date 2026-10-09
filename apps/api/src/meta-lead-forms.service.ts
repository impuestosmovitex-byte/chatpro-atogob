import { Injectable } from '@nestjs/common';
import { CompanyIntegrationService } from './company-integration.service';
import { ConversationMemoryService } from './conversation-memory.service';
import { IntegrationCredentialsService } from './integration-credentials.service';
import { SupabaseService } from './supabase.service';

type JsonObject = Record<string, unknown>;

type LeadFields = {
  values: Record<string, string[]>;
  flattened: Record<string, string>;
};

const TARGET_COMPANY_SLUG = 'emprende-con-maogo';
const META_ADS_TAG = 'META-ADS';
const META_FORM_TAG = 'META-LEAD-FORM';
const LEAD_NEW_TAG = 'LEAD-NUEVO';

@Injectable()
export class MetaLeadFormsService {
  private targetCompanyId: string | null = null;

  constructor(
    private readonly companyIntegrationService: CompanyIntegrationService,
    private readonly credentialsService: IntegrationCredentialsService,
    private readonly conversationMemoryService: ConversationMemoryService,
    private readonly supabaseService: SupabaseService,
  ) {}

  async processWebhook(bodyInput: unknown): Promise<void> {
    const body = this.record(bodyInput);

    if (body.object !== 'page' || !Array.isArray(body.entry)) {
      return;
    }

    for (const rawEntry of body.entry) {
      const entry = this.record(rawEntry);
      const entryPageId = this.digits(entry.id);

      if (!Array.isArray(entry.changes)) {
        continue;
      }

      for (const rawChange of entry.changes) {
        const change = this.record(rawChange);

        if (this.text(change.field) !== 'leadgen') {
          continue;
        }

        const value = this.record(change.value);
        const pageId = this.digits(value.page_id) || entryPageId;
        const leadgenId =
          this.digits(value.leadgen_id) || this.digits(value.lead_id);

        if (!pageId || !leadgenId) {
          console.warn(
            '[ChatPro][MetaLeadForms] evento leadgen sin page_id o leadgen_id.',
          );
          continue;
        }

        try {
          await this.captureLead({
            pageId,
            leadgenId,
            formId: this.digits(value.form_id),
            adId: this.digits(value.ad_id),
            adGroupId: this.digits(value.adgroup_id),
          });
        } catch (error) {
          console.error(
            `[ChatPro][MetaLeadForms] No se pudo procesar lead ${leadgenId}:`,
            error,
          );
        }
      }
    }
  }

  private async captureLead(input: {
    pageId: string;
    leadgenId: string;
    formId: string;
    adId: string;
    adGroupId: string;
  }): Promise<void> {
    const integration =
      await this.companyIntegrationService.findActiveIntegrationByExternalId(
        'meta',
        'messenger',
        input.pageId,
      );

    if (!integration) {
      console.warn(
        `[ChatPro][MetaLeadForms] Página no conectada pageId=${input.pageId}`,
      );
      return;
    }

    if (!(await this.isTargetCompany(integration.companyId))) {
      return;
    }

    if (!integration.credentialsEncrypted) {
      throw new Error('La Página no tiene credenciales activas para recuperar leads.');
    }

    const credentials = this.credentialsService.decrypt(
      integration.credentialsEncrypted,
    );
    const accessToken = this.text(credentials.access_token);

    if (!accessToken) {
      throw new Error('La Página no tiene un token de acceso disponible.');
    }

    const apiVersion =
      typeof integration.config.api_version === 'string' &&
      /^v\d+\.\d+$/.test(integration.config.api_version.trim())
        ? integration.config.api_version.trim()
        : 'v25.0';

    const lead = await this.fetchLead(
      input.leadgenId,
      accessToken,
      apiVersion,
    );
    const fields = this.parseFieldData(lead.field_data);

    const fullName =
      this.pickField(fields, ['full_name', 'nombre_completo', 'nombre']) ||
      [
        this.pickField(fields, ['first_name', 'nombre']),
        this.pickField(fields, ['last_name', 'apellido']),
      ]
        .filter(Boolean)
        .join(' ')
        .trim() ||
      'Lead de Meta';

    const email = this.pickField(fields, [
      'email',
      'correo',
      'correo_electronico',
    ]);
    const rawPhone = this.pickField(fields, [
      'phone_number',
      'phone',
      'telefono',
      'teléfono',
      'whatsapp',
      'numero_de_whatsapp',
    ]);
    const phone = this.normalizePhone(rawPhone);

    if (!phone) {
      console.warn(
        `[ChatPro][MetaLeadForms] Lead ${input.leadgenId} no trae un teléfono utilizable; no puede vincularse con WhatsApp.`,
      );
      return;
    }

    const client = this.supabaseService.getClient();
    const { data: existingContact, error: existingError } = await client
      .from('contacts')
      .select('id, tags, notes, display_name')
      .eq('company_id', integration.companyId)
      .eq('phone', phone)
      .maybeSingle();

    if (existingError) {
      throw new Error(
        `No se pudo consultar el lead existente: ${existingError.message}`,
      );
    }

    const existingLeadId = this.noteValue(
      typeof existingContact?.notes === 'string' ? existingContact.notes : '',
      'ID lead Meta',
    );

    if (existingLeadId === input.leadgenId) {
      return;
    }

    const existingTags = Array.isArray(existingContact?.tags)
      ? existingContact.tags.filter(
          (item: unknown): item is string => typeof item === 'string',
        )
      : [];

    const tags = Array.from(
      new Set([...existingTags, META_ADS_TAG, META_FORM_TAG, LEAD_NEW_TAG]),
    ).slice(0, 20);

    const createdAt =
      this.text(lead.created_time) || new Date().toISOString();
    const formId =
      this.digits(lead.form_id) || input.formId;
    const adId =
      this.digits(lead.ad_id) || input.adId;

    let notes =
      typeof existingContact?.notes === 'string'
        ? existingContact.notes.trim()
        : '';

    if (!notes.toUpperCase().includes('LEAD META ADS')) {
      notes = `${notes}${notes ? '\n' : ''}LEAD META ADS`;
    }

    notes = this.setNoteValue(notes, 'Fuente', 'Meta Ads');
    notes = this.setNoteValue(notes, 'Origen', 'Formulario instantáneo Meta');
    notes = this.setNoteValue(notes, 'Canal', 'WhatsApp');
    notes = this.setNoteValue(notes, 'Estado lead', 'Lead nuevo');
    notes = this.setNoteValue(notes, 'ID lead Meta', input.leadgenId);
    notes = this.setNoteValue(notes, 'Fecha lead Meta', createdAt);

    if (email) {
      notes = this.setNoteValue(notes, 'Correo', email);
    }

    if (formId) {
      notes = this.setNoteValue(notes, 'ID formulario Meta', formId);
    }

    if (adId) {
      notes = this.setNoteValue(notes, 'ID anuncio', adId);
    }

    if (input.adGroupId) {
      notes = this.setNoteValue(notes, 'ID conjunto/anuncio Meta', input.adGroupId);
    }

    for (const [fieldName, fieldValue] of Object.entries(fields.flattened)) {
      if (
        [
          'full_name',
          'first_name',
          'last_name',
          'email',
          'phone_number',
          'phone',
        ].includes(fieldName)
      ) {
        continue;
      }

      notes = this.setNoteValue(
        notes,
        `Formulario Meta · ${fieldName}`.slice(0, 90),
        fieldValue.slice(0, 500),
      );
    }

    const saved = await this.conversationMemoryService.createManualContact(
      TARGET_COMPANY_SLUG,
      {
        phone,
        displayName:
          fullName ||
          (typeof existingContact?.display_name === 'string'
            ? existingContact.display_name
            : 'Lead de Meta'),
        tags,
        notes,
      },
    );

    const { error: channelError } = await client
      .from('contacts')
      .update({
        primary_channel: 'whatsapp',
        last_activity_at: createdAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', saved.contact.id)
      .eq('company_id', integration.companyId);

    if (channelError) {
      throw new Error(
        `El lead se guardó, pero no se pudo marcar como WhatsApp: ${channelError.message}`,
      );
    }

    const currentLeadContext = this.record(saved.session.context.lead_context);

    await this.conversationMemoryService.updateSession(saved.session.id, {
      stage: 'sales',
      context: {
        ...saved.session.context,
        conversation_category: 'sales',
        lead_source: 'meta_lead_form',
        lead_source_updated_at: new Date().toISOString(),
        meta_ad: {
          source: 'Meta Lead Ads',
          lead_id: input.leadgenId,
          form_id: formId || null,
          ad_id: adId || null,
          adgroup_id: input.adGroupId || null,
          captured_at: createdAt,
        },
        lead_context: {
          ...currentLeadContext,
          full_name: fullName,
          email: email || null,
          phone,
          source: 'Meta Ads',
          origin: 'Formulario instantáneo Meta',
          channel: 'whatsapp',
          lead_status: 'Lead nuevo',
          meta_lead_id: input.leadgenId,
          meta_form_id: formId || null,
          ad_id: adId || null,
          form_fields: fields.flattened,
        },
      },
    });

    // El formulario crea el contacto antes de que la persona llegue a WhatsApp.
    // Dejamos la sesión en IA para que el primer mensaje real del cliente sea
    // respondido inmediatamente por el agente de Emprende con Maogo.
    await this.conversationMemoryService.resumeAiConversation(
      saved.session.id,
      'system',
    );

    console.log(
      `[ChatPro][MetaLeadForms] lead guardado company=${integration.companyId} lead=${input.leadgenId} phone=${phone} ad=${adId || 'n/a'}`,
    );
  }

  private async fetchLead(
    leadgenId: string,
    accessToken: string,
    apiVersion: string,
  ): Promise<JsonObject> {
    const url = new URL(
      `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(leadgenId)}`,
    );

    url.searchParams.set('fields', 'id,created_time,ad_id,form_id,field_data');
    url.searchParams.set('access_token', accessToken);

    const response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    const raw = await response.text();
    const payload = this.parseJson(raw);

    if (!response.ok) {
      const metaError = this.record(payload.error);
      const message =
        this.text(metaError.message) ||
        raw.trim().slice(0, 600) ||
        `HTTP ${response.status}`;

      throw new Error(
        `Meta no permitió recuperar el lead ${leadgenId}: ${message}`,
      );
    }

    return payload;
  }

  private parseFieldData(value: unknown): LeadFields {
    const values: Record<string, string[]> = {};
    const flattened: Record<string, string> = {};

    if (!Array.isArray(value)) {
      return { values, flattened };
    }

    for (const rawField of value) {
      const field = this.record(rawField);
      const name = this.text(field.name).toLowerCase();

      if (!name) continue;

      const fieldValues = Array.isArray(field.values)
        ? field.values
            .map((item) => this.text(item))
            .filter(Boolean)
        : [];

      values[name] = fieldValues;
      flattened[name] = fieldValues.join(' | ');
    }

    return { values, flattened };
  }

  private pickField(fields: LeadFields, names: string[]): string {
    for (const name of names) {
      const normalized = name.trim().toLowerCase();
      const value = fields.flattened[normalized];
      if (value) return value.trim();
    }

    return '';
  }

  private normalizePhone(value: unknown): string {
    let digits = this.text(value).replace(/\D/g, '');

    if (digits.startsWith('00')) {
      digits = digits.slice(2);
    }

    if (digits.length === 10 && digits.startsWith('3')) {
      digits = `57${digits}`;
    }

    if (digits.length < 8 || digits.length > 15) {
      return '';
    }

    return digits;
  }

  private async isTargetCompany(companyId: string): Promise<boolean> {
    if (this.targetCompanyId) {
      return companyId === this.targetCompanyId;
    }

    const { data, error } = await this.supabaseService
      .getClient()
      .from('companies')
      .select('id')
      .eq('slug', TARGET_COMPANY_SLUG)
      .eq('status', 'active')
      .maybeSingle();

    if (error) {
      throw new Error(
        `No se pudo validar la empresa de formularios Meta: ${error.message}`,
      );
    }

    this.targetCompanyId = typeof data?.id === 'string' ? data.id : null;

    return Boolean(this.targetCompanyId && companyId === this.targetCompanyId);
  }

  private setNoteValue(notes: string, label: string, value: string): string {
    const lines = notes ? notes.split(/\r?\n/) : [];
    const prefix = `${label.toLowerCase()}:`;
    const index = lines.findIndex((line) =>
      line.trim().toLowerCase().startsWith(prefix),
    );
    const nextLine = `${label}: ${value}`;

    if (index >= 0) {
      lines[index] = nextLine;
    } else {
      lines.push(nextLine);
    }

    return lines.join('\n').trim();
  }

  private noteValue(notes: string, label: string): string {
    const prefix = `${label.toLowerCase()}:`;
    const line = notes
      .split(/\r?\n/)
      .find((item) => item.trim().toLowerCase().startsWith(prefix));

    if (!line) return '';
    return line.slice(line.indexOf(':') + 1).trim();
  }

  private parseJson(value: string): JsonObject {
    try {
      return this.record(JSON.parse(value));
    } catch {
      return {};
    }
  }

  private record(value: unknown): JsonObject {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as JsonObject)
      : {};
  }

  private text(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return '';
  }

  private digits(value: unknown): string {
    return this.text(value).replace(/\D/g, '');
  }
}
