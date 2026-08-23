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

  it('conserva un pedido encontrado por correo aunque Shopify no pueda devolver el correo protegido', async () => {
    const companyCommerceService = {
      isLegacyEnvironmentEnabled: jest.fn().mockResolvedValue(false),
      isEnabled: jest.fn().mockResolvedValue(true),
    };

    const companyShopifyService = {
      lookupCustomerOrders: jest
        .fn()
        .mockResolvedValue([buildOrder()]),
    };

    const shopifyService = {
      lookupCustomerOrders: jest.fn(),
    };

    const service = new CustomerOrderService(
      companyCommerceService as never,
      companyShopifyService as never,
      shopifyService as never,
    );

    const result = await service.lookup(companyId, {
      email: 'cliente@ejemplo.com',
    });

    expect(companyShopifyService.lookupCustomerOrders).toHaveBeenCalledWith(
      companyId,
      {
        email: 'cliente@ejemplo.com',
        limit: 1,
      },
    );

    expect(result.found).toBe(true);
    expect(result.next_action).toBe('answer_order');
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].name).toBe('#1001');
  });

  it('rechaza un pedido cuando Shopify devuelve un correo visible diferente al consultado', async () => {
    const companyCommerceService = {
      isLegacyEnvironmentEnabled: jest.fn().mockResolvedValue(false),
      isEnabled: jest.fn().mockResolvedValue(true),
    };

    const companyShopifyService = {
      lookupCustomerOrders: jest.fn().mockResolvedValue([
        buildOrder({
          customer: {
            name: '',
            email: 'otra-persona@ejemplo.com',
            phone: null,
          },
        }),
      ]),
    };

    const shopifyService = {
      lookupCustomerOrders: jest.fn(),
    };

    const service = new CustomerOrderService(
      companyCommerceService as never,
      companyShopifyService as never,
      shopifyService as never,
    );

    const result = await service.lookup(companyId, {
      email: 'cliente@ejemplo.com',
    });

    expect(result.found).toBe(false);
    expect(result.orders).toHaveLength(0);
  });

  it('conserva un pedido encontrado por celular aunque Shopify no pueda devolver el teléfono protegido', async () => {
    const companyCommerceService = {
      isLegacyEnvironmentEnabled: jest.fn().mockResolvedValue(false),
      isEnabled: jest.fn().mockResolvedValue(true),
    };

    const companyShopifyService = {
      lookupCustomerOrders: jest
        .fn()
        .mockResolvedValue([buildOrder()]),
    };

    const shopifyService = {
      lookupCustomerOrders: jest.fn(),
    };

    const service = new CustomerOrderService(
      companyCommerceService as never,
      companyShopifyService as never,
      shopifyService as never,
    );

    const result = await service.lookup(companyId, {
      phone: '+57 300 123 4567',
    });

    expect(companyShopifyService.lookupCustomerOrders).toHaveBeenCalledWith(
      companyId,
      {
        phone: '573001234567',
        limit: 1,
      },
    );

    expect(result.found).toBe(true);
    expect(result.orders).toHaveLength(1);
  });

  it('rechaza un pedido cuando Shopify devuelve un teléfono visible diferente al consultado', async () => {
    const companyCommerceService = {
      isLegacyEnvironmentEnabled: jest.fn().mockResolvedValue(false),
      isEnabled: jest.fn().mockResolvedValue(true),
    };

    const companyShopifyService = {
      lookupCustomerOrders: jest.fn().mockResolvedValue([
        buildOrder({
          customer: {
            name: '',
            email: null,
            phone: '+57 311 999 9999',
          },
        }),
      ]),
    };

    const shopifyService = {
      lookupCustomerOrders: jest.fn(),
    };

    const service = new CustomerOrderService(
      companyCommerceService as never,
      companyShopifyService as never,
      shopifyService as never,
    );

    const result = await service.lookup(companyId, {
      phone: '+57 300 123 4567',
    });

    expect(result.found).toBe(false);
    expect(result.orders).toHaveLength(0);
  });
});
