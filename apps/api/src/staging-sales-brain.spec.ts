import {
  applySalesProposal,
  inferSalesProposal,
  type CatalogItem,
} from './staging-sales-brain';

const fixtures: CatalogItem[] = [
  { variantId: 'pan', label: 'Pan', unitPrice: 3000, stock: 100 },
  { variantId: 'huevos', label: 'Cubeta de huevos', unitPrice: 18000, stock: 12 },
  { variantId: 'chocolate', label: 'Chocolate', unitPrice: 3000, stock: 100 },
];

describe('MW1 staging sales planner', () => {
  test('proposes three catalog items with correct quantities and authoritative subtotal', () => {
    const proposal = inferSalesProposal(
      'Quiero 2 panes, una cubeta de huevos y 3 chocolates',fixtures,
    );
    const result = applySalesProposal(fixtures,[],proposal);
    expect(result.cart.map(x => [x.variantId,x.quantity])).toEqual([
      ['pan',2],['huevos',1],['chocolate',3],
    ]);
    expect(result.subtotal).toBe(33000);
    expect(result.requiresConfirmation).toBe(true);
    expect(result.reply).not.toMatch(/pedido.*registrado|pedido.*pagado/i);
  });

  test('does not trust model-provided product IDs', () => {
    const result = applySalesProposal(fixtures,[],{
      actions:[{op:'add',variantId:'inventado',quantity:10}],uncertain:false,
    });
    expect(result.subtotal).toBe(0);
    expect(result.changed).toBe(false);
    expect(result.warnings).toHaveLength(1);
  });

  test('never trusts prices supplied in cart', () => {
    const result = applySalesProposal(fixtures,[{
      variantId:'pan',quantity:2,
    }],{actions:[],uncertain:false});
    expect(result.subtotal).toBe(6000);
  });

  test('rejects a different tenant variant in current cart', () => {
    expect(() => applySalesProposal(fixtures,[{
      variantId:'foreign-company-item',quantity:1,
    }],{actions:[],uncertain:false})).toThrow(/no está disponible/i);
  });

  test('rejects invalid cart values and duplicate references', () => {
    expect(() => applySalesProposal(fixtures,[
      {variantId:'pan',quantity:1},{variantId:'pan',quantity:1},
    ],{actions:[],uncertain:false})).toThrow(/inválidos/);
    expect(() => applySalesProposal(fixtures,[
      {variantId:'pan',quantity:-1},
    ],{actions:[],uncertain:false})).toThrow(/inválidos/);
  });

  test('respects authoritative stock and never overbooks inventory', () => {
    const result=applySalesProposal(fixtures,[],{
      actions:[{op:'add',variantId:'huevos',quantity:13}],uncertain:false,
    });
    expect(result.cart).toHaveLength(0);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/inventario/i),
    ]));
  });

  test('removes products by instruction and preserves others', () => {
    const proposal=inferSalesProposal('quita un pan',fixtures);
    const result=applySalesProposal(fixtures,[
      {variantId:'pan',quantity:3},{variantId:'chocolate',quantity:2},
    ],proposal);
    expect(result.cart.map(x=>[x.variantId,x.quantity]))
      .toEqual([['pan',2],['chocolate',2]]);
  });

  test('does not change cart on questions about price', () => {
    const proposal=inferSalesProposal('¿cuánto cuesta el chocolate?',fixtures);
    const result=applySalesProposal(fixtures,[{variantId:'pan',quantity:1}],proposal);
    expect(result.changed).toBe(false);
    expect(result.cart).toHaveLength(1);
    expect(result.reply).toContain('$');
  });

  test('does not silently choose between two ambiguous variants', () => {
    const catalog:CatalogItem[]=[
      {variantId:'negro',label:'Vestido negro',unitPrice:48000,stock:7},
      {variantId:'rojo',label:'Vestido rojo',unitPrice:49000,stock:5},
    ];
    const proposal=inferSalesProposal('quiero un vestido',catalog);
    expect(proposal.uncertain).toBe(true);
    const result=applySalesProposal(catalog,[],proposal);
    expect(result.cart).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test('clears cart without creating orders or payments', () => {
    const proposal=inferSalesProposal('vaciar mi carrito',fixtures);
    const result=applySalesProposal(fixtures,[{variantId:'pan',quantity:3}],proposal);
    expect(result.cart).toHaveLength(0);
    expect(result.subtotal).toBe(0);
  });
});
