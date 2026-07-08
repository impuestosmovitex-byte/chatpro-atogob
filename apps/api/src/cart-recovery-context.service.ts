import { Injectable } from '@nestjs/common';
import { ShopifyService } from './shopify.service';
import { SupabaseService } from './supabase.service';

type JsonObject = Record<string, unknown>;

type RecoveryCartRow = {
  id: string;
  customer_phone: string | null;
  cart_snapshot: unknown;
  cart_value: string | number | null;
  checkout_url: string | null;
  checkout_created_at: string | null;
  last_activity_at: string | null;
  last_recovery_sent_at: string | null;
  recovery_step: number | null;
};

export type RecoveryCartLine = {
  productId: string;
  productTitle: string;
  productUrl: string;
  variantId: string;
  variantLegacyId: string;
  variantTitle: string;
  unitPrice: string;
  options: Array<{
    name: string;
    value: string;
  }>;
  quantity: number;
};

export type CartRecoveryReplyContext = {
  type: 'abandoned_cart_recovery';
  cart_id: string;
  recovery_sent_at: string;
  recovery_step: number;
  expires_at: string;
  cart_is_editable: boolean;
  cart: {
    items: Array<{
      product_title: string;
      variant_title: string | null;
      quantity: number;
      unit_price: string | null;
      currency: string | null;
    }>;
    total_amount: string | null;
    currency: string | null;
    checkout_url: string | null;
    checkout_created_at: string | null;
    last_activity_at: string | null;
  };
};

export type CartRecoveryMatch = {
  context: CartRecoveryReplyContext;
  cartLines: RecoveryCartLine[];
};

