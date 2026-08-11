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

    let orders: OrderLookupResult[];

    // Consulta un solo identificador por intento.
    // Prioridad: número de pedido > celular > correo.
    // Esto evita mezclar resultados de datos anteriores de la conversación.
    const lookupInput: OrderLookupInput = orderReference
      ? {
          orderReference,
          limit: 1,
        }
      : phone
        ? {
            phone,
            limit: 1,
          }
        : {
            email,
            limit: 1,
          };

    try {
      orders = await this.lookupFromProvider(
        companyId,
        lookupInput,
      );

      // Segunda barrera de seguridad:
      // no confiamos solamente en el buscador de Shopify.
      // El pedido debe coincidir realmente con el identificador consultado.
      orders = orders
        .filter((order) =>
          this.matchesLookupIdentifier(order, lookupInput),
        )
        .slice(0, 1);
    } catch {
      return {
        ok: false,
        found: false,
        requires_human: true,
        error:
          'No pude consultar el pedido en este momento. No inventes el estado del pedido; ofrece dejar el caso con un asesor y pide confirmar número de pedido, correo o celular.',
      };
    }

    const found = orders.length > 0;

    // La búsqueda usa solo un identificador, pero conservamos cuántos
    // datos distintos ya aportó el cliente para evitar pedir datos
    // indefinidamente. Después de un segundo intento fallido se escala.
    const identifierCount = [
      orderReference,
      email,
      phone,
    ].filter(Boolean).length;

    const shouldAskAlternateIdentifier =
      !found && identifierCount < 2;

    return {
      ok: true,
      found,
      requires_human: !found && !shouldAskAlternateIdentifier,
      next_action: found
        ? 'answer_order'
        : shouldAskAlternateIdentifier
          ? 'ask_alternate_identifier'
          : 'offer_human_attention',
      lookup_identifiers: {
        order_reference: Boolean(lookupInput.orderReference),
        email: Boolean(lookupInput.email),
        phone: Boolean(lookupInput.phone),
        count: identifierCount,
      },
      orders: orders.map((order) => this.toPayload(order)),
      message: found
        ? 'Pedido encontrado con información real de la tienda.'
        : shouldAskAlternateIdentifier
          ? 'No encontré el pedido con ese dato. Pide un dato diferente, como correo o celular usado en la compra. No transfieras todavía.'
          : 'No encontré el pedido con los datos enviados. No inventes información; ofrece dejar el caso con un asesor.',
    };
  }

  private async lookupFromProvider(
    companyId: string,
    input: OrderLookupInput,
  ): Promise<OrderLookupResult[]> {
    if (await this.companyCommerceService.isLegacyEnvironmentEnabled(companyId)) {
      return this.shopifyService.lookupCustomerOrders(input);
    }

    if (await this.companyCommerceService.isEnabled(companyId)) {
      return this.companyShopifyService.lookupCustomerOrders(
        companyId,
        input,
      );
    }

    return [];
  }

  private matchesLookupIdentifier(
    order: OrderLookupResult,
    input: OrderLookupInput,
  ): boolean {
    const requestedReference = this.normalizeOrderReference(
      input.orderReference,
    );

    if (requestedReference) {
      const actualReference = this.normalizeOrderReference(order.name);
      return actualReference === requestedReference;
    }

    const requestedPhone = this.normalizePhone(input.phone);

    if (requestedPhone) {
      const phones = [
        order.customer?.phone,
        order.shippingAddress?.phone,
      ]
        .map((value) => this.normalizePhone(value))
        .filter(Boolean);

      return phones.some((phone) =>
        this.samePhone(phone, requestedPhone),
      );
    }

    const requestedEmail = this.clean(input.email).toLowerCase();

    if (requestedEmail) {
      const actualEmail = this.clean(
        order.customer?.email,
      ).toLowerCase();

      return Boolean(actualEmail) && actualEmail === requestedEmail;
    }

    return false;
  }

  private normalizeOrderReference(value: unknown): string {
    return this.clean(value)
      .replace(/^#/, '')
      .replace(/\s+/g, '')
      .toLowerCase();
  }

  private normalizePhone(value: unknown): string {
    return this.clean(value).replace(/\D/g, '');
  }

  private samePhone(left: string, right: string): boolean {
    if (!left || !right) {
      return false;
    }

    if (left === right) {
      return true;
    }

    if (left.length >= 10 && right.length >= 10) {
      return left.slice(-10) === right.slice(-10);
    }

    return false;
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
