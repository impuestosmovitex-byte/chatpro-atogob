import {catalogOrigin,findPriceTargets,parseAdminPriceCommand,type PriceTarget} from './staging-catalog-admin-command';
const origin=(kind:PriceTarget['sourceKind'])=>({...catalogOrigin(kind),kind});
describe('Staging source-aware conversational catalog administration',()=>{
  const rice:PriceTarget={productId:'p1',variantId:'v1',sku:'DIANA-500',
    name:'Arroz blanco Diana',variantLabel:'Única',price:18000,
    currency:'COP',sourceKind:'excel',sourceLabel:'Excel supermercado',
    externalProductId:null,externalVariantId:null};
  it('supports a conversational price proposal without writing',()=>{
    const intent=parseAdminPriceCommand(
      'Cambia el precio del arroz blanco Diana a 20 mil pesos. Antes valía 18 mil pesos',
    );
    expect(intent).toMatchObject({field:'sale_price',query:'arroz blanco diana',
      newPrice:20000,claimedOldPrice:18000});
    const matches=findPriceTargets(intent!,[rice]);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({canApply:true,price:18000});
  });
  it('distinguishes purchase cost from sale price and always asks for clarification',()=>{
    const intent=parseAdminPriceCommand('Cambia el costo del arroz Diana a 20 mil');
    expect(intent?.field).toBe('cost_ambiguous');
  });
  it('works on explicit SKU and keeps exact variant target',()=>{
    const intent=parseAdminPriceCommand('Ponle 20000 al precio del DIANA-500');
    expect(intent?.newPrice).toBe(20000);
    expect(findPriceTargets(intent!,[rice]).map(x=>x.variantId)).toEqual(['v1']);
  });
  it('never chooses between multiple sizes implicitly',()=>{
    const dress:PriceTarget={...rice,name:'Vestido negro',variantLabel:'Talla 8',sku:'D8',variantId:'v8'};
    const others={...dress,variantLabel:'Talla 6',variantId:'v6',sku:'D6'};
    const intent=parseAdminPriceCommand('Cambia el precio del vestido negro a 49000');
    expect(findPriceTargets(intent!,[dress,others]).map(x=>x.variantId))
      .toEqual(['v8','v6']);
    const exact=parseAdminPriceCommand('Cambia el precio del vestido negro talla 8 a 49000');
    expect(findPriceTargets(exact!,[dress,others]).map(x=>x.variantId)).toEqual(['v8']);
  });
  it('rejects external provider price writes until integration writeback is authorized',()=>{
    for(const kind of ['shopify','woocommerce','tiendanube','website'] as const){
      expect(origin(kind).canEditPrice).toBe(false);
      expect(findPriceTargets({field:'sale_price',query:'arroz blanco diana',newPrice:20000,
        claimedOldPrice:null},[{...rice,sourceKind:kind}])[0].canApply).toBe(false);
    }
  });
  it('supports local document imports without pretending to update the original PDF or Excel',()=>{
    for(const kind of ['manual','csv','excel','pdf'] as const){
      expect(origin(kind).canEditPrice).toBe(true);
      expect(origin(kind).updateMethod).not.toBe('provider-sync');
    }
  });
  it('rejects source owned by a provider even if mislabeled as local',()=>{
    const match=findPriceTargets({field:'sale_price',query:'arroz blanco diana',newPrice:20000,
      claimedOldPrice:null},[{...rice,externalProductId:'external-product'}]);
    expect(match[0].canApply).toBe(false);
  });
  it('does not guess products from incomplete instructions',()=>{
    expect(parseAdminPriceCommand('hola')).toBeNull();
    const intent=parseAdminPriceCommand('Cambia el precio a 20000');
    expect(findPriceTargets(intent!,[rice])).toEqual([]);
  });
  it('rejects ambiguous price representations, zero or unrealistic values',()=>{
    expect(parseAdminPriceCommand('Cambia el precio del arroz Diana a 0')?.newPrice).toBeNull();
    expect(parseAdminPriceCommand('Cambia el precio del arroz Diana a 20,50')?.newPrice).toBeNull();
    expect(parseAdminPriceCommand('Cambia el precio del arroz Diana a 1000000000')?.newPrice).toBeNull();
  });
});
