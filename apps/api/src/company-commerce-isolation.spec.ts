import { ChatAgentService } from './chat-agent.service';
import { CartService } from './cart.service';

describe('Commerce isolation for companies without configured stores', () => {
  const session: any = {
    id: 'company-B-session',
    companyId: 'tenant-company-B',
    customerPhone: '573100000001',
    context: {
      selectedProduct: {
        id: 'product',
        handle: 'product-one',
        title: 'Article',
        url: 'https://tenant-b.example/products/product-one',
      },
    },
  };

  const legacyMethods = [
    'searchCatalog',
    'getProductFromUrl',
    'getProductByHandle',
    'getCollections',
  ];

  function agentHarness(connected = false) {
    const agent: any = Object.create(ChatAgentService.prototype);
    const globalShopify = Object.fromEntries(
      legacyMethods.map((method) => [method, jest.fn(async () => {
        throw new Error('Global store must not be accessed');
      })]),
    );
    const getCollections = jest.fn(async () => [{
      id: 'collection-tenant-B', title: 'Catálogo B', onlineStoreUrl: 'https://tenant-b.example/collections',
    }]);
    const searchProducts = jest.fn(async () => []);
    const getProductByHandle = jest.fn(async () => null);
    agent.shopifyService = globalShopify;
    agent.companyCommerceService = {
      isEnabled: jest.fn(async (companyId: string) => {
        expect(companyId).toBe(session.companyId);
        return connected;
      }),
      getCollections, searchProducts, getProductByHandle,
    };
    return { agent, globalShopify, getCollections, searchProducts };
  }

  it('returns no fake collections for a company without Shopify', async () => {
    const { agent, globalShopify, getCollections } = agentHarness();
    expect(await agent.getCollectionsForSession(session)).toEqual([]);
    expect(getCollections).not.toHaveBeenCalled();
    expect(globalShopify.getCollections).not.toHaveBeenCalled();
  });

  it('never searches global Shopify when the company has no own catalog', async () => {
    const { agent, globalShopify } = agentHarness();
    const result = await agent.searchProducts(session, 'Artículo');
    expect(result).toEqual(expect.objectContaining({
      ok: false,
      next_action: 'connect_company_catalog',
    }));
    expect(globalShopify.searchCatalog).not.toHaveBeenCalled();
  });

  it('blocks URL, product and variants lookup without company-scoped integration', async () => {
    const { agent, globalShopify } = agentHarness();
    expect(await agent.selectProductByUrl(
      session, 'https://other-shop.example/products/product-one',
    )).toMatchObject({ ok: false, next_action: 'connect_company_catalog' });
    expect(await agent.selectProductByName(
      session, 'Artículo',
    )).toMatchObject({ ok: false, next_action: 'connect_company_catalog' });
    expect(await agent.getSelectedProduct(
      session,
    )).toMatchObject({ ok: false, next_action: 'connect_company_catalog' });
    expect(await agent.selectVariant(
      session, [{ optionValues: ['M'], quantity: 1 }],
    )).toMatchObject({ ok: false, next_action: 'connect_company_catalog' });
    for (const method of ['searchCatalog','getProductFromUrl','getProductByHandle']) {
      expect(globalShopify[method]).not.toHaveBeenCalled();
    }
  });

  it('continues to request the right tenant catalog when enabled', async () => {
    const { agent, globalShopify, getCollections } = agentHarness(true);
    const result = await agent.getCollectionsForSession(session);
    expect(result).toHaveLength(1);
    expect(getCollections).toHaveBeenCalledWith(session.companyId, 100);
    expect(globalShopify.getCollections).not.toHaveBeenCalled();
  });

  it('refuses external product URLs even when both stores use the same handle', async () => {
    const { agent, globalShopify } = agentHarness(true);
    agent.companyCommerceService.getProductByHandle = jest.fn(async (
      companyId: string,
      handle: string,
    ) => {
      expect(companyId).toBe(session.companyId);
      return {
        id: 'company-B-product',
        title: 'Product',
        handle,
        onlineStoreUrl: 'https://tenant-b.example/products/product-one',
        variants: [],
      };
    });
    const result = await agent.selectProductByUrl(
      session, 'https://other-shop.example/products/product-one',
    );
    expect(result).toMatchObject({
      ok: false,
      next_action: 'verify_company_product_url',
    });
    expect(globalShopify.getProductFromUrl).not.toHaveBeenCalled();

    const existingSelection = await agent.getSelectedProduct({
      ...session,
      context: {
        ...session.context,
        selectedProduct: {
          ...session.context.selectedProduct,
          url: 'https://other-shop.example/products/product-one',
        },
      },
    });
    expect(existingSelection).toMatchObject({
      ok: false,
      next_action: 'verify_company_product_url',
    });
  });

  it('refuses checkout from the globally configured legacy store', async () => {
    const cart: any = Object.create(CartService.prototype);
    cart.companyCommerceService = {
      isEnabled: jest.fn(async () => false),
    };
    cart.shopifyService = {
      buildCartLinks: jest.fn(() => {
        throw new Error('Never build unrelated shop checkout');
      }),
    };
    await expect(cart.buildCartLinksForSession(session, [{
      variantId: 'variant-A', variantLegacyId: '101', quantity: 1,
    }])).rejects.toThrow('tienda comercial propia');
    expect(cart.shopifyService.buildCartLinks).not.toHaveBeenCalled();
  });

  it('builds checkout exclusively through the enabled company connection', async () => {
    const cart: any = Object.create(CartService.prototype);
    const createCheckoutLink = jest.fn(async () => ({
      cartUrl: 'https://tenant-b.example/cart',
      checkoutUrl: 'https://tenant-b.example/checkout',
      lines: [{ variantLegacyId: '123', quantity: 1 }],
    }));
    cart.companyCommerceService = {
      isEnabled: jest.fn(async () => true),
      createCheckoutLink,
    };
    cart.shopifyService = {
      buildCartLinks: jest.fn(() => { throw new Error('Global store access'); }),
    };
    const result = await cart.buildCartLinksForSession(session, [{
      variantId: 'gid://shopify/ProductVariant/123',
      variantLegacyId: '123', quantity: 1,
    }]);
    expect(createCheckoutLink).toHaveBeenCalledWith(session.companyId,
      [{ variantId: 'gid://shopify/ProductVariant/123', quantity: 1 }]);
    expect(result.checkoutUrl).toBe('https://tenant-b.example/checkout');
    expect(cart.shopifyService.buildCartLinks).not.toHaveBeenCalled();
  });
});
