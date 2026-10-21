import { createHash } from 'node:crypto';
import { readCatalogPicture,exactImageMatches,validateVisualProposal,chooseVisualReferences,narrowVisualMatches,type VisualOption } from './staging-vision';
const fakeJpeg=Buffer.concat([Buffer.from([255,216,255,224]),Buffer.alloc(300,7)]);
const base=fakeJpeg.toString('base64');
const hash=createHash('sha256').update(fakeJpeg).digest('hex');
const option:VisualOption={variantId:'v1',productId:'p1',name:'Vestido negro',variantLabel:'Talla 8',
  price:49000,stock:4,imageId:'photo1'};
describe('MW1 catálogo visual privado',()=>{
  test('recognizes bounded JPEG and calculates digest',()=>{
    const p=readCatalogPicture(base,'image/jpeg');
    expect(p.mimeType).toBe('image/jpeg');
    expect(p.sha256).toBe(hash);
    expect(p.extension).toBe('jpg');
  });
  test('rejects unsupported formats, false mime types and oversized files',()=>{
    expect(()=>readCatalogPicture(base,'image/png')).toThrow();
    expect(()=>readCatalogPicture(Buffer.alloc(350).toString('base64'),'image/jpeg')).toThrow();
    const huge=Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(524290)]).toString('base64');
    expect(()=>readCatalogPicture(huge,'image/jpeg')).toThrow();
  });
  test('exact match checks both catalog variant and owning product',()=>{
    const photos=[{id:'photo1',sha256:hash,variant_id:'v1',product_id:'p1'}];
    const variants=[{id:'v1',product_id:'p1',price:49000,stock_quantity:4,variant_label:'Talla 8'}];
    expect(exactImageMatches(hash,photos,variants,new Map([['p1','Vestido negro']])).map(x=>x.variantId))
      .toEqual(['v1']);
    expect(exactImageMatches(hash,photos,variants,new Map([['foreign','Otro']]))).toEqual([]);
    expect(exactImageMatches(hash,photos,[{...variants[0],product_id:'different'}],new Map([['p1','Vestido negro']]))).toEqual([]);
  });
  test('AI cannot add invented or unauthorized variant IDs',()=>{
    const result=validateVisualProposal({matches:[{variantId:'invented'},{variantId:'v1'}],uncertain:false},[option]);
    expect(result.matches.map(x=>x.variantId)).toEqual(['v1']);
    expect(result.uncertain).toBe(true);
  });
  test('two variants using the same picture are choices, not an automatic selection',()=>{
    const images=[
      {id:'pic-small',sha256:hash,variant_id:'small',product_id:'p1'},
      {id:'pic-medium',sha256:hash,variant_id:'medium',product_id:'p1'},
    ];
    const variants=[
      {id:'small',product_id:'p1',price:49000,stock_quantity:2,variant_label:'Talla 6'},
      {id:'medium',product_id:'p1',price:49000,stock_quantity:5,variant_label:'Talla 8'},
    ];
    const choices=exactImageMatches(hash,images,variants,new Map([['p1','Vestido negro']]));
    expect(choices.map(x=>x.variantId)).toEqual(['small','medium']);
    expect(validateVisualProposal({matches:choices.map(x=>({variantId:x.variantId}))},choices).uncertain).toBe(true);
  });
  test('visual search cannot return a photo belonging to another catalog product',()=>{
    const pics=[{id:'bad',sha256:hash,variant_id:'v1',product_id:'other'}];
    const variants=[{id:'v1',product_id:'p1',price:49000,stock_quantity:4,variant_label:'Talla 8'}];
    expect(exactImageMatches(hash,pics,variants,new Map([['p1','Vestido negro']]))).toEqual([]);
  });
  test('multi-item screenshots compare distinct products before duplicated references',()=>{
    const photos=[
      {id:'1',variant_id:'black6',product_id:'dress'},
      {id:'2',variant_id:'black8',product_id:'dress'},
      {id:'3',variant_id:'red10',product_id:'dress'},
      {id:'4',variant_id:'shoe7',product_id:'shoes'},
      {id:'5',variant_id:'hat1',product_id:'hats'},
    ];
    const results=chooseVisualReferences(photos,4);
    expect(results.map(p=>p.id)).toEqual(['1','4','5','2']);
    expect(results.map(p=>p.variant_id)).not.toContain('red10');
  });
  test('caption selects only exact requested color and size from photo options',()=>{
    const items:VisualOption[]=[
      {...option,variantId:'black6',variantLabel:'Talla 6'},
      {...option,variantId:'black8',variantLabel:'Talla 8'},
      {...option,variantId:'red8',name:'Vestido rojo',variantLabel:'Talla 8'},
    ];
    const results=narrowVisualMatches('quiero el NEGRO talla 8',items);
    expect(results.specific).toBe(true);
    expect(results.options.map(p=>p.variantId)).toEqual(['black8']);
  });
  test('does not silently substitute a wrong color or missing size',()=>{
    const matches=narrowVisualMatches('Quiero vestido azul talla 10',[option]);
    expect(matches).toEqual({options:[],specific:true});
    expect(narrowVisualMatches('quiero este',[option]).options).toEqual([option]);
  });
  test('rejects attempts to select unauthorized IDs even from a multi-item screenshot',()=>{
    const allowed=[option];
    expect(validateVisualProposal({matches:[
      {variantId:'v1'},{variantId:'foreign-tenant-id'}
    ],uncertain:false},allowed).matches.map(x=>x.variantId)).toEqual(['v1']);
  });
  test('never treats visual matching as a confirmed order',()=>{
    expect(validateVisualProposal({matches:[{variantId:'v1'}],uncertain:false},[option]))
      .toEqual({matches:[option],uncertain:true});
    expect(validateVisualProposal({matches:Array(30).fill({variantId:'v1'})},[option]).matches).toEqual([]);
  });
});
