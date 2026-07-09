import { Injectable } from '@nestjs/common';
import { CompanyCommerceService } from './company-commerce.service';
import {
  CompanyShopifyService,
  type CompanyShopifyCustomerOrder,
} from './company-shopify.service';
import {
  ShopifyService,
  type ShopifyCustomerOrder,
} from './shopify.service';

type OrderLookupInput = {
  orderReference?: string;
  email?: string;
  phone?: string;
  limit?: number;
};

type OrderLookupResult = ShopifyCustomerOrder | CompanyShopifyCustomerOrder;

@Injectable()
export class CustomerOrderService {
  constructor(
    private readonly companyCommerceService: CompanyCommerceService,
    private readonly companyShopifyService: CompanyShopifyService,
    private readonly shopifyService: ShopifyService,
  ) {}

  async lookup(companyId: string, input: OrderLookupInput) {
    const orderReference = this.clean(input.orderReference);
    const email = this.clean(input.email).toLowerCase();
    const phone = this.clean(input.phone).replace(/\D/g, '');

    if (!orderReference && !email && !phone) {
      return {
        ok: false,
        found: false,
        error:
          'Para consultar el pedido necesito el número de pedido, correo o celular usado en la compra.',
      };
    }

    const orders = await this.lookupFromProvider(companyId, {
      orderReference,
      email,
      phone,
      limit: input.limit ?? 3,
    });

    return {
      ok: true,
      found: orders.length > 0,
      orders: orders.map((order) => this.toPayload(order)),
      message: orders.length
        ? 'Pedido encontrado con información real de la tienda.'
        : 'No encontré un pedido con esos datos. Pide otro dato o transfiere a asesor si el cliente necesita revisión manual.',
    };
  }

  private async lookupFromProvider(
    companyId: string,
    input: OrderLookupInput,
  ): Promise<OrderLookupResult[]> {
    if (await this.companyCommerceService.isEnabled(companyId)) {
      return this.companyShopifyService.lookupCustomerOrders(
        companyId,
        input,
      );
    }

    if (await this.companyCommerceService.isLegacyEnvironmentEnabled(companyId)) {
      return this.shopifyService.lookupCustomerOrders(input);
    }

    return [];
  }

  private toPayload(order: OrderLookupResult) {
    const tracking = order.tracking.filter(
      (item) => item.number || item.url || item.company,
    );

    return {
      id: order.id,
      name: order.name,
      created_at: order.createdAt,
      processed_at: order.processedAt,
      cancelled_at: order.cancelledAt,
      financial_status: order.financialStatus,
      fulfillment_status: order.fulfillmentStatus,
      total: order.total,
      customer: order.customer,
      shipping_address: order.shippingAddress,
      items: order.lineItems.map((item) => ({
        title: item.title,
        variant_title: item.variantTitle,
        quantity: item.quantity,
        unit_price: item.unitPrice,
      })),
      fulfillments: order.fulfillments,
      tracking,
      has_tracking: tracking.length > 0,
    };
  }

  private clean(value: unknown) {
    return typeof value === 'string' ? value.trim().slice(0, 120) : '';
  }
}
