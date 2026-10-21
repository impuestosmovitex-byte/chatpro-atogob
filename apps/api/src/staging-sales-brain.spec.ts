import {
  applySalesProposal,
  inferSalesProposal,
  guardSalesProposal,
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

  test('distinguishes garment size number from product quantity', () => {
    const garments:CatalogItem[]=[
      {variantId:'t6',label:'Vestido negro talla 6',unitPrice:45000,stock:10},
      {variantId:'t8',label:'Vestido negro talla 8',unitPrice:47000,stock:10},
      {variantId:'t10',label:'Vestido negro talla 10',unitPrice:49000,stock:10},
    ];
    const selected=inferSalesProposal('Quiero un vestido negro talla 8',garments);
    expect(selected).toEqual({
      actions:[{op:'add',variantId:'t8',quantity:1}],uncertain:false,
    });
    const two=inferSalesProposal('Quiero 2 vestidos negros talla 6',garments);
    expect(two.actions).toEqual([{op:'add',variantId:'t6',quantity:2}]);
    expect(applySalesProposal(garments,[],two).subtotal).toBe(90000);
  });

  test('does not guess a size absent from catalog', () => {
    const garments:CatalogItem[]=[
      {variantId:'t8',label:'Vestido negro talla 8',unitPrice:47000,stock:10},
    ];
    const wrong=inferSalesProposal('Quiero vestido negro talla 6',garments);
    expect(wrong.actions).toEqual([]);
    expect(wrong.uncertain).toBe(true);
  });

  test('does not guess a color absent from catalog', () => {
    const garments:CatalogItem[]=[
      {variantId:'black',label:'Vestido negro talla 8',unitPrice:47000,stock:10},
    ];
    const wrong=inferSalesProposal('Busco vestido rojo talla 8',garments);
    expect(wrong.actions).toEqual([]);
    expect(wrong.uncertain).toBe(true);
  });

  test('asks for size when multiple sizes match', () => {
    const garments:CatalogItem[]=[
      {variantId:'six',label:'Vestido negro talla 6',unitPrice:45000,stock:10},
      {variantId:'eight',label:'Vestido negro talla 8',unitPrice:47000,stock:10},
    ];
    const request=inferSalesProposal('Necesito un vestido negro',garments);
    expect(request.actions).toEqual([]);
    expect(request.uncertain).toBe(true);
  });

  test('rejects untrusted AI action choosing wrong size or wrong color', () => {
    const garments:CatalogItem[]=[
      {variantId:'six',label:'Vestido negro talla 6',unitPrice:45000,stock:10},
      {variantId:'red',label:'Vestido rojo talla 8',unitPrice:47000,stock:10},
      {variantId:'eight',label:'Vestido negro talla 8',unitPrice:49000,stock:10},
    ];
    const proposal={
      actions:[
        {op:'add' as const,variantId:'six',quantity:1},
        {op:'add' as const,variantId:'red',quantity:1},
      ],uncertain:false,
    };
    const result=guardSalesProposal('Quiero vestido negro talla 8',garments,proposal);
    expect(result.actions).toEqual([]);
    expect(result.uncertain).toBe(true);
    expect(applySalesProposal(garments,[],result).subtotal).toBe(0);
  });

  test('guards a valid assistant selection and preserves correct size', () => {
    const garments:CatalogItem[]=[
      {variantId:'eight',label:'Vestido negro talla 8',unitPrice:49000,stock:10},
    ];
    const proposal={actions:[{op:'add' as const,variantId:'eight',quantity:1}],uncertain:false};
    const result=guardSalesProposal('Quiero un vestido negro talla 8',garments,proposal);
    expect(result).toEqual(proposal);
  });

  test('clears cart without creating orders or payments', () => {
    const proposal=inferSalesProposal('vaciar mi carrito',fixtures);
    const result=applySalesProposal(fixtures,[{variantId:'pan',quantity:3}],proposal);
    expect(result.cart).toHaveLength(0);
    expect(result.subtotal).toBe(0);
  });
});
