import { CustomerOrderService } from './customer-order.service';

describe('CustomerOrderService', () => {
  const companyId = 'company-test';

  const buildOrder = (overrides: Record<string, unknown> = {}) => ({
    id: 'gid://shopify/Order/123',
    name: '#1001',
    createdAt: '2026-08-22T12:00:00Z',
    processedAt: '2026-08-22T12:00:00Z',
    cancelledAt: null,
    financialStatus: 'PAID',
    fulfillmentStatus: 'UNFULFILLED',
    total: {
      amount: '100000.00',
      currencyCode: 'COP',
    },
    customer: {
      name: '',
      email: null,
      phone: null,
    },
    shippingAddress: null,
    lineItems: [],
    fulfillments: [],
    tracking: [],
    ...overrides,
  });

  const buildService = (
    lookupCustomerOrders = jest.fn(),
  ) => {
    const companyCommerceService = {
      isLegacyEnvironmentEnabled: jest.fn().mockResolvedValue(false),
      isEnabled: jest.fn().mockResolvedValue(true),
    };

    const companyShopifyService = {
      lookupCustomerOrders,
    };

    const shopifyService = {
      lookupCustomerOrders: jest.fn(),
    };

    return {
      service: new CustomerOrderService(
        companyCommerceService as never,
        companyShopifyService as never,
        shopifyService as never,
      ),
      companyShopifyService,
      shopifyService,
    };
  };

  it('exige un segundo dato antes de consultar el proveedor cuando solo recibe correo', async () => {
    const { service, companyShopifyService, shopifyService } =
      buildService();

    const result = await service.lookup(companyId, {
      email: 'cliente@ejemplo.com',
    });

    expect(result.found).toBe(false);
    expect(result.requires_verification).toBe(true);
    expect(result.next_action).toBe('ask_verification_identifier');
    expect(result.orders).toHaveLength(0);
    expect(
      companyShopifyService.lookupCustomerOrders,
    ).not.toHaveBeenCalled();
    expect(shopifyService.lookupCustomerOrders).not.toHaveBeenCalled();
  });

  it('exige un segundo dato antes de consultar el proveedor cuando solo recibe celular', async () => {
    const { service, companyShopifyService, shopifyService } =
      buildService();

    const result = await service.lookup(companyId, {
      phone: '+57 300 123 4567',
    });

    expect(result.found).toBe(false);
    expect(result.requires_verification).toBe(true);
    expect(result.next_action).toBe('ask_verification_identifier');
    expect(result.orders).toHaveLength(0);
    expect(
      companyShopifyService.lookupCustomerOrders,
    ).not.toHaveBeenCalled();
    expect(shopifyService.lookupCustomerOrders).not.toHaveBeenCalled();
  });

  it('valida un pedido cuando correo y celular coinciden con el mismo pedido aunque Shopify oculte esos datos', async () => {
    const lookupCustomerOrders = jest
      .fn()
      .mockImplementation(async () => [buildOrder()]);

    const { service } = buildService(lookupCustomerOrders);

    const result = await service.lookup(companyId, {
      email: 'cliente@ejemplo.com',
      phone: '+57 300 123 4567',
    });

    expect(lookupCustomerOrders).toHaveBeenNthCalledWith(
      1,
      companyId,
      {
        email: 'cliente@ejemplo.com',
        limit: 5,
      },
    );

    expect(lookupCustomerOrders).toHaveBeenNthCalledWith(
      2,
      companyId,
      {
        phone: '573001234567',
        limit: 5,
      },
    );

    expect(result.found).toBe(true);
    expect(result.requires_verification).toBe(false);
    expect(result.next_action).toBe('answer_order');
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].name).toBe('#1001');
  });

  it('no mezcla pedidos diferentes cuando los dos identificadores no apuntan al mismo pedido', async () => {
    const lookupCustomerOrders = jest
      .fn()
      .mockImplementation(
        async (
          _companyId: string,
          input: { email?: string; phone?: string },
        ) => {
          if (input.email) {
            return [
              buildOrder({
                id: 'gid://shopify/Order/123',
                name: '#1001',
              }),
            ];
          }

          return [
            buildOrder({
              id: 'gid://shopify/Order/456',
              name: '#1002',
            }),
          ];
        },
      );

    const { service } = buildService(lookupCustomerOrders);

    const result = await service.lookup(companyId, {
      email: 'cliente@ejemplo.com',
      phone: '+57 300 123 4567',
    });

    expect(result.found).toBe(false);
    expect(result.requires_verification).toBe(true);
    expect(result.next_action).toBe('ask_alternate_identifier');
    expect(result.orders).toHaveLength(0);
  });
});
