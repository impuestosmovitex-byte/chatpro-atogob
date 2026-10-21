import { createHash } from 'node:crypto';
import { readCatalogPicture,exactImageMatches,validateVisualProposal,type VisualOption } from './staging-vision';
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
  test('never treats visual matching as a confirmed order',()=>{
    expect(validateVisualProposal({matches:[{variantId:'v1'}],uncertain:false},[option]))
      .toEqual({matches:[option],uncertain:true});
    expect(validateVisualProposal({matches:Array(30).fill({variantId:'v1'})},[option]).matches).toEqual([]);
  });
});