@Injectable()
export class CartRecoveryContextService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly shopifyService: ShopifyService,
  ) {}

  async findForCustomer(
    companyId: string,
    customerPhone: string,
  ): Promise<CartRecoveryMatch | null> {
    const client = this.supabaseService.getClient();
    const settings = await this.getCompanySettings(companyId);
    const contextHours = this.getContextHours(settings);
    const since = new Date(
      Date.now() - contextHours * 60 * 60 * 1000,
    ).toISOString();

    const { data, error } = await client
      .from('abandoned_carts')
      .select(
        'id, customer_phone, cart_snapshot, cart_value, checkout_url, checkout_created_at, last_activity_at, last_recovery_sent_at, recovery_step',
      )
      .eq('company_id', companyId)
      .not('last_recovery_sent_at', 'is', null)
      .gte('last_recovery_sent_at', since)
      .order('last_recovery_sent_at', { ascending: false })
      .limit(50);

    if (error) {
      throw new Error(
        `No se pudo consultar el contexto de recuperación: ${error.message}`,
      );
    }

    const recoverySettings = this.object(settings.cart_recovery);
    const defaultCountryCode =
      this.text(recoverySettings.default_country_code) ??
      this.text(settings.cart_recovery_default_country_code);
    const cart = ((data ?? []) as RecoveryCartRow[]).find((item) =>
      this.samePhone(item.customer_phone, customerPhone, defaultCountryCode),
    );

    if (!cart?.last_recovery_sent_at) {
      return null;
    }

    const recoverySentAt = new Date(cart.last_recovery_sent_at).getTime();

    if (!Number.isFinite(recoverySentAt)) {
      return null;
    }

    const expiresAt = new Date(
      recoverySentAt + contextHours * 60 * 60 * 1000,
    ).toISOString();

    if (Date.parse(expiresAt) <= Date.now()) {
      return null;
    }

    const snapshot = this.object(cart.cart_snapshot);
    const rawLines = Array.isArray(snapshot.lines) ? snapshot.lines : [];
    const items = rawLines
      .map((line) => this.toCartItem(line))
      .filter(
        (
          item,
        ): item is CartRecoveryReplyContext['cart']['items'][number] =>
          item !== null,
      );

    const cartLines = await this.toRecoveryCartLines(rawLines);

    return {
      context: {
        type: 'abandoned_cart_recovery',
        cart_id: cart.id,
        recovery_sent_at: cart.last_recovery_sent_at,
        recovery_step:
          typeof cart.recovery_step === 'number' ? cart.recovery_step : 0,
        expires_at: expiresAt,
        cart_is_editable: cartLines.length > 0,
        cart: {
          items,
          total_amount:
            this.text(snapshot.total_amount) ?? this.text(cart.cart_value),
          currency: this.text(snapshot.currency),
          checkout_url: cart.checkout_url,
          checkout_created_at: cart.checkout_created_at,
          last_activity_at: cart.last_activity_at,
        },
      },
      cartLines,
    };
  }

  private async toRecoveryCartLines(
    rawLines: unknown[],
  ): Promise<RecoveryCartLine[]> {
    const lines: RecoveryCartLine[] = [];

    for (const rawLine of rawLines) {
      const direct = this.toRecoveryCartLine(rawLine);

      if (direct) {
        lines.push(direct);
        continue;
      }

      const legacy = await this.resolveLegacyCartLine(rawLine);

      if (legacy) {
        lines.push(legacy);
      }
    }

    return lines;
  }

  private toRecoveryCartLine(value: unknown): RecoveryCartLine | null {
    const line = this.object(value);
    const productId = this.text(line.product_id);
    const productTitle = this.text(line.product_title);
    const productUrl = this.text(line.product_url);
    const variantId = this.text(line.variant_id);
    const variantLegacyId = this.text(line.variant_legacy_id);
    const variantTitle = this.text(line.variant_title);
    const unitPrice = this.text(line.unit_price);
    const quantity = this.number(line.quantity);

    if (
      !productId ||
      !productTitle ||
      !variantId ||
      !variantLegacyId ||
      !variantTitle ||
      !unitPrice ||
      !quantity ||
      quantity < 1
    ) {
      return null;
    }

    return {
      productId,
      productTitle,
      productUrl: productUrl ?? '',
      variantId,
      variantLegacyId,
      variantTitle,
      unitPrice,
      options: this.options(line.options),
      quantity,
    };
  }

  private async resolveLegacyCartLine(
    value: unknown,
  ): Promise<RecoveryCartLine | null> {
    const line = this.object(value);
    const productTitle = this.text(line.product_title);
    const variantTitle = this.text(line.variant_title);
    const quantity = this.number(line.quantity);
    const unitPrice = this.text(line.unit_price);

    if (!productTitle || !variantTitle || !quantity || quantity < 1) {
      return null;
    }

    try {
      const products = await this.shopifyService.searchCatalog(productTitle, 5);
      const product =
        products.find(
          (candidate) =>
            this.normalizeText(candidate.title) ===
            this.normalizeText(productTitle),
        ) ?? null;

      if (!product) {
        return null;
      }

      const variant =
        product.variants.edges
          .map(({ node }) => node)
          .find(
            (candidate) =>
              this.normalizeText(candidate.title) ===
              this.normalizeText(variantTitle),
          ) ?? null;

      if (!variant) {
        return null;
      }

      return {
        productId: product.id,
        productTitle: product.title,
        productUrl: product.onlineStoreUrl ?? '',
        variantId: variant.id,
        variantLegacyId: variant.legacyResourceId,
        variantTitle: variant.title,
        unitPrice: unitPrice ?? variant.price,
        options: variant.selectedOptions,
        quantity,
      };
    } catch {
      return null;
    }
  }

  private async getCompanySettings(companyId: string): Promise<JsonObject> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('company_settings')
      .select('settings')
      .eq('company_id', companyId)
      .maybeSingle();

    if (error) {
      throw new Error(
        `No se pudo consultar la configuración de recuperación: ${error.message}`,
      );
    }

    return this.object(data?.settings);
  }

  private getContextHours(settings: JsonObject): number {
    const recoverySettings = this.object(settings.cart_recovery);
    const configured =
      recoverySettings.reply_context_hours ??
      settings.cart_recovery_reply_context_hours;
    const parsed =
      typeof configured === 'number'
        ? configured
        : typeof configured === 'string'
          ? Number(configured)
          : Number.NaN;

    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 168) {
      return parsed;
    }

    return 72;
  }

  private toCartItem(
    value: unknown,
  ): CartRecoveryReplyContext['cart']['items'][number] | null {
    const line = this.object(value);
    const productTitle = this.text(line.product_title);

    if (!productTitle) {
      return null;
    }

    const quantity = this.number(line.quantity);

    return {
      product_title: productTitle,
      variant_title: this.text(line.variant_title),
      quantity: quantity && quantity > 0 ? quantity : 1,
      unit_price: this.text(line.unit_price),
      currency: this.text(line.currency),
    };
  }

  private samePhone(
    left: string | null,
    right: string,
    defaultCountryCode: string | null,
  ): boolean {
    const normalizedLeft = this.normalizePhone(left, defaultCountryCode);
    const normalizedRight = this.normalizePhone(right, defaultCountryCode);

    if (!normalizedLeft || !normalizedRight) {
      return false;
    }

    if (normalizedLeft === normalizedRight) {
      return true;
    }

    return (
      normalizedLeft.length >= 10 &&
      normalizedRight.length >= 10 &&
      normalizedLeft.slice(-10) === normalizedRight.slice(-10)
    );
  }

  private normalizePhone(
    value: string | null,
    defaultCountryCode: string | null,
  ): string {
    let digits = (value ?? '').replace(/\D/g, '');

    if (digits.startsWith('00')) {
      digits = digits.slice(2);
    }

    if (digits.length === 10 && defaultCountryCode) {
      const countryCode = defaultCountryCode.replace(/\D/g, '');
      if (countryCode) {
        return `${countryCode}${digits}`;
      }
    }

    return digits;
  }

  private normalizeText(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('es-CO')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private options(value: unknown): Array<{ name: string; value: string }> {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter(
      (option): option is { name: string; value: string } =>
        Boolean(option) &&
        typeof option === 'object' &&
        !Array.isArray(option) &&
        typeof (option as Record<string, unknown>).name === 'string' &&
        typeof (option as Record<string, unknown>).value === 'string',
    );
  }

  private object(value: unknown): JsonObject {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as JsonObject;
    }

    return {};
  }

  private text(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }

    return null;
  }

  private number(value: unknown): number | null {
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : Number.NaN;

    return Number.isFinite(parsed) ? parsed : null;
  }
}
