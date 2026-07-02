import { Injectable } from '@nestjs/common';
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

export type CartRecoveryReplyContext = {
  type: 'abandoned_cart_recovery';
  cart_id: string;
  recovery_sent_at: string;
  recovery_step: number;
  expires_at: string;
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

@Injectable()
export class CartRecoveryContextService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async findForCustomer(
    companyId: string,
    customerPhone: string,
  ): Promise<CartRecoveryReplyContext | null> {
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

    const defaultCountryCode = this.text(
      settings.cart_recovery_default_country_code,
    );
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
    const lines = Array.isArray(snapshot.lines) ? snapshot.lines : [];
    const items = lines
      .map((line) => this.toCartItem(line))
      .filter(
        (
          item,
        ): item is CartRecoveryReplyContext['cart']['items'][number] =>
          item !== null,
      );

    return {
      type: 'abandoned_cart_recovery',
      cart_id: cart.id,
      recovery_sent_at: cart.last_recovery_sent_at,
      recovery_step:
        typeof cart.recovery_step === 'number' ? cart.recovery_step : 0,
      expires_at: expiresAt,
      cart: {
        items,
        total_amount:
          this.text(snapshot.total_amount) ?? this.text(cart.cart_value),
        currency: this.text(snapshot.currency),
        checkout_url: cart.checkout_url,
        checkout_created_at: cart.checkout_created_at,
        last_activity_at: cart.last_activity_at,
      },
    };
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
    const configured = settings.cart_recovery_reply_context_hours;
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
