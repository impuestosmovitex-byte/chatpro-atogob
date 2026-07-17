import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import OpenAI from 'openai';
import { AutomationRuntimeService } from './automation-runtime.service';
import { ConversationMemoryService } from './conversation-memory.service';
import { SupabaseService } from './supabase.service';
import { ShopifyAbandonedCheckoutSyncService } from './shopify-abandoned-checkout-sync.service';
import { WhatsappMessagingService } from './whatsapp-messaging.service';

type JsonObject = Record<string, unknown>;

type RecoveryRule = {
  id: string;
  company_id: string;
  sequence: number;
  delay_minutes: number;
  message_instructions: string;
  message_body: string | null;
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
    private readonly whatsappMessagingService: WhatsappMessagingService,
    private readonly automationRuntimeService: AutomationRuntimeService,
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
        'id, company_id, sequence, delay_minutes, message_instructions, message_body, delivery_mode, template_name, template_language, active',
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
    const automation =
      await this.automationRuntimeService.getDefinition(
        rule.company_id,
        'abandoned_cart',
      );

    if (!automation.enabled) {
      return;
    }

    const dueBefore = new Date(
      Date.now() - rule.delay_minutes * 60 * 1000,
    ).toISOString();

    const company = await this.getCompanyContext(rule.company_id);
    let cartsQuery = this.supabaseService
      .getClient()
      .from('abandoned_carts')
      .select(
        'id, company_id, session_id, customer_phone, cart_snapshot, cart_state, checkout_url, last_activity_at, recovery_step',
      )
      .eq('company_id', rule.company_id)
      .in('cart_state', ['active', 'checkout_sent'])
      .eq('recovery_step', rule.sequence - 1)
      .lte('last_activity_at', dueBefore);

    if (this.isCartRecoveryTestMode(company.settings)) {
      const candidates = new Set<string>();

      for (const value of this.getCartRecoveryTestPhones(
        company.settings,
      )) {
        const originalDigits = value.replace(/\D/g, '');
        const normalized = this.normalizeWhatsAppRecipient(
          value,
          company.settings,
        );
        const normalizedDigits = normalized?.replace(/\D/g, '') ?? '';

        if (originalDigits) {
          candidates.add(originalDigits);

          if (originalDigits.length >= 10) {
            candidates.add(originalDigits.slice(-10));
          }
        }

        if (normalizedDigits) {
          candidates.add(normalizedDigits);
          candidates.add(`+${normalizedDigits}`);

          if (normalizedDigits.length >= 10) {
            candidates.add(normalizedDigits.slice(-10));
          }
        }
      }

      if (!candidates.size) {
        this.logger.warn(
          `Recuperación en modo prueba sin teléfonos autorizados para la empresa ${rule.company_id}.`,
        );
        return;
      }

      cartsQuery = cartsQuery.in(
        'customer_phone',
        Array.from(candidates),
      );
    }

    const { data, error } = await cartsQuery
      .order('last_activity_at', { ascending: false })
      .limit(30);

    if (error) {
      throw new Error(
        `No se pudieron consultar los carritos pendientes: ${error.message}`,
      );
    }

    const carts = (data ?? []) as AbandonedCart[];

    for (const cart of carts) {
      try {
        await this.processCart(rule, cart, isLastRule);
      } catch (error) {
        this.logger.error(
          `Falló la recuperación del carrito ${cart.id}.`,
          error instanceof Error ? error.stack : undefined,
        );
      }
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
      const allowedMasks = this.getCartRecoveryTestPhones(
        company.settings,
      )
        .map((value) => this.maskPhone(value))
        .join(', ');

      this.logger.log(
        `Recuperación en modo prueba: se omitió el carrito ${cart.id}. Destino ${this.maskPhone(
          recipient,
        )}; autorizados ${allowedMasks || 'ninguno'}.`,
      );
      return;
    }

    if (
      rule.delivery_mode === 'session' &&
      !(await this.isInsideCustomerWindow(cart.session_id))
    ) {
      return;
    }

    if (
      rule.delivery_mode === 'template' &&
      !rule.template_name?.trim()
    ) {
      return;
    }

    const claim = await this.automationRuntimeService.claim({
      companyId: cart.company_id,
      automationKey: 'abandoned_cart',
      eventKey: `cart:${cart.id}:step:${rule.sequence}`,
      recipient,
      payload: {
        cartId: cart.id,
        recoveryStep: rule.sequence,
        deliveryMode: rule.delivery_mode,
      },
    });

    if (!claim.claimed) {
      if (claim.reason === 'sent') {
        await this.markRuleAsSent(
          cart,
          rule.sequence,
          isLastRule,
        );
      }
      return;
    }

    try {
      if (rule.delivery_mode === 'session') {
        const message = await this.buildSessionMessage(
          company,
          rule,
          cart,
        );

        await this.whatsappMessagingService.sendText(
          cart.company_id,
          recipient,
          message,
        );

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
        await this.whatsappMessagingService.sendTemplate(
          cart.company_id,
          recipient,
          rule.template_name as string,
          rule.template_language,
          [cart.checkout_url],
        );
      }

      await this.automationRuntimeService.markSent(
        claim.executionId as string,
      );
      await this.markRuleAsSent(
        cart,
        rule.sequence,
        isLastRule,
      );
    } catch (error) {
      await this.automationRuntimeService.markFailed(
        claim.executionId as string,
        error,
        claim.attemptCount,
        claim.maxAttempts,
        claim.retryDelayMinutes,
      );
      throw error;
    }
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
    const configuredBody = this.recoveryString(rule.message_body);

    if (configuredBody) {
      return this.renderConfiguredRecoveryMessage(
        configuredBody,
        cart,
      );
    }

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

    return this.renderRecoveryFallbackMessage(
      company.settings,
      cart.checkout_url ?? '',
    );
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

  private isRecipientAllowedForRecoveryTest(
    recipient: string,
    settings: JsonObject,
  ): boolean {
    if (!this.isCartRecoveryTestMode(settings)) {
      return true;
    }

    const recipientDigits = recipient.replace(/\D/g, '');
    const recipientNational = recipientDigits.slice(-10);
    const testPhones = this.getCartRecoveryTestPhones(settings);

    return testPhones.some((value) => {
      const normalized =
        this.normalizeWhatsAppRecipient(value, settings);
      const configuredDigits = (normalized ?? value).replace(/\D/g, '');

      if (!configuredDigits) {
        return false;
      }

      if (configuredDigits === recipientDigits) {
        return true;
      }

      return (
        configuredDigits.length >= 10 &&
        recipientDigits.length >= 10 &&
        configuredDigits.slice(-10) === recipientNational
      );
    });
  }

  private maskPhone(value: string): string {
    const digits = value.replace(/\D/g, '');

    if (!digits) {
      return 'sin teléfono';
    }

    return `****${digits.slice(-4)}`;
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

    const countryCode = this.getCartRecoveryDefaultCountryCode(
      settings,
    );

    if (
      countryCode &&
      countryCode.length <= 4 &&
      digits.length === 10
    ) {
      return `${countryCode}${digits}`;
    }

    return null;
  }

  private renderConfiguredRecoveryMessage(
    template: string,
    cart: AbandonedCart,
  ): string {
    const snapshot = this.toJsonObject(cart.cart_snapshot);
    const customer = this.toJsonObject(snapshot.customer);
    const replacements: Record<string, string> = {
      '{{nombre_cliente}}':
        this.recoveryString(customer.name),
      '{{resumen_carrito}}':
        this.recoveryCartSummary(snapshot),
      '{{total_carrito}}':
        this.recoveryMoney(
          snapshot.total_amount,
          snapshot.currency,
        ),
      '{{enlace_checkout}}': cart.checkout_url ?? '',
      '{checkout_url}': cart.checkout_url ?? '',
    };

    let rendered = template;

    for (const [variable, value] of Object.entries(replacements)) {
      rendered = rendered.split(variable).join(value);
    }

    return this.cleanMessage(rendered);
  }

  private recoveryCartSummary(snapshot: JsonObject): string {
    const lines = Array.isArray(snapshot.lines)
      ? snapshot.lines
      : [];

    const rendered = lines
      .slice(0, 20)
      .map((value) => {
        const line = this.toJsonObject(value);
        const title =
          this.recoveryString(line.product_title) ||
          'Producto';
        const variant = this.recoveryString(line.variant_title);
        const quantity = Math.max(
          Math.floor(Number(line.quantity) || 1),
          1,
        );

        return `• ${quantity} x ${title}${
          variant ? ` · ${variant}` : ''
        }`;
      })
      .filter(Boolean);

    return rendered.join('\n') || 'Tu selección está lista.';
  }

  private recoveryMoney(
    amountValue: unknown,
    currencyValue: unknown,
  ): string {
    const amount = Number(amountValue);
    const currency =
      this.recoveryString(currencyValue).toUpperCase() || 'COP';

    if (!Number.isFinite(amount)) {
      return this.recoveryString(amountValue);
    }

    try {
      return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      }).format(amount);
    } catch {
      return `${amount} ${currency}`.trim();
    }
  }

  private recoveryString(value: unknown): string {
    if (typeof value === 'string') {
      return value.trim();
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }

    return '';
  }

  private renderRecoveryFallbackMessage(
    settings: JsonObject,
    checkoutUrl: string,
  ): string {
    const configured = this.recoveryText(
      settings,
      'fallback_message',
      'cart_recovery_fallback_message',
    );
    const template =
      configured ||
      [
        'Hola 👋 Vimos que dejaste productos en tu carrito.',
        'Puedes retomar tu compra aquí:\n{checkout_url}',
        'Si tienes dudas sobre talla, envío o pago, escríbenos y te ayudamos.',
      ].join('\n\n');

    const rendered = template.includes('{checkout_url}')
      ? template.split('{checkout_url}').join(checkoutUrl)
      : `${template.trim()}\n\n${checkoutUrl}`;

    return this.cleanMessage(rendered);
  }

  private isCartRecoveryTestMode(settings: JsonObject): boolean {
    const value = this.recoveryValue(
      settings,
      'test_mode',
      'cart_recovery_test_mode',
    );

    return value === true;
  }

  private getCartRecoveryTestPhones(settings: JsonObject): string[] {
    const value = this.recoveryValue(
      settings,
      'test_phones',
      'cart_recovery_test_phones',
    );

    if (Array.isArray(value)) {
      return value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean);
    }

    if (typeof value === 'string') {
      return value
        .split(/[\n,;]+/)
        .map((item) => item.trim())
        .filter(Boolean);
    }

    return [];
  }

  private getCartRecoveryDefaultCountryCode(settings: JsonObject): string {
    return this.recoveryText(
      settings,
      'default_country_code',
      'cart_recovery_default_country_code',
    ).replace(/\D/g, '');
  }

  private recoveryValue(
    settings: JsonObject,
    key: string,
    legacyKey: string,
  ): unknown {
    const recovery = this.toJsonObject(settings.cart_recovery);

    return recovery[key] ?? settings[legacyKey];
  }

  private recoveryText(
    settings: JsonObject,
    key: string,
    legacyKey: string,
  ): string {
    const value = this.recoveryValue(settings, key, legacyKey);

    if (typeof value === 'string') {
      return value.trim();
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }

    return '';
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
