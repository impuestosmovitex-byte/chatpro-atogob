/**
 * MW1 staging sales assistant: deterministic fallback and untrusted-model
 * validation. No orders, payments or messages are created by these helpers.
 */
export type CatalogItem = {
  variantId: string;
  label: string;
  unitPrice: number;
  stock: number | null;
};
export type CartItem = CatalogItem & { quantity: number };
export type CartInput = { variantId: string; quantity: number };
export type Action = { op: 'add' | 'remove' | 'set' | 'clear' | 'info'; variantId: string; quantity: number };
export type Proposal = { actions: Action[]; uncertain: boolean };
export type PlanResult = {
  cart: CartItem[];
  subtotal: number;
  reply: string;
  changed: boolean;
  warnings: string[];
  requiresConfirmation: true;
};

const numberWords: Record<string, number> = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, par: 2,
};
const stopwords = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'una', 'uno', 'un', 'y', 'por', 'favor', 'quiero', 'dame', 'necesito', 'me', 'puedes', 'poner', 'agrega', 'agregar', 'sumar', 'con', 'unica']);
export function tokens(input: string): string[] {
  return input.normalize('NFD').toLowerCase().replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/).filter(Boolean).map(part => {
      if (part === 'panes') return 'pan';
      // Keep final vowels in Spanish plurals: 'chocolates' -> 'chocolate'.
      // Irregular consonant plurals can be resolved by the optional AI planner.
      if (part.endsWith('s') && part.length > 4) return part.slice(0, -1);
      return part;
    });
}
const core = (value: string) => tokens(value).filter(x => !stopwords.has(x) && !(x in numberWords) && !/^\d+$/.test(x));
const pesos = (price: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(price);


const COLOR_ALIASES: Record<string,string> = {
  negro:'negro', negra:'negro', blanco:'blanco', blanca:'blanco',
  rojo:'rojo', roja:'rojo', azul:'azul', verde:'verde',
  gris:'gris', beige:'beige', arena:'arena', cafe:'cafe',
  marron:'marron', rosa:'rosa', rosado:'rosa', rosada:'rosa',
  amarillo:'amarillo', amarilla:'amarillo', vinotinto:'vinotinto',
  lila:'lila', morado:'morado', morada:'morado', fucsia:'fucsia',
  nude:'nude', marfil:'marfil',
};
const SIZE_WORD = /^(?:xs|s|m|l|xl|xxl|xxxl|[0-9]{1,3})$/;
const sizePattern = /\b(?:talla|tallas|size|tamano|tamaño)\s*(?:nro\.?|numero|#)?\s*([a-z0-9]{1,5})\b/i;
function normalizedText(value:string):string {
  return value.normalize('NFD').toLowerCase().replace(/[\u0300-\u036f]/g,'');
}
function requestedAttributes(segment:string):{size:string|null;colors:string[]} {
  const normalized=normalizedText(segment);
  const foundSize = sizePattern.exec(normalized);
  const size = foundSize && SIZE_WORD.test(foundSize[1]) ? foundSize[1] : null;
  const colors = [...new Set(tokens(normalized).map(t=>COLOR_ALIASES[t]).filter((t):t is string=>Boolean(t)))];
  return {size,colors};
}
function matchesRequestedAttributes(segment:string, label:string):boolean {
  const requested=requestedAttributes(segment);
  const target=normalizedText(label);
  const targetWords=tokens(target);
  if(requested.size && !targetWords.includes(requested.size)) return false;
  if(requested.colors.length && !requested.colors.every(color =>
    targetWords.some(t=>COLOR_ALIASES[t]===color)
  )) return false;
  return true;
}
function quantityFromRequest(segment:string):number {
  // Exclude numeric sizes before finding quantity:
  // "2 vestidos negros talla 8" -> 2; "vestido talla 8" -> 1.
  const withoutSizes=normalizedText(segment).replace(
    /\b(?:talla|tallas|size|tamano)\s*(?:nro\.?|numero|#)?\s*(?:xs|xxxl|xxl|xl|s|m|l|[0-9]{1,3})\b/gi,
    ' ',
  );
  for(const word of tokens(withoutSizes)){
    if(/^[0-9]{1,3}$/.test(word)) return Number(word);
    if(word in numberWords)return numberWords[word];
  }
  return 1;
}
export function inferSalesProposal(message: string, products: CatalogItem[]): Proposal {
  const normalized = normalizedText(message);
  if (/\b(vaciar|limpiar|reiniciar)\b/.test(normalized)) {
    return { actions: [{ op: 'clear', variantId: '', quantity: 0 }], uncertain: false };
  }
  const chunks = message.split(/[,;]|\s+y\s+|\s+ademas\s+/i).filter(Boolean);
  const op: Action['op'] = /\b(quita|quitar|retira|retirar|elimina|eliminar|saca|sacar)\b/.test(normalized)
    ? 'remove'
    : /\b(cambia|cambiar|deja|dejar|ajusta|ajustar)\b/.test(normalized) ? 'set'
    : /\b(cuanto|cuesta|vale|precio|disponible|tienes|tienen)\b/.test(normalized) ? 'info' : 'add';
  const actions: Action[] = [];
  let uncertain = false;
  for (const chunk of chunks) {
    const clean = core(chunk).filter(t=>t!=='talla'&&t!=='tallas'&&t!=='size'&&t!=='tamano');
    if (!clean.length) { uncertain = true; continue; }
    const candidates=products.map(item=>{
      const productWords=core(item.label).filter(t=>t!=='talla'&&t!=='tallas'&&t!=='size'&&t!=='tamano');
      const overlap=productWords.filter(w=>clean.includes(w)).length;
      return {item,overlap,productWords};
    }).filter(x=>x.overlap>0 && matchesRequestedAttributes(chunk,x.item.label));
    if(!candidates.length){uncertain=true;continue;}
    const greatestOverlap=Math.max(...candidates.map(x=>x.overlap));
    const ranked=candidates.filter(x=>x.overlap===greatestOverlap);
    const greatestPrecision=Math.max(...ranked.map(x=>
      x.overlap/Math.max(x.productWords.length,1)
    ));
    const matches=ranked.filter(x=>
      x.overlap/Math.max(x.productWords.length,1)===greatestPrecision
    );
    // Never choose an arbitrary size/color when several variants qualify.
    if(matches.length!==1){uncertain=true;continue;}
    const quantity=quantityFromRequest(chunk);
    if(!Number.isSafeInteger(quantity)||quantity<1||quantity>100){
      uncertain=true;continue;
    }
    actions.push({op,variantId:matches[0].item.variantId,quantity});
  }
  return {actions:actions.slice(0,12),uncertain:uncertain || actions.length>12};
}

/**
 * Validate assistant selections against explicit attributes in the message.
 * For a single reference this guards against an LLM choosing another size
 * or color that happens to be a valid ID for this company.
 */
export function guardSalesProposal(
  message:string,
  catalog:CatalogItem[],
  candidate:Proposal,
):Proposal {
  if(!Array.isArray(candidate.actions)||candidate.actions.length>12 ||
    typeof candidate.uncertain!=='boolean') return {actions:[],uncertain:true};
  const normalized=normalizedText(message);
  // Destructive and read-only intents cannot be turned into unrelated
  // cart additions by a malformed or manipulated model response.
  if (/\b(vaciar|limpiar|reiniciar)\b/.test(normalized)) {
    return {actions:[{op:'clear',variantId:'',quantity:0}],uncertain:false};
  }
  const readOnlyQuestion=/\b(cuanto|cuesta|precio|vale|disponible|tienes|tienen)\b/.test(normalized) &&
    !/\b(agrega|agregar|quiero|dame|pon|poner|compra|comprar|quita|quitar|cambia|cambiar)\b/.test(normalized);
  const segments=message.split(/[,;]|\s+y\s+|\s+ademas\s+/i).filter(Boolean);
  const singleReference=segments.length===1;
  const requestedTokens=core(message);
  const byId=new Map(catalog.map(p=>[p.variantId,p]));
  const actions:Action[]=[];
  let uncertain=candidate.uncertain;
  for(const action of candidate.actions){
    if(action?.op==='clear' && /\b(vaciar|limpiar|reiniciar)\b/i.test(message)){
      actions.push(action);continue;
    }
    if(!action || !['add','remove','set','info'].includes(action.op) ||
      !Number.isSafeInteger(action.quantity)||action.quantity<1||action.quantity>100){
      uncertain=true;continue;
    }
    const product=byId.get(action.variantId);
    if(!product){uncertain=true;continue;}
    if(readOnlyQuestion && action.op!=='info'){
      uncertain=true;continue;
    }
    if(singleReference && (
      !matchesRequestedAttributes(message,product.label) ||
      !core(product.label).some(token=>requestedTokens.includes(token)) ||
      (action.op!=='info' && action.quantity!==quantityFromRequest(message))
    )){
      uncertain=true;continue;
    }
    actions.push(action);
  }
  return {actions,uncertain};
}

export function applySalesProposal(
  catalog: CatalogItem[],
  current: CartInput[],
  proposal: Proposal,
): PlanResult {
  const byId = new Map(catalog.map(x => [x.variantId, x]));
  if (byId.size !== catalog.length || catalog.length > 300) throw new Error('Catálogo inválido.');
  if (!Array.isArray(current) || current.length > 40) throw new Error('Carrito demasiado grande.');
  const cart = new Map<string, CartItem>();
  for (const item of current) {
    if (!item || typeof item.variantId !== 'string' || !Number.isSafeInteger(item.quantity)
      || item.quantity < 1 || item.quantity > 1000 || cart.has(item.variantId)) {
      throw new Error('El carrito contiene datos inválidos.');
    }
    const product = byId.get(item.variantId);
    if (!product) throw new Error('Un producto del carrito ya no está disponible. Actualiza el catálogo.');
    if (product.stock !== null && item.quantity > product.stock) {
      throw new Error('El inventario cambió. Actualiza el carrito.');
    }
    cart.set(item.variantId, { ...product, quantity: item.quantity });
  }
  const messages: string[] = [];
  const warnings: string[] = [];
  let changed = false;
  if (!Array.isArray(proposal.actions) || proposal.actions.length > 12) throw new Error('Propuesta inválida.');
  for (const action of proposal.actions) {
    if (!action || !['add','remove','set','clear','info'].includes(action.op)
      || typeof action.variantId !== 'string'
      || !Number.isSafeInteger(action.quantity)) {
      warnings.push('La solicitud incluye una operación que no pude validar.');
      continue;
    }
    if (action.op === 'clear') {
      if (cart.size) changed = true;
      cart.clear();
      messages.push('Vacié el carrito.');
      continue;
    }
    const product = byId.get(action.variantId);
    if (!product) { warnings.push('No encontré una referencia del catálogo.'); continue; }
    if (action.op === 'info') {
      messages.push(product.label + ': ' + pesos(product.unitPrice)
        + (product.stock === null ? ' (existencias por confirmar).' : ' (disponibles: ' + product.stock + ').'));
      continue;
    }
    if (action.quantity < 1 || action.quantity > 100) { warnings.push('Cantidad no válida para ' + product.label + '.'); continue; }
    const existing = cart.get(product.variantId)?.quantity || 0;
    const updated = action.op === 'add' ? existing + action.quantity
      : action.op === 'remove' ? Math.max(0, existing - action.quantity) : action.quantity;
    if (updated > 1000 || (product.stock !== null && updated > product.stock)) {
      warnings.push('No hay inventario suficiente para ' + product.label + '.');
      continue;
    }
    if (updated>0 && existing===0 && cart.size>=40){
      warnings.push('El carrito admite máximo 40 referencias.');
      continue;
    }
    if (updated === 0) cart.delete(product.variantId);
    else cart.set(product.variantId, { ...product, quantity: updated });
    changed = changed || updated !== existing;
    messages.push((action.op === 'remove' ? 'Quité ' : action.op === 'set' ? 'Ajusté ' : 'Agregué ')
      + action.quantity + ' × ' + product.label + '.');
  }
  if (proposal.uncertain) warnings.push('No reconocí toda la solicitud; indica la referencia exacta.');
  const lines = [...cart.values()];
  const subtotal = lines.reduce((sum, x) => sum + x.unitPrice * x.quantity, 0);
  if (!Number.isFinite(subtotal) || subtotal > 999999999999) throw new Error('Total fuera de límite.');
  const reply = [
    ...messages, ...warnings,
    lines.length ? 'Subtotal actual: ' + pesos(subtotal) + ' (sin envío).'
      : 'El carrito está vacío.',
    changed ? 'Revisa el carrito y confirma el pedido cuando esté correcto.' : '',
  ].filter(Boolean).join(' ');
  return { cart: lines, subtotal, reply, changed, warnings, requiresConfirmation: true };
}
