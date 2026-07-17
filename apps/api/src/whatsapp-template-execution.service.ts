import { Injectable } from '@nestjs/common';
import { SupabaseService } from './supabase.service';
import { WhatsappMessagingService } from './whatsapp-messaging.service';
import type { WhatsappSendResult } from './whatsapp-messaging.service';

type JsonObject = Record<string, unknown>;

type TemplateBindingRow = {
  id: string;
  template_id: string | null;
  enabled: boolean;
  variable_mapping: unknown;
  button_actions: unknown;
  config: unknown;
};

type TemplateRow = {
  name: string;
  language: string;
  status: string;
  components: unknown;
};

@Injectable()
export class WhatsappTemplateExecutionService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly whatsappMessagingService: WhatsappMessagingService,
  ) {}

  async hasEnabledBinding(
    companyId: string,
    eventKey: string,
  ): Promise<boolean> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('company_template_bindings')
      .select('id')
      .eq('company_id', companyId)
      .eq('event_key', eventKey)
      .eq('enabled', true)
      .not('template_id', 'is', null)
      .maybeSingle();

    if (error) {
      throw new Error(
        `No se pudo validar la plantilla asignada: ${error.message}`,
      );
    }

    return Boolean(data?.id);
  }

  async sendAssignedTemplate(input: {
    companyId: string;
    eventKey: string;
    to: string;
    context: JsonObject;
  }): Promise<WhatsappSendResult | null> {
    const binding = await this.getBinding(
      input.companyId,
      input.eventKey,
    );

    if (!binding?.enabled || !binding.template_id) {
      return null;
    }

    const template = await this.getTemplate(
      input.companyId,
      binding.template_id,
    );

    if (!template) {
      throw new Error(
        `La asignación ${input.eventKey} no tiene una plantilla disponible.`,
      );
    }

    if (template.status.toUpperCase() !== 'APPROVED') {
      throw new Error(
        `La plantilla asignada a ${input.eventKey} ya no está aprobada por Meta.`,
      );
    }

    const components = this.buildComponents({
      templateComponents: Array.isArray(template.components)
        ? template.components
        : [],
      variableMapping: this.object(binding.variable_mapping),
      context: input.context,
    });

    return this.whatsappMessagingService.sendTemplateComponents(
      input.companyId,
      input.to,
      template.name,
      template.language || 'es_CO',
      components,
    );
  }

  private async getBinding(
    companyId: string,
    eventKey: string,
  ): Promise<TemplateBindingRow | null> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('company_template_bindings')
      .select(
        'id,template_id,enabled,variable_mapping,button_actions,config',
      )
      .eq('company_id', companyId)
      .eq('event_key', eventKey)
      .maybeSingle();

    if (error) {
      throw new Error(
        `No se pudo consultar la asignación ${eventKey}: ${error.message}`,
      );
    }

    return data ? (data as TemplateBindingRow) : null;
  }

  private async getTemplate(
    companyId: string,
    templateId: string,
  ): Promise<TemplateRow | null> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('company_whatsapp_templates')
      .select('name,language,status,components')
      .eq('company_id', companyId)
      .eq('id', templateId)
      .maybeSingle();

    if (error) {
      throw new Error(
        `No se pudo consultar la plantilla aprobada: ${error.message}`,
      );
    }

    return data ? (data as TemplateRow) : null;
  }

  private buildComponents(input: {
    templateComponents: unknown[];
    variableMapping: JsonObject;
    context: JsonObject;
  }): JsonObject[] {
    const output: JsonObject[] = [];

    for (const rawComponent of input.templateComponents) {
      const component = this.object(rawComponent);
      const type = this.text(component.type).toUpperCase();

      if (type === 'BODY' || type === 'HEADER') {
        const text = this.text(component.text);
        const placeholders = this.placeholders(text);

        if (placeholders.length) {
          output.push({
            type: type.toLowerCase(),
            parameters: placeholders.map((placeholder) =>
              this.textParameter({
                placeholder,
                mappingKey: placeholder,
                variableMapping: input.variableMapping,
                context: input.context,
              }),
            ),
          });
        }
      }

      if (type === 'BUTTONS') {
        const buttons = Array.isArray(component.buttons)
          ? component.buttons
          : [];

        buttons.forEach((rawButton, buttonIndex) => {
          const button = this.object(rawButton);
          const buttonType = this.text(button.type).toUpperCase();

          if (buttonType !== 'URL') {
            return;
          }

          const url = this.text(button.url);
          const placeholders = this.placeholders(url);

          if (!placeholders.length) {
            return;
          }

          if (placeholders.length > 1) {
            throw new Error(
              `El botón ${buttonIndex + 1} tiene más de una variable dinámica.`,
            );
          }

          const placeholder = placeholders[0];
          const mappingKey = `button.${placeholder}`;
          const sourcePath = this.text(
            input.variableMapping[mappingKey],
          );

          if (!sourcePath) {
            throw new Error(
              `Falta mapear la variable {{${mappingKey}}}.`,
            );
          }

          const resolved = this.contextValue(
            input.context,
            sourcePath,
          );
          const value = this.normalizeUrlButtonParameter(
            url,
            placeholder,
            resolved,
          );

          output.push({
            type: 'button',
            sub_type: 'url',
            index: String(buttonIndex),
            parameters: [
              {
                type: 'text',
                text: value,
              },
            ],
          });
        });
      }
    }

    return output;
  }

  private textParameter(input: {
    placeholder: string;
    mappingKey: string;
    variableMapping: JsonObject;
    context: JsonObject;
  }): JsonObject {
    const sourcePath = this.text(
      input.variableMapping[input.mappingKey],
    );

    if (!sourcePath) {
      throw new Error(
        `Falta mapear la variable {{${input.mappingKey}}}.`,
      );
    }

    const parameter: JsonObject = {
      type: 'text',
      text: this.contextValue(input.context, sourcePath),
    };

    if (!/^\d+$/.test(input.placeholder)) {
      parameter.parameter_name = input.placeholder;
    }

    return parameter;
  }

  private placeholders(value: string): string[] {
    const found: string[] = [];
    const seen = new Set<string>();

    for (const match of value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
      const key = match[1]?.trim();

      if (key && !seen.has(key)) {
        seen.add(key);
        found.push(key);
      }
    }

    return found;
  }

  private contextValue(
    context: JsonObject,
    sourcePath: string,
  ): string {
    let current: unknown = context;

    for (const segment of sourcePath.split('.')) {
      const object = this.object(current);

      if (!(segment in object)) {
        current = undefined;
        break;
      }

      current = object[segment];
    }

    const value = this.scalarText(current);

    if (!value) {
      throw new Error(
        `El dato ${sourcePath} está vacío para esta plantilla.`,
      );
    }

    return value.slice(0, 1000);
  }

  private normalizeUrlButtonParameter(
    templateUrl: string,
    placeholder: string,
    value: string,
  ): string {
    const expression = new RegExp(
      `\\{\\{\\s*${this.escapeRegExp(placeholder)}\\s*\\}\\}`,
    );
    const match = expression.exec(templateUrl);

    if (!match || match.index === undefined) {
      return value;
    }

    const prefix = templateUrl.slice(0, match.index);
    const suffix = templateUrl.slice(
      match.index + match[0].length,
    );

    if (
      value.startsWith(prefix) &&
      (!suffix || value.endsWith(suffix))
    ) {
      return value.slice(
        prefix.length,
        suffix ? value.length - suffix.length : undefined,
      );
    }

    try {
      const prefixUrl = new URL(prefix);
      const valueUrl = new URL(value);

      if (prefixUrl.origin !== valueUrl.origin) {
        return value;
      }

      const prefixPath = prefixUrl.pathname;

      if (valueUrl.pathname.startsWith(prefixPath)) {
        const remainingPath = valueUrl.pathname
          .slice(prefixPath.length)
          .replace(/^\/+/, '');

        return `${remainingPath}${valueUrl.search}${valueUrl.hash}`;
      }

      return `${valueUrl.pathname.replace(/^\/+/, '')}${
        valueUrl.search
      }${valueUrl.hash}`;
    } catch {
      return value;
    }
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private scalarText(value: unknown): string {
    if (typeof value === 'string') {
      return value.trim();
    }

    if (
      typeof value === 'number' &&
      Number.isFinite(value)
    ) {
      return String(value);
    }

    if (typeof value === 'boolean') {
      return value ? 'Sí' : 'No';
    }

    if (Array.isArray(value)) {
      return value
        .map((item) => this.scalarText(item))
        .filter(Boolean)
        .join(', ');
    }

    return '';
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
