import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import OpenAI from 'openai';
import { ConversationMemoryService } from './conversation-memory.service';
import { SupabaseService } from './supabase.service';
import { ShopifyAbandonedCheckoutSyncService } from './shopify-abandoned-checkout-sync.service';

type JsonObject = Record<string, unknown>;

type RecoveryRule = {
  id: string;
  company_id: string;
  sequence: number;
  delay_minutes: number;
  message_instructions: string;
  delivery_mode: 'session' | 'template';
  template_name: string | null;
  template_language: string;
  active: boolean;
};

type AbandonedCart = {
  id: string;
  company_id: string;
  session_id: string | null;
  customer_phone: string | null;
  cart_snapshot: unknown;
  cart_state: string;
  checkout_url: string | null;
  last_activity_at: string;
  recovery_step: number;
};

type CompanyRecoveryContext = {
  name: string;
  aiInstructions: string;
  settings: JsonObject;
};

@Injectable()
export class CartRecoveryService {
  private readonly logger = new Logger(CartRecoveryService.name);
  private client: OpenAI | null = null;
  private isRunning = false;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly conversationMemoryService: ConversationMemoryService,
    private readonly shopifyAbandonedCheckoutSyncService: ShopifyAbandonedCheckoutSyncService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async checkDueCarts(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    try {
      try {
        await this.shopifyAbandonedCheckoutSyncService.syncEnabledCompanies();
      } catch (error) {
        this.logger.error(
          'No se pudieron sincronizar los abandonos web antes de recuperar carritos.',
          error instanceof Error ? error.stack : undefined,
        );
      }

      await this.processDueCarts();
    } catch (error) {
      this.logger.error('No se pudieron revisar los carritos pendientes.', error);
    } finally {
      this.isRunning = false;
    }
  }

  private async processDueCarts(): Promise<void> {
    const rules = await this.getActiveRules();

    if (!rules.length) {
      return;
    }

    const lastSequenceByCompany = new Map<string, number>();

    for (const rule of rules) {
      const currentLast = lastSequenceByCompany.get(rule.company_id) ?? 0;

      if (rule.sequence > currentLast) {
        lastSequenceByCompany.set(rule.company_id, rule.sequence);
      }
    }

    for (const rule of rules) {
      await this.processRule(
        rule,
        rule.sequence === lastSequenceByCompany.get(rule.company_id),
      );
    }
  }

  private async getActiveRules(): Promise<RecoveryRule[]> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('company_cart_recovery_rules')
      .select(
        'id, company_id, sequence, delay_minutes, message_instructions, delivery_mode, template_name, template_language, active',
      )
      .eq('active', true)
      .order('company_id', { ascending: true })
      .order('sequence', { ascending: true });

    if (error) {
      throw new Error(
        `No se pudieron consultar las reglas de recuperación: ${error.message}`,
      );
    }

