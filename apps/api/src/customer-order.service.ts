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
          'Para consultar el pedido necesito datos de identificación del pedido.',
      };
    }

    const identifierInputs: Array<{
      kind: 'orderReference' | 'email' | 'phone';
      input: OrderLookupInput;
    }> = [];

    if (orderReference) {
      identifierInputs.push({
        kind: 'orderReference',
        input: {
          orderReference,
          limit: 5,
        },
      });
    }

    if (email) {
      identifierInputs.push({
        kind: 'email',
        input: {
          email,
          limit: 5,
        },
      });
    }

    if (phone) {
      identifierInputs.push({
        kind: 'phone',
        input: {
          phone,
          limit: 5,
        },
      });
    }

    const identifierCount = identifierInputs.length;

    const lookupIdentifiers = {
      order_reference: Boolean(orderReference),
      email: Boolean(email),
      phone: Boolean(phone),
      count: identifierCount,
    };

    // Barrera de privacidad:
    // un solo dato puede iniciar la consulta, pero nunca es suficiente
    // para mostrar productos, valores, estado, dirección o guía.
    if (identifierCount < 2) {
      return {
        ok: true,
        found: false,
        requires_verification: true,
        requires_human: false,
        next_action: 'ask_verification_identifier',
        lookup_identifiers: lookupIdentifiers,
        orders: [],
        message:
          'Hace falta un segundo dato para confirmar que el pedido pertenece al mismo cliente.',
      };
    }

    let matchesByIdentifier: OrderLookupResult[][] = [];

    try {
      // Los identificadores se consultan en paralelo para reducir
      // el tiempo de respuesta sin disminuir la seguridad.
      matchesByIdentifier = await Promise.all(
        identifierInputs.map(async (identifier) => {
          const providerOrders = await this.lookupFromProvider(
            companyId,
            identifier.input,
          );

          return providerOrders.filter((order) =>
            this.matchesLookupIdentifier(order, identifier.input),
          );
        }),
      );
    } catch {
      return {
        ok: false,
        found: false,
        requires_human: true,
        error:
          'No pude consultar el pedido en este momento. No muestres información de ningún pedido.',
      };
    }

    const matchesFor = (
      kind: 'orderReference' | 'email' | 'phone',
    ): OrderLookupResult[] => {
      const index = identifierInputs.findIndex(
        (identifier) => identifier.kind === kind,
      );

      return index >= 0
        ? (matchesByIdentifier[index] ?? [])
        : [];
    };

    // Si tenemos número de pedido, este es el ancla principal.
    // El pedido queda validado cuando ese número coincide con
    // AL MENOS UNO de los datos secundarios entregados:
    // correo O teléfono.
    //
    // Así, un teléfono diferente no invalida un correo correcto
    // y un correo diferente no invalida un teléfono correcto.
    if (orderReference) {
      const referenceOrders = matchesFor('orderReference');
      const referenceIds = new Set(
        referenceOrders.map((order) => String(order.id)),
      );

      const verifiedIds = new Set<string>();

      if (email) {
        for (const order of matchesFor('email')) {
          const id = String(order.id);

          if (referenceIds.has(id)) {
            verifiedIds.add(id);
          }
        }
      }

      if (phone) {
        for (const order of matchesFor('phone')) {
          const id = String(order.id);

          if (referenceIds.has(id)) {
            verifiedIds.add(id);
          }
        }
      }

      const verifiedOrders = referenceOrders.filter((order) =>
        verifiedIds.has(String(order.id)),
      );

      if (verifiedOrders.length === 1) {
        return {
          ok: true,
          found: true,
          requires_verification: false,
          requires_human: false,
          next_action: 'answer_order',
          lookup_identifiers: lookupIdentifiers,
          orders: [this.toPayload(verifiedOrders[0])],
          message:
            'Pedido validado con número de pedido y un segundo identificador coincidente.',
        };
      }

      if (verifiedOrders.length > 1) {
        return {
          ok: true,
          found: false,
          ambiguous: true,
          requires_verification: true,
          requires_human: true,
          next_action: 'human_attention',
          lookup_identifiers: lookupIdentifiers,
          orders: [],
          message:
            'La validación produjo más de un resultado y requiere revisión humana.',
        };
      }

      const secondaryCount =
        Number(Boolean(email)) +
        Number(Boolean(phone));

      const triedBothSecondaryIdentifiers =
        secondaryCount >= 2;

      return {
        ok: true,
        found: false,
        requires_verification: true,
        requires_human: triedBothSecondaryIdentifiers,
        next_action: triedBothSecondaryIdentifiers
          ? 'human_attention'
          : 'ask_alternate_identifier',
        lookup_identifiers: lookupIdentifiers,
        orders: [],
        message: triedBothSecondaryIdentifiers
          ? 'No fue posible completar la validación automática con los datos disponibles.'
          : 'Hace falta probar otro dato de validación para confirmar la compra.',
      };
    }

    // Si el cliente no conoce el número del pedido,
    // correo + teléfono pueden validar únicamente cuando ambos
    // conducen a un solo pedido real.
    const emailOrders = matchesFor('email');
    const phoneOrders = matchesFor('phone');

    const phoneIds = new Set(
      phoneOrders.map((order) => String(order.id)),
    );

    const commonOrders = emailOrders.filter((order) =>
      phoneIds.has(String(order.id)),
    );

    const uniqueOrders = Array.from(
      new Map(
        commonOrders.map((order) => [String(order.id), order]),
      ).values(),
    );

    if (uniqueOrders.length >= 1) {
      const latestOrder = [...uniqueOrders].sort((left, right) => {
        const leftTimestamp =
          Date.parse(String(left.processedAt || left.createdAt || '')) || 0;

        const rightTimestamp =
          Date.parse(String(right.processedAt || right.createdAt || '')) || 0;

        return rightTimestamp - leftTimestamp;
      })[0];

      return {
        ok: true,
        found: true,
        requires_verification: false,
        requires_human: false,
        next_action: 'answer_order',
        lookup_identifiers: lookupIdentifiers,
        orders: [this.toPayload(latestOrder)],
        message:
          uniqueOrders.length > 1
            ? 'Correo y teléfono validados. Se seleccionó el pedido más reciente del cliente.'
            : 'Pedido validado con correo y teléfono coincidentes.',
      };
    }

    return {
      ok: true,
      found: false,
      requires_verification: true,
      requires_human: true,
      next_action: 'human_attention',
      lookup_identifiers: lookupIdentifiers,
      orders: [],
      message:
        'Correo y teléfono no permitieron validar un mismo pedido. Requiere revisión humana.',
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

      // El proveedor ya buscó exclusivamente por este teléfono.
      // Si Shopify permite devolver un teléfono visible, exigimos coincidencia.
      // Si el dato protegido no está disponible, no descartamos un pedido
      // que Shopify ya encontró mediante el filtro de teléfono.
      if (!phones.length) {
        return true;
      }

      return phones.some((phone) =>
        this.samePhone(phone, requestedPhone),
      );
    }

    const requestedEmail = this.clean(input.email).toLowerCase();

    if (requestedEmail) {
      const actualEmail = this.clean(
        order.customer?.email,
      ).toLowerCase();

      // El proveedor ya buscó exclusivamente por este correo.
      // Si Shopify devuelve el correo visible, debe coincidir exactamente.
      // Si el dato protegido está oculto, conservamos el pedido encontrado.
      if (!actualEmail) {
        return true;
      }

      return actualEmail === requestedEmail;
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
