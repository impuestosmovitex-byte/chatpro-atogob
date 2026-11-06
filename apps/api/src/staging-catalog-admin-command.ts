/** Source-aware MW1 staging admin planner. No writes or LLM. */
export type CatalogKind='manual'|'csv'|'excel'|'pdf'|'shopify'|'woocommerce'|'tiendanube'|'website';
export const LOCAL_KINDS=new Set<CatalogKind>(['manual','csv','excel','pdf']);
export type CatalogOrigin={
  kind:CatalogKind; label:string;managedBy:'mw1'|'external';
  updateMethod:'edit-local'|'reimport'|'provider-sync';canEditPrice:boolean;
};
const kinds:CatalogKind[]=['manual','csv','excel','pdf','shopify','woocommerce','tiendanube','website'];
export function catalogOrigin(kind:unknown,label=''):CatalogOrigin{
  if(typeof kind!=='string'||!kinds.includes(kind as CatalogKind))throw new Error('Fuente no reconocida.');
  const k=kind as CatalogKind,local=LOCAL_KINDS.has(k);
  const names:Record<CatalogKind,string>={
    manual:'Manual',csv:'CSV',excel:'Excel',pdf:'PDF',shopify:'Shopify',
    woocommerce:'WooCommerce (WordPress)',tiendanube:'Tiendanube',website:'Página web',
  };
  return {kind:k,label:label.trim().slice(0,120)||names[k],
    managedBy:local?'mw1':'external',
    updateMethod:!local?'provider-sync':k==='manual'?'edit-local':'reimport',
    canEditPrice:local};
}
export type PriceIntent={
  field:'sale_price'|'cost_ambiguous';query:string;
  newPrice:number|null;claimedOldPrice:number|null;
};
export type PriceTarget={
  productId:string;variantId:string;sku:string|null;name:string;
  variantLabel:string;price:number;currency:string;sourceKind:CatalogKind;
  sourceLabel:string;externalProductId:string|null;externalVariantId:string|null;
};
export type PriceChoice=PriceTarget&{canApply:boolean;blockedReason:string|null};
const normalize=(s:string)=>s.normalize('NFD').toLowerCase()
  .replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const newer=/(?:\ba\b|\ben\b|\bponle\b|\bponerlo\b|\bdejarlo\s+en\b)\s*(\$?\s*(?:\d{1,3}(?:[.,]\d{3})+|\d{1,9})\s*(?:mil|miles)?\s*(?:pesos)?)(?![\d.,])/i;
const previous=/(?:antes\s+(?:valia|costaba|era)|(?:\bde\b)\s*)\s*(\$?\s*(?:\d{1,3}(?:[.,]\d{3})+|\d{1,9})\s*(?:mil|miles)?\s*(?:pesos)?)(?![\d.,])/i;
function parseMoney(raw:string):number|null{
  const m=/^\s*\$?\s*(\d{1,3}(?:[.,]\d{3})+|\d{1,9})\s*(mil|miles)?\s*(?:pesos)?\s*$/.exec(raw.toLowerCase());
  if(!m)return null;
  const n=Number(m[1].replace(/[.,]/g,'')),value=n*(m[2]?1000:1);
  return Number.isSafeInteger(value)&&value>0&&value<=999999999?value:null;
}
const STRIP=/\b(cambia|cambiar|cambiale|actualiza|actualizar|ajusta|ajustar|ponle|ponerle|pon|deja|dejar|el|la|los|las|un|una|al|del|de|producto|articulo|precio|venta|vender|coste|costo|a|por|en|que|antes|ahora|estaba|esta|vale|valia|pesos|mil)\b/g;
export function parseAdminPriceCommand(input:string):PriceIntent|null{
  if(typeof input!=='string'||input.trim().length<10||input.length>450)return null;
  const val=normalize(input),isCost=/\b(costo|coste)\b/.test(val);
  if(!isCost&&!/\b(precio|vale|valia|vender|venta|cobrar|ponle|pon|cambia|cambiar|ajusta|actualiza)\b/.test(val))return null;
  const plain=input.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const n=newer.exec(plain),o=previous.exec(plain);
  let query=plain;
  if(n)query=query.replace(n[0],' ');
  if(o)query=query.replace(o[0],' ');
  query=normalize(query).replace(STRIP,' ').replace(/\s+/g,' ').trim();
  return {field:isCost?'cost_ambiguous':'sale_price',query,
    newPrice:n?parseMoney(n[1]):null,claimedOldPrice:o?parseMoney(o[1]):null};
}
export function findPriceTargets(intent:PriceIntent,items:PriceTarget[]):PriceChoice[]{
  if(!intent.query)return [];
  const terms=normalize(intent.query).split(' ').filter(Boolean);
  return items.filter(row=>{
    if(normalize(row.sku||'')===intent.query)return true;
    const words=normalize(row.name+' '+row.variantLabel).split(' ');
    return terms.every(t=>words.includes(t));
  }).slice(0,12).map(row=>{
    const origin=catalogOrigin(row.sourceKind,row.sourceLabel);
    const external=Boolean(row.externalProductId||row.externalVariantId);
    const canApply=origin.canEditPrice&&!external&&row.currency==='COP'&&
      Number.isFinite(row.price)&&row.price>=0;
    return {...row,canApply,blockedReason:canApply?null:external||!origin.canEditPrice
      ?'Este precio lo administra '+origin.label+
       '. Actualízalo en la tienda conectada y sincroniza el catálogo.'
      :'Esta referencia o moneda no admite actualización local.'};
  });
}
