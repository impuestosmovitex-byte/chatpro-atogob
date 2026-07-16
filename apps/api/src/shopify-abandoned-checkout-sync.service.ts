import { Injectable, Logger } from '@nestjs/common';
import { CompanyShopifyService } from './company-shopify.service';
import { SupabaseService } from './supabase.service';

type JsonObject = Record<string, unknown>;

export type ShopifyAbandonedCheckoutSyncResult = {
  companyId: string;
  createdSince: string;
  received: number;
  inserted: number;
  updated: number;
  latestCheckoutCreatedAt: string | null;
};

@Injectable()
export class ShopifyAbandonedCheckoutSyncService {
  private readonly logger = new Logger(ShopifyAbandonedCheckoutSyncService.name);
  private isRunning = false;

  constructor(
    private readonly companyShopifyService: CompanyShopifyService,
    private readonly supabaseService: SupabaseService,
  ) {}

  async syncEnabledCompanies(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    try {
      const client = this.supabaseService.getClient();
      const [settingsResult, automationsResult] = await Promise.all([
        client
          .from('company_settings')
          .select('company_id, settings'),
        client
          .from('company_automations')
          .select('company_id, enabled, updated_at')
          .eq('automation_key', 'abandoned_cart')
          .eq('enabled', true),
      ]);

      if (settingsResult.error) {
        throw new Error(
          `No se pudo consultar la configuración de recuperación: ${settingsResult.error.message}`,
        );
      }

      if (automationsResult.error) {
        throw new Error(
          `No se pudo consultar la automatización de carritos: ${automationsResult.error.message}`,
        );
      }

      const settingsByCompany = new Map(
        ((settingsResult.data ?? []) as Array<{
          company_id: string;
          settings: unknown;
        }>).map((row) => [row.company_id, row]),
      );

      for (const automation of (automationsResult.data ?? []) as Array<{
        company_id: string;
        enabled: boolean;
        updated_at: string | null;
      }>) {
        const row = settingsByCompany.get(automation.company_id);

        if (!row) {
          this.logger.warn(
            `La empresa ${automation.company_id} no tiene company_settings para sincronizar carritos.`,
          );
          continue;
        }

        const settings = this.toJsonObject(row.settings);
        const activationFrom =
          this.toDate(settings.cart_recovery_activation_from) ??
          this.toDate(automation.updated_at) ??
          new Date();
        const lastSyncAt = this.toDate(
          settings.cart_recovery_last_sync_at,
        );
        const checkpoint =
          lastSyncAt && lastSyncAt.getTime() > activationFrom.getTime()
            ? lastSyncAt
            : activationFrom;

        // Shopify puede tardar en mostrar un checkout como abandonado.
        // Revisamos seis horas hacia atrás; el upsert evita duplicados.
        const createdSince = new Date(
          Math.max(
            activationFrom.getTime(),
            checkpoint.getTime() - 6 * 60 * 60 * 1000,
          ),
        ).toISOString();

        const limit = this.toBoundedInt(
          settings.cart_recovery_sync_limit,
          20,
          1,
          50,
        );

        try {
          const result = await this.syncCompany(
            automation.company_id,
            createdSince,
            limit,
          );

          // Si Shopify todavía no devuelve resultados, no adelantamos
          // el punto de control para no perder checkouts que aparezcan tarde.
          const nextCheckpoint =
            result.latestCheckoutCreatedAt ?? checkpoint.toISOString();
          const { error: updateError } = await client
            .from('company_settings')
            .update({
              settings: {
                ...settings,
                cart_recovery_enabled: true,
                cart_recovery_activation_from:
                  activationFrom.toISOString(),
                cart_recovery_last_sync_at: nextCheckpoint,
              },
              updated_at: new Date().toISOString(),
            })
            .eq('company_id', automation.company_id);

          if (updateError) {
            throw new Error(
              `No se pudo guardar el punto de sincronización: ${updateError.message}`,
            );
          }

          if (result.received > 0) {
            this.logger.log(
              `Carritos Shopify ${automation.company_id}: ${result.received} recibidos, ${result.inserted} nuevos, ${result.updated} actualizados.`,
            );
          }
        } catch (error) {
          this.logger.error(
            `No se pudieron sincronizar carritos de ${automation.company_id}: ${
              error instanceof Error ? error.message : 'error desconocido'
            }`,
          );
        }
      }
    } finally {
      this.isRunning = false;
    }
  }

