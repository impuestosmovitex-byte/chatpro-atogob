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