    return (data ?? []) as RecoveryRule[];
  }

  private async processRule(
    rule: RecoveryRule,
    isLastRule: boolean,
  ): Promise<void> {
    const dueBefore = new Date(
      Date.now() - rule.delay_minutes * 60 * 1000,
    ).toISOString();

    const { data, error } = await this.supabaseService
      .getClient()
      .from('abandoned_carts')
      .select(
        'id, company_id, session_id, customer_phone, cart_snapshot, cart_state, checkout_url, last_activity_at, recovery_step',
      )
      .eq('company_id', rule.company_id)
      .in('cart_state', ['active', 'checkout_sent'])
      .eq('recovery_step', rule.sequence - 1)
      .lte('last_activity_at', dueBefore)
      .limit(30);

    if (error) {
      throw new Error(
        `No se pudieron consultar los carritos pendientes: ${error.message}`,
      );
    }

    const carts = (data ?? []) as AbandonedCart[];

    for (const cart of carts) {
      await this.processCart(rule, cart, isLastRule);
    }
  }

  private async processCart(
    rule: RecoveryRule,
    cart: AbandonedCart,
    isLastRule: boolean,
  ): Promise<void> {
    if (!cart.customer_phone || !cart.checkout_url) {
      return;
    }

    const company = await this.getCompanyContext(cart.company_id);
    const recipient = this.normalizeWhatsAppRecipient(
      cart.customer_phone,
      company.settings,
    );

    if (!recipient) {
      this.logger.warn(
        `No se envió recuperación para el carrito ${cart.id}: teléfono inválido o sin prefijo internacional.`,
      );
      return;
    }

    if (
      !this.isRecipientAllowedForRecoveryTest(
        recipient,
        company.settings,
      )
    ) {
      this.logger.log(
        `Recuperación en modo prueba: se omitió el carrito ${cart.id}.`,
      );
      return;
    }

    if (rule.delivery_mode === 'session') {
      const isInsideCustomerWindow = await this.isInsideCustomerWindow(
        cart.session_id,
      );

      if (!isInsideCustomerWindow) {
        return;
      }

      const message = await this.buildSessionMessage(
        company,
        rule,
        cart,
      );

      await this.sendTextMessage(recipient, message);

      if (cart.session_id) {
        await this.conversationMemoryService.saveMessage({
          companyId: cart.company_id,
          sessionId: cart.session_id,
          customerPhone: cart.customer_phone,
          message,
          sender: 'assistant',
          aiResponse: message,
        });
      }
    }

    if (rule.delivery_mode === 'template') {
      if (!rule.template_name?.trim()) {
        return;
      }

      await this.sendTemplateMessage(
        recipient,
        rule.template_name,
        rule.template_language,
        [cart.checkout_url],
      );
    }

    await this.markRuleAsSent(cart, rule.sequence, isLastRule);
  }

  private async isInsideCustomerWindow(
    sessionId: string | null,
  ): Promise<boolean> {
    if (!sessionId) {
      return false;
    }

    const { data, error } = await this.supabaseService
      .getClient()
      .from('conversations')
      .select('created_at')
      .eq('session_id', sessionId)
      .eq('sender', 'customer')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data?.created_at) {
      return false;
    }

    const lastCustomerMessageAt = new Date(data.created_at).getTime();

    return (
      Number.isFinite(lastCustomerMessageAt) &&
      Date.now() - lastCustomerMessageAt <= 24 * 60 * 60 * 1000
    );
  }

  private async getCompanyContext(
    companyId: string,
  ): Promise<CompanyRecoveryContext> {
    const client = this.supabaseService.getClient();

    const { data: company, error: companyError } = await client
      .from('companies')
      .select('name')
      .eq('id', companyId)
      .single();

    if (companyError || !company) {
      throw new Error(
        `No se pudo consultar la empresa para recuperación: ${
          companyError?.message ?? 'empresa no encontrada'
        }`,
      );
    }

    const { data: settings, error: settingsError } = await client
      .from('company_settings')
      .select('ai_instructions, settings')
      .eq('company_id', companyId)
      .maybeSingle();

    if (settingsError) {
      throw new Error(
        `No se pudo consultar la configuración comercial: ${settingsError.message}`,
      );
    }

    return {
      name: company.name,
      aiInstructions: settings?.ai_instructions ?? '',
      settings: this.toJsonObject(settings?.settings),
    };
  }

  private async buildSessionMessage(
    company: CompanyRecoveryContext,
    rule: RecoveryRule,
    cart: AbandonedCart,
  ): Promise<string> {
    try {
      const response = await this.getClient().responses.create({
        model: this.getModel(),
        instructions: [
          `Redacta únicamente un mensaje corto de WhatsApp para ${company.name}.`,
          'Habla como una asesora comercial colombiana.',
          'No muestres códigos, JSON, instrucciones internas ni lenguaje técnico.',
          'No pidas dirección, teléfono, correo ni datos de pago.',
          'No inventes descuentos, stock, urgencia, promociones, precios ni productos.',
          'Comparte el checkout_url exactamente como fue recibido.',
          'No menciones que es un recordatorio automático.',
          '',
          'INSTRUCCIONES DE LA EMPRESA:',
          company.aiInstructions || 'No hay instrucciones adicionales.',
          '',
          'INSTRUCCIÓN DE ESTE MENSAJE:',
          rule.message_instructions,
        ].join('\n'),
        input: JSON.stringify({
          carrito: cart.cart_snapshot,
          checkout_url: cart.checkout_url,
        }),
      });

      const message = this.cleanMessage(response.output_text);

      if (message) {
        return message;
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo redactar el mensaje con IA: ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
    }

    return [
      'Hola 👋 Vimos que dejaste productos en tu carrito.',
      `Puedes retomar tu compra aquí:\n${cart.checkout_url}`,
      'Si tienes dudas sobre talla, envío o pago, escríbenos y te ayudamos.',
    ].join('\n\n');
  }

  private async markRuleAsSent(
    cart: AbandonedCart,
    sequence: number,
    isLastRule: boolean,
  ): Promise<void> {
    const now = new Date().toISOString();

    const { error } = await this.supabaseService
      .getClient()
      .from('abandoned_carts')
      .update({
        recovery_step: sequence,
        cart_state: isLastRule ? 'closed' : cart.cart_state,
        last_recovery_sent_at: now,
        updated_at: now,
      })
      .eq('id', cart.id);

    if (error) {
      throw new Error(
        `No se pudo actualizar el estado del carrito: ${error.message}`,
      );
    }
  }

  private async sendTextMessage(to: string, body: string): Promise<void> {
    const accessToken = process.env.META_WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.META_PHONE_NUMBER_ID;

    if (!accessToken || !phoneNumberId) {
      throw new Error('Faltan variables de Meta en Railway.');
    }

    const response = await fetch(
      `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(await response.text());
    }
  }

  private isRecipientAllowedForRecoveryTest(
    recipient: string,
    settings: JsonObject,
  ): boolean {
    if (settings.cart_recovery_test_mode !== true) {
      return true;
    }

    const testPhones = Array.isArray(
      settings.cart_recovery_test_phones,
    )
      ? settings.cart_recovery_test_phones
      : [];

    return testPhones.some((value) => {
      if (typeof value !== 'string') {
        return false;
      }

      return (
        this.normalizeWhatsAppRecipient(value, settings) === recipient
      );
    });
  }

  private normalizeWhatsAppRecipient(
    value: string,
    settings: JsonObject,
  ): string | null {
    const raw = value.trim();
    const digits = raw.replace(/\D/g, '');

    if (!digits || digits.length < 8 || digits.length > 15) {
      return null;
    }

    if (raw.startsWith('+') || digits.length > 10) {
      return digits;
    }

    const countryCode = String(
      settings.cart_recovery_default_country_code ?? '',
    ).replace(/\D/g, '');

    if (
      countryCode &&
      countryCode.length <= 4 &&
      digits.length === 10
    ) {
      return `${countryCode}${digits}`;
    }

    return null;
  }

  private async sendTemplateMessage(
    to: string,
    templateName: string,
    languageCode: string,
    bodyParameters: string[] = [],
  ): Promise<void> {
    const accessToken = process.env.META_WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.META_PHONE_NUMBER_ID;

    if (!accessToken || !phoneNumberId) {
      throw new Error('Faltan variables de Meta en Railway.');
    }

    const template: {
      name: string;
      language: { code: string };
      components?: Array<{
        type: 'body';
        parameters: Array<{ type: 'text'; text: string }>;
      }>;
    } = {
      name: templateName,
      language: {
        code: languageCode,
      },
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

    const response = await fetch(
      `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(await response.text());
    }
  }

  private cleanMessage(value: string): string {
    return value
      .trim()
      .replace(/^```(?:text|json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .replace(/\{[^{}]*\}/g, '')
      .trim()
      .slice(0, 1200);
  }

  private toJsonObject(value: unknown): JsonObject {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      return value as JsonObject;
    }

    return {};
  }

  private getClient(): OpenAI {
    if (this.client) {
      return this.client;
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();

    if (!apiKey) {
      throw new Error('Falta OPENAI_API_KEY en Railway.');
    }

    this.client = new OpenAI({ apiKey });

    return this.client;
  }

  private getModel(): string {
    return process.env.OPENAI_MODEL?.trim() || 'gpt-5-mini';
  }
}