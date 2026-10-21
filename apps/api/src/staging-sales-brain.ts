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
      if (part.endsWith('es') && part.length > 5 && !part.endsWith('ces')) return part.slice(0, -2);
      if (part.endsWith('s') && part.length > 4) return part.slice(0, -1);
      return part;
    });
}
const core = (value: string) => tokens(value).filter(x => !stopwords.has(x) && !(x in numberWords) && !/^\d+$/.test(x));
const pesos = (price: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(price);

export function inferSalesProposal(message: string, products: CatalogItem[]): Proposal {
  const normalized = message.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
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
    const words = tokens(chunk);
    const clean = core(chunk);
    if (!clean.length) { uncertain = true; continue; }
    const matches = products.map(item => {
      const itemCore = core(item.label);
      const intersection = itemCore.filter(token => clean.includes(token)).length;
      return { item, full: itemCore.length > 0 && intersection === itemCore.length, score: intersection };
    }).filter(x => x.score > 0);
    if (!matches.length) { uncertain = true; continue; }
    const maxFull = matches.some(x => x.full);
    const candidates = matches.filter(x => x.full === maxFull);
    const bestScore = Math.max(...candidates.map(x => x.score));
    const best = candidates.filter(x => x.score === bestScore);
    if (best.length !== 1) { uncertain = true; continue; }
    let quantity = 1;
    for (const word of words) {
      if (/^\d{1,3}$/.test(word)) { quantity = Number(word); break; }
      if (word in numberWords) { quantity = numberWords[word]; break; }
    }
    if (quantity < 1 || quantity > 100) { uncertain = true; continue; }
    actions.push({ op, variantId: best[0].item.variantId, quantity });
  }
  return { actions: actions.slice(0, 12), uncertain };
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