  async syncCompany(
    companyId: string,
    createdSince: string,
    limit = 3,
  ): Promise<ShopifyAbandonedCheckoutSyncResult> {
    const cleanCompanyId = companyId.trim();
    const cleanCreatedSince = createdSince.trim();

    if (!cleanCompanyId) {
      throw new Error('Falta el identificador de la empresa.');
    }

    if (!Number.isFinite(Date.parse(cleanCreatedSince))) {
      throw new Error('La fecha de sincronización no es válida.');
    }

    const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 50);
    const checkouts =
      await this.companyShopifyService.listOpenAbandonedCheckoutsCreatedSince(
        cleanCompanyId,
        cleanCreatedSince,
        safeLimit,
      );

    const client = this.supabaseService.getClient();
    let inserted = 0;
    let updated = 0;
    let latestCheckoutCreatedAt: string | null = null;

    for (const checkout of checkouts) {
      if (
        !latestCheckoutCreatedAt ||
        Date.parse(checkout.createdAt) >
          Date.parse(latestCheckoutCreatedAt)
      ) {
        latestCheckoutCreatedAt = checkout.createdAt;
      }

      const now = new Date().toISOString();
      const cartSnapshot = {
        source: 'shopify_web',
        external_checkout_id: checkout.externalId,
        created_at: checkout.createdAt,
        updated_at: checkout.updatedAt,
        currency: checkout.total.currencyCode,
        total_amount: checkout.total.amount,
        customer: {
          name: checkout.customerName,
          email: checkout.customerEmail,
          phone: checkout.customerPhone,
        },
        lines: checkout.lines.map((line) => ({
          product_id: line.product?.id ?? null,
          product_handle: line.product?.handle ?? null,
          product_title: line.product?.title ?? line.title,
          product_url: line.product?.url ?? null,
          variant_id: line.variant?.id ?? null,
          variant_legacy_id: line.variant?.legacyResourceId ?? null,
          variant_title: line.variant?.title ?? line.variantTitle,
          options: line.variant?.options ?? [],
          quantity: line.quantity,
          unit_price: line.unitPrice.amount,
          currency: line.unitPrice.currencyCode,
        })),
      };

      const { data: existingCart, error: findError } = await client
        .from('abandoned_carts')
        .select('id, customer_phone, customer_name, customer_email')
        .eq('company_id', cleanCompanyId)
        .eq('source', 'shopify_web')
        .eq('external_id', checkout.externalId)
        .maybeSingle();

      if (findError) {
        throw new Error(
          `No se pudo buscar el abandono de Shopify: ${findError.message}`,
        );
      }

      const existing = existingCart as {
        id: string;
        customer_phone: string | null;
        customer_name: string | null;
        customer_email: string | null;
      } | null;

      const sharedPayload = {
        cart_id: `shopify:${checkout.externalId}`,
        products: JSON.stringify(cartSnapshot.lines),
        cart_value: checkout.total.amount,
        cart_snapshot: cartSnapshot,
        checkout_url: checkout.checkoutUrl,
        checkout_created_at: checkout.createdAt,
        last_activity_at: checkout.updatedAt,
        provider_updated_at: checkout.updatedAt,
        customer_phone: checkout.customerPhone ?? existing?.customer_phone ?? null,
        customer_name: checkout.customerName ?? existing?.customer_name ?? null,
        customer_email: checkout.customerEmail ?? existing?.customer_email ?? null,
        updated_at: now,
      };

      if (existing?.id) {
        const { error: updateError } = await client
          .from('abandoned_carts')
          .update(sharedPayload)
          .eq('id', existing.id);

        if (updateError) {
          throw new Error(
            `No se pudo actualizar el abandono de Shopify: ${updateError.message}`,
          );
        }

        updated += 1;
        continue;
      }

      const { error: insertError } = await client
        .from('abandoned_carts')
        .insert({
          ...sharedPayload,
          company_id: cleanCompanyId,
          source: 'shopify_web',
          external_id: checkout.externalId,
          session_id: null,
          cart_state: 'active',
          recovery_status: 'pending',
          recovery_step: 0,
          last_recovery_sent_at: null,
          notes: null,
        });

      if (insertError) {
        throw new Error(
          `No se pudo guardar el abandono de Shopify: ${insertError.message}`,
        );
      }

      inserted += 1;
    }

    return {
      companyId: cleanCompanyId,
      createdSince: cleanCreatedSince,
      received: checkouts.length,
      inserted,
      updated,
      latestCheckoutCreatedAt,
    };
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

  private toDate(value: unknown): Date | null {
    if (typeof value !== 'string' || !value.trim()) {
      return null;
    }

    const parsed = Date.parse(value);

    return Number.isFinite(parsed) ? new Date(parsed) : null;
  }

  private toBoundedInt(
    value: unknown,
    fallback: number,
    minimum: number,
    maximum: number,
  ): number {
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : Number.NaN;

    if (!Number.isFinite(parsed)) {
      return fallback;
    }

    return Math.min(
      Math.max(Math.floor(parsed), minimum),
      maximum,
    );
  }
}
