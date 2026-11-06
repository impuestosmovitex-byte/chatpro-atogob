import {
  emptyProductFacts, readProductFacts, validateProductFacts,
  writeProductFactsMetadata,answerProductFacts,
} from './staging-product-facts';
import {answerCatalogQuestion,type CatalogItem} from './staging-sales-brain';

describe('Merchant-authored product facts (MW1 staging)',()=>{
  const example={
    ...emptyProductFacts(),
    description:'Vestido corto de muestra',
    material:'Algodón, confirmado por el proveedor',
    composition:'100 % algodón',
    measurements:'Largo 85 cm según ficha',
    care:'Lavar en frío',
  };

  it('normalizes a valid merchant-authored facts form',()=>{
    const normalized=validateProductFacts({...example,material:'  Algodón\n confirmado '});
    expect(normalized.material).toBe('Algodón confirmado');
    expect(normalized.description).toBe(example.description);
  });
  it('rejects unknown fields so users cannot overwrite business metadata',()=>{
    expect(()=>validateProductFacts({...example,price:1})).toThrow(/no permitido/);
    expect(()=>validateProductFacts({...example,material:5})).toThrow(/texto/);
    expect(()=>validateProductFacts({...example,measurements:'X'.repeat(552)})).toThrow(/extensa/);
  });
  it('preserves other system or integration metadata keys',()=>{
    const raw={shopifyProductId:'protected',source:'shopify',mw1ProductFacts:{material:'Viejo'}};
    const next=writeProductFactsMetadata(raw,example);
    expect(next.shopifyProductId).toBe('protected');
    expect(next.source).toBe('shopify');
    expect((next.mw1ProductFacts as Record<string,string>).material).toBe(example.material);
    expect(next).not.toHaveProperty('description');
    expect(readProductFacts(example.description,next)).toEqual(example);
  });
  it('returns unknowns instead of inventing missing materials',()=>{
    const response=answerProductFacts('¿De qué material es?',emptyProductFacts());
    expect(response?.missing).toContain('material');
    expect(response?.answer).toMatch(/no ha registrado/i);
    expect(response?.answer).not.toMatch(/algodón/i);
  });
  it('distinguishes ingredients and allergens for supermarket listings',()=>{
    const facts={...emptyProductFacts(),ingredients:'Trigo, agua y sal',allergens:'Contiene gluten'};
    expect(answerProductFacts('¿Cuáles son los ingredientes?',facts)?.answer).toContain('Trigo');
    expect(answerProductFacts('¿Tiene alérgenos?',facts)?.answer).toContain('gluten');
    expect(answerProductFacts('¿Qué tela tiene?',facts)?.answer).not.toContain('Trigo');
  });
  it('uses only tenant-fetched facts for product questions',()=>{
    const known:CatalogItem={
      variantId:'owned',label:'Vestido negro talla 8',unitPrice:49000,stock:3,
      facts:validateProductFacts(example),
    };
    const response=answerCatalogQuestion('¿Qué material tiene el vestido negro talla 8?',[known]);
    expect(response?.reply).toContain('Algodón');
    expect(response?.reply).toContain('proporcionada por el comercio');
    expect(response?.reply).not.toContain('inventa');
  });
  it('does not give the first variant facts for a different unknown product',()=>{
    const a:CatalogItem={
      variantId:'a',label:'Vestido negro talla 6',unitPrice:42000,stock:2,
      facts:validateProductFacts(example),
    };
    const b:CatalogItem={
      variantId:'b',label:'Vestido rojo talla 8',unitPrice:44000,stock:2,
      facts:emptyProductFacts(),
    };
    const response=answerCatalogQuestion('¿Qué material tiene el vestido rojo talla 8?',[a,b]);
    expect(response?.reply).not.toContain('Algodón');
    expect(response?.reply).toContain('no ha registrado');
  });
  it('never leaks unrelated metadata in product answers',()=>{
    const facts=readProductFacts('Pan artesanal',{
      privateToken:'DO_NOT_PRINT',
      mw1ProductFacts:{ingredients:'Harina y agua'},
    });
    expect(JSON.stringify(facts)).not.toContain('DO_NOT_PRINT');
  });
});
