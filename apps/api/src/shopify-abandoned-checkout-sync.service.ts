import { Injectable } from '@nestjs/common';
import { ShopifyService } from './shopify.service';
import { SupabaseService } from './supabase.service';

export type ShopifyAbandonedCheckoutSyncResult = {
  companyId: string;
  updatedSince: string;
  received: number;
  inserted: number;
  updated: number;
};

@Injectable()
export class ShopifyAbandonedCheckoutSyncService {
  constructor(
    private readonly shopifyService: ShopifyService,
    private readonly supabaseService: SupabaseService,
  ) {}

  async syncCompany(
    companyId: string,
    updatedSince: string,
    limit = 3,
  ): Promise<ShopifyAbandonedCheckoutSyncResult> {
    const cleanCompanyId = companyId.trim();
    const cleanUpdatedSince = updatedSince.trim();

    if (!cleanCompanyId) {
      throw new Error('Falta el identificador de la empresa.');
    }

    if (!Number.isFinite(Date.parse(cleanUpdatedSince))) {
      throw new Error('La fecha de sincronización no es válida.');
    }
    const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 50);
    const checkouts =
      await this.shopifyService.listOpenAbandonedCheckoutsUpdatedSince(
        cleanUpdatedSince,
        safeLimit,
      );

    const client = this.supabaseService.getClient();
    let inserted = 0;
    let updated = 0;

    for (const checkout of checkouts) {
      const now = new Date().toISOString();

      const cartSnapshot = {
        source: 'shopify_web',
        external_checkout_id: checkout.externalId,
        created_at: checkout.createdAt,
        updated_at: checkout.updatedAt,
        currency: checkout.total.currencyCode,
        total_amount: checkout.total.amount,
        lines: checkout.lines.map((line) => ({
          product_title: line.title,
          variant_title: line.variantTitle,
          quantity: line.quantity,
          unit_price: line.unitPrice.amount,
          currency: line.unitPrice.currencyCode,
        })),
      };

      const sharedPayload = {
        cart_id: `shopify:${checkout.externalId}`,
        products: JSON.stringify(cartSnapshot.lines),
        cart_value: checkout.total.amount,
        cart_snapshot: cartSnapshot,
        checkout_url: checkout.checkoutUrl,
        checkout_created_at: checkout.createdAt,
        last_activity_at: checkout.updatedAt,
        provider_updated_at: checkout.updatedAt,
        updated_at: now,
      };

      const { data: existingCart, error: findError } = await client
        .from('abandoned_carts')
        .select('id')
        .eq('company_id', cleanCompanyId)
        .eq('source', 'shopify_web')
        .eq('external_id', checkout.externalId)
        .maybeSingle();

      if (findError) {
        throw new Error(
          `No se pudo buscar el abandono de Shopify: ${findError.message}`,
        );
      }

      if (existingCart?.id) {
        const { error: updateError } = await client
          .from('abandoned_carts')
          .update(sharedPayload)
          .eq('id', existingCart.id);

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
          customer_phone: null,
          customer_name: null,
          customer_email: null,
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
      updatedSince: cleanUpdatedSince,
      received: checkouts.length,
      inserted,
      updated,
    };
  }
}