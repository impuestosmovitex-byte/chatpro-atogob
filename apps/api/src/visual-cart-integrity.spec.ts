import { ChatAgentService } from './chat-agent.service';

type Item = { productUrl: string; optionValues: string[]; quantity: number };
const companyId = 'tenant-example-01';
const url = (i: number) => 'https://tenant.example.com/products/item-' + i;

function harness(
  burstCount = 3,
  connected = true,
) {
  const session: any = {
    companyId,
    id: 'session-A',
    context: {
      conversation_category: 'sales',
      visual_reference_burst: {
        references: Array.from({ length: burstCount }, (_, i) => ({
          match_type: 'exact',
          matched_product: { url: url(i + 1) },
        })),
      },
    },
  };
  const variantValues = ['Negro', 'Azul', 'Blanco', 'Verde', 'Beige'];
  const isEnabled = jest.fn(async (requestedCompanyId: string) => {
    expect(requestedCompanyId).toBe(companyId);
    return connected;
  });
  const getProductByHandle = jest.fn(
    async (requestedCompanyId: string, handle: string) => {
      expect(requestedCompanyId).toBe(companyId);
      const id = Number(handle.replace('item-', ''));
      return {
        id: 'product-' + id,
        handle,
        title: 'Pieza ' + id,
        onlineStoreUrl: url(id),
        variants: [{
          id: 'variant-' + id,
          legacyResourceId: String(id),
          title: variantValues[(id - 1) % variantValues.length],
          price: '50000',
          options: [{
            name: 'Color',
            value: variantValues[(id - 1) % variantValues.length],
          }],
        }],
      };
    },
  );
  const addCartLines = jest.fn(async (_session: any, lines: any[]) => ({
    ok: true,
    cart: lines,
  }));
  const legacy = jest.fn(async () => {
    throw new Error('Unscoped global Shopify must never be accessed');
  });

  const agent: any = Object.create(ChatAgentService.prototype);
  agent.companyCommerceService = { isEnabled, getProductByHandle };
  agent.shopifyService = { getProductFromUrl: legacy };
  agent.cartService = { addCartLines };
  return {
    agent, session, isEnabled, getProductByHandle, addCartLines, legacy,
  };
}

function item(i: number, options: string[] = []): Item {
  return { productUrl: url(i), optionValues: options, quantity: 1 };
}

