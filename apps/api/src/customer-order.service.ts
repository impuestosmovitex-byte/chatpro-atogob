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
      kind: 'orderReference' | 'email';
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

    const identifierCount = [orderReference, email, phone].filter(Boolean).length;

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
    const discoveredOrders = new Map<string, OrderLookupResult>();

    try {
      // Consultamos cada identificador por separado para conservar
      // la barrera de privacidad.
      //
      // Además guardamos los pedidos descubiertos por cualquiera de
      // los identificadores. Esto permite validar localmente un segundo
      // dato visible en el pedido aunque Shopify no encuentre ese mismo
      // pedido mediante otra representación del dato, por ejemplo un
      // teléfono local frente al teléfono con prefijo internacional.
      matchesByIdentifier = await Promise.all(
        identifierInputs.map(async (identifier) => {
          const providerOrders = await this.lookupFromProvider(
            companyId,
            identifier.input,
          );

          for (const order of providerOrders) {
            discoveredOrders.set(String(order.id), order);
          }

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

    // Cruce seguro adicional:
    // un pedido encontrado por correo, número de pedido o teléfono puede
    // demostrar otro identificador SOLO cuando ese dato está realmente
    // visible dentro del pedido y coincide.
    //
    // Nunca asumimos coincidencia si el dato está oculto.
    for (let index = 0; index < identifierInputs.length; index += 1) {
      const identifier = identifierInputs[index];
      const verifiedById = new Map<string, OrderLookupResult>();

      for (const order of matchesByIdentifier[index] ?? []) {
        verifiedById.set(String(order.id), order);
      }

      for (const order of discoveredOrders.values()) {
        if (
          this.matchesLookupIdentifierStrictly(
            order,
            identifier.input,
          )
        ) {
          verifiedById.set(String(order.id), order);
        }
      }

      matchesByIdentifier[index] = Array.from(
        verifiedById.values(),
      );
    }

    const matchesFor = (
      kind: 'orderReference' | 'email',
    ): OrderLookupResult[] => {
      const index = identifierInputs.findIndex(
        (identifier) => identifier.kind === kind,
      );

      return index >= 0
        ? (matchesByIdentifier[index] ?? [])
        : [];
    };

    // Si tenemos número de pedido, este es el ancla principal.
    //
    // El correo puede verificarse mediante una búsqueda real soportada
    // por Shopify. El teléfono no se usa como filtro de pedidos:
    // se compara de forma estricta contra el pedido encontrado.
    //
    // Cuando llegan varios datos secundarios, basta con que al menos uno
    // valide el mismo pedido anclado por número.
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
        for (const order of referenceOrders) {
          if (
            this.matchesLookupIdentifierStrictly(
              order,
              { phone },
            )
          ) {
            verifiedIds.add(String(order.id));
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

    // Si el cliente no conoce el número del pedido, correo + teléfono
    // pueden validar una compra.
    //
    // Shopify busca los pedidos por correo. Después ChatPro verifica
    // localmente que el teléfono entregado coincida con el teléfono
    // visible del cliente o de la dirección de envío de ese pedido.
    const emailOrders = matchesFor('email');

    const verifiedByPhone = phone
      ? emailOrders.filter((order) =>
          this.matchesLookupIdentifierStrictly(
            order,
            { phone },
          ),
        )
      : [];

    const uniqueOrders = Array.from(
      new Map(
        verifiedByPhone.map((order) => [String(order.id), order]),
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
      requires_human: false,
      next_action: 'ask_alternate_identifier',
      lookup_identifiers: lookupIdentifiers,
      orders: [],
      message:
        'Correo y teléfono no permitieron confirmar automáticamente la compra. Pide el número de pedido antes de considerar atención humana.',
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

  private matchesLookupIdentifierStrictly(
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

      // En validación cruzada un dato ausente nunca cuenta como válido.
      if (!phones.length) {
        return false;
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

      // En validación cruzada un dato oculto tampoco cuenta como válido.
      if (!actualEmail) {
        return false;
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
