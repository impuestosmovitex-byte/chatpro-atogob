import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';

export type Picture = {bytes:Buffer;mimeType:'image/jpeg'|'image/png'|'image/webp';sha256:string;extension:string};
export function readCatalogPicture(base64:unknown,mime:unknown):Picture {
  if(typeof base64!=='string'||base64.length>725000||base64.length<268 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)){
    throw new BadRequestException('Imagen inválida o demasiado grande (máximo 512 KB).');
  }
  const bytes=Buffer.from(base64,'base64');
  if(bytes.length<200||bytes.length>524288){
    throw new BadRequestException('Imagen fuera del límite admitido.');
  }
  const detected=bytes.length>=3 && bytes[0]===0xff && bytes[1]===0xd8 &&
    bytes[2]===0xff ? 'image/jpeg':
    bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png':
    bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'image/webp':null;
  if(!detected||detected!==mime){
    throw new BadRequestException('Solo se admiten imágenes JPEG, PNG y WebP válidas.');
  }
  return {
    bytes,mimeType:detected,sha256:createHash('sha256').update(bytes).digest('hex'),
    extension:detected==='image/jpeg'?'jpg':detected==='image/png'?'png':'webp',
  };
}

export type VisualOption={variantId:string;productId:string;name:string;variantLabel:string;price:number;stock:number|null;imageId:string};
export function exactImageMatches(hash:string,images:Array<{id:string;sha256:string;variant_id:string;product_id:string}>,variants:Array<{id:string;product_id:string;price:number|string;stock_quantity:number|null;variant_label:string}>,names:Map<string,string>):VisualOption[]{
  const byId=new Map(variants.map(v=>[v.id,v]));
  const matches:VisualOption[]=[];
  const used=new Set<string>();
  for(const photo of images){
    if(photo.sha256!==hash||used.has(photo.variant_id))continue;
    const v=byId.get(photo.variant_id);
    if(!v||v.product_id!==photo.product_id||!names.has(photo.product_id))continue;
    used.add(photo.variant_id);
    matches.push({
      variantId:v.id,productId:v.product_id,name:names.get(v.product_id)!,
      variantLabel:v.variant_label,price:Number(v.price),
      stock:v.stock_quantity===null?null:Number(v.stock_quantity),imageId:photo.id,
    });
  }
  return matches.slice(0,3);
}
export function validateVisualProposal(
  response:unknown,
  allowedOptions:VisualOption[],
):{matches:VisualOption[];uncertain:true}{
  if(!response||typeof response!=='object'||Array.isArray(response))return{matches:[],uncertain:true};
  const raw=response as Record<string,unknown>;
  if(!Array.isArray(raw.matches)||raw.matches.length>3)return{matches:[],uncertain:true};
  const allowed=new Map(allowedOptions.map(o=>[o.variantId,o]));
  const selected:VisualOption[]=[];
  for(const match of raw.matches){
    if(!match||typeof match!=='object'||Array.isArray(match))continue;
    const id=(match as Record<string,unknown>).variantId;
    if(typeof id!=='string'||!allowed.has(id)||selected.some(o=>o.variantId===id))continue;
    selected.push(allowed.get(id)!);
  }
  // Even the strongest visual result must be confirmed by the user.
  return{matches:selected,uncertain:true};
}

/**
 * Fair bounded reference sampling for photographs containing multiple products.
 * Try distinct products before a second photo of the same product; never allow
 * one catalogue item to crowd out other companies' (tenant already scoped).
 */
export function chooseVisualReferences<T extends {product_id:string;variant_id:string}>(
  images:T[],max=8,
):T[]{
  if(!Number.isSafeInteger(max)||max<1||max>12)throw new Error('Límite visual inválido.');
  const distinct:T[]=[];
  const used=new Set<string>();
  const products=new Set<string>();
  for(const image of images){
    if(used.has(image.variant_id)||products.has(image.product_id))continue;
    distinct.push(image);used.add(image.variant_id);products.add(image.product_id);
    if(distinct.length>=max)return distinct;
  }
  for(const image of images){
    if(used.has(image.variant_id))continue;
    distinct.push(image);used.add(image.variant_id);
    if(distinct.length>=max)break;
  }
  return distinct;
}
const COLORS:Record<string,string>={
  negro:'negro',negra:'negro',blanco:'blanco',blanca:'blanco',
  rojo:'rojo',roja:'rojo',azul:'azul',verde:'verde',beige:'beige',
  gris:'gris',cafe:'cafe',marron:'marron',arena:'arena',
  rosa:'rosa',rosado:'rosa',rosada:'rosa',vinotinto:'vinotinto',
  morado:'morado',morada:'morado',lila:'lila',
};
function visualWords(s:string):string[]{
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .split(/[^a-z0-9]+/).filter(Boolean);
}
/** Attribute constraints never promote an image into an exact SKU match. */
export function narrowVisualMatches(
  caption:string,
  options:VisualOption[],
):{options:VisualOption[];specific:boolean}{
  const words=visualWords(caption.slice(0,160));
  const normalized=words.join(' ');
  const size=/(?:^| )talla (?:numero |nro )?(xs|xxxl|xxl|xl|s|m|l|\d{1,3})(?: |$)/.exec(normalized)?.[1]||null;
  const colors=[...new Set(words.map(w=>COLORS[w]).filter((v):v is string=>Boolean(v)))];
  if(!size&&!colors.length)return {options,specific:false};
  const matched=options.filter(o=>{
    const label=visualWords(o.name+' '+o.variantLabel);
    if(size&&!label.includes(size))return false;
    if(colors.length&&!colors.every(c=>label.some(word=>COLORS[word]===c)))return false;
    return true;
  });
  return {options:matched,specific:true};
}