describe('multi-photo cart atomicity and company isolation', () => {
  it('adds all three distinct exact products in one company-scoped cart operation', async () => {
    const { agent, session, addCartLines, getProductByHandle, legacy } = harness();
    const result = await agent.addVisualProductsToCart(
      session,
      [item(1, ['Negro']), item(2, ['Azul']), item(3, ['Blanco'])],
      'Quiero los tres productos',
    );
    expect(result).toMatchObject({ ok: true, visual_batch_count: 3 });
    expect(addCartLines).toHaveBeenCalledTimes(1);
    const lines = addCartLines.mock.calls[0][1];
    expect(lines.map((line: any) => line.productId))
      .toEqual(['product-1', 'product-2', 'product-3']);
    expect(getProductByHandle).toHaveBeenCalledTimes(3);
    expect(legacy).not.toHaveBeenCalled();
  });

  it('does not add the two correct variants when a third requested size is unavailable', async () => {
    const { agent, session, addCartLines, legacy } = harness();
    const result = await agent.addVisualProductsToCart(
      session,
      [item(1, ['Negro']), item(2, ['Azul']), item(3, ['L'])],
      'Quiero los tres productos',
    );
    expect(result).toEqual(expect.objectContaining({
      ok: false,
      cart_unchanged: true,
      next_action: 'clarify_unresolved_visual_products',
    }));
    expect(result.resolved_not_added).toHaveLength(2);
    expect(result.unresolved).toEqual([
      expect.objectContaining({
        reason: 'variant_options_not_found',
        product_url: url(3),
        requested_options: ['L'],
      }),
    ]);
    expect(addCartLines).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
  });

  it('never silently drops a product from a visual burst', async () => {
    const { agent, session, addCartLines, getProductByHandle } = harness(3);
    const result = await agent.addVisualProductsToCart(
      session,
      [item(1), item(2)],
      'Quiero las tres prendas',
    );
    expect(result).toMatchObject({
      ok: false,
      cart_unchanged: true,
      next_action: 'clarify_omitted_visual_references',
      expected_visual_references: 3,
      provided_items: 2,
    });
    expect(addCartLines).not.toHaveBeenCalled();
    expect(getProductByHandle).not.toHaveBeenCalled();
  });

  it('allows an explicit subset rather than forcing unwanted items', async () => {
    const { agent, session, addCartLines } = harness(3);
    const result = await agent.addVisualProductsToCart(
      session,
      [item(1), item(2)],
      'Solo los dos primeros',
    );
    expect(result).toMatchObject({ ok: true, visual_batch_count: 2 });
    expect(addCartLines).toHaveBeenCalledTimes(1);
  });

  it('blocks two visual pieces pointing to one product URL, avoiding duplicated outfits', async () => {
    const { agent, session, addCartLines } = harness(2);
    const result = await agent.addVisualProductsToCart(
      session,
      [item(1, ['Negro']), item(1, ['Beige'])],
      'Quiero las dos prendas',
    );
    expect(result).toMatchObject({
      ok: false,
      cart_unchanged: true,
      next_action: 'clarify_shared_product_reference',
    });
    expect(addCartLines).not.toHaveBeenCalled();
  });

  it('rejects eleven items rather than silently truncating to ten', async () => {
    const { agent, session, addCartLines } = harness(11);
    expect(agent.readVisualCartItems({
      items: Array.from({ length: 11 }, (_, i) => ({
        product_url: url(i + 1),
        option_values: [],
        quantity: 1,
      })),
    })).toHaveLength(0);
    const result = await agent.addVisualProductsToCart(
      session,
      Array.from({ length: 11 }, (_, i) => item(i + 1)),
      'Quiero todas',
    );
    expect(result).toMatchObject({ ok: false, cart_unchanged: true });
    expect(addCartLines).not.toHaveBeenCalled();
  });

  it('refuses the global legacy Shopify catalog if the current tenant has none', async () => {
    const { agent, session, getProductByHandle, addCartLines, legacy } = harness(2, false);
    const result = await agent.addVisualProductsToCart(
      session,
      [item(1), item(2)],
      'Quiero los dos',
    );
    expect(result).toMatchObject({
      ok: false,
      cart_unchanged: true,
      next_action: 'connect_company_catalog',
    });
    expect(getProductByHandle).not.toHaveBeenCalled();
    expect(addCartLines).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
  });

  it('refuses catalog URLs not present as exact matches in the session', async () => {
    const { agent, session, addCartLines } = harness(2);
    const result = await agent.addVisualProductsToCart(
      session,
      [item(1), item(99)],
      'Quiero ambas prendas',
    );
    expect(result).toMatchObject({
      ok: false,
      cart_unchanged: true,
      next_action: 'clarify_unresolved_visual_products',
    });
    expect(result.unresolved).toEqual([
      expect.objectContaining({ reason: 'visual_reference_not_exact' }),
    ]);
    expect(addCartLines).not.toHaveBeenCalled();
  });

  it('supports ten different exact products when every option is resolved', async () => {
    const { agent, session, addCartLines } = harness(10);
    const result = await agent.addVisualProductsToCart(
      session,
      Array.from({ length: 10 }, (_, i) => item(i + 1)),
      'Quiero los diez productos',
    );
    expect(result).toMatchObject({ ok: true, visual_batch_count: 10 });
    expect(addCartLines.mock.calls[0][1]).toHaveLength(10);
  });
});
