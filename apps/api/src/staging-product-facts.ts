/**
 * Product facts authored by the merchant, never inferred from customer messages
 * or catalog photography. Used only by isolated MW1 staging commerce.
 *
 * The underlying table already has description and metadata JSONB columns,
 * so no schema changes are necessary to trial this feature.
 */
export const PRODUCT_FACT_LIMITS = {
  description: 1200,
  material: 250,
  composition: 350,
  measurements: 550,
  ingredients: 700,
  allergens: 300,
  care: 450,
  details: 550,
} as const;

export type ProductFacts = {
  [K in keyof typeof PRODUCT_FACT_LIMITS]: string;
};

const keys = Object.keys(PRODUCT_FACT_LIMITS) as (keyof ProductFacts)[];

export function emptyProductFacts(): ProductFacts {
  return {
    description:'',material:'',composition:'',measurements:'',
    ingredients:'',allergens:'',care:'',details:'',
  };
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  // No hidden control characters, multiline whitespace preserved as spaces.
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g,' ').trim().slice(0,max);
}
export function readProductFacts(description: unknown, metadata: unknown): ProductFacts {
  const info = metadata && typeof metadata==='object'&&!Array.isArray(metadata)
    ? metadata as Record<string,unknown> : {};
  const stored = info.mw1ProductFacts && typeof info.mw1ProductFacts==='object' &&
    !Array.isArray(info.mw1ProductFacts)
    ? info.mw1ProductFacts as Record<string,unknown> : {};
  const result=emptyProductFacts();
  for(const key of keys){
    result[key]=text(key==='description'?description:stored[key],PRODUCT_FACT_LIMITS[key]);
  }
  return result;
}
export function validateProductFacts(input: unknown): ProductFacts {
  if(!input || typeof input!=='object'||Array.isArray(input)){
    throw new Error('La ficha del producto no tiene un formato válido.');
  }
  const record=input as Record<string,unknown>;
  for(const key of Object.keys(record)){
    if(!keys.includes(key as keyof ProductFacts)){
      throw new Error('La ficha contiene un campo no permitido.');
    }
  }
  const result=emptyProductFacts();
  for(const key of keys){
    const value=record[key];
    if(typeof value!=='string'||value.length>PRODUCT_FACT_LIMITS[key]*2){
      throw new Error('El campo '+key+' debe ser texto de longitud permitida.');
    }
    const cleaned=text(value,PRODUCT_FACT_LIMITS[key]+1);
    if(cleaned.length>PRODUCT_FACT_LIMITS[key]){
      throw new Error('La información de '+key+' es demasiado extensa.');
    }
    result[key]=cleaned;
  }
  return result;
}
/** Preserve third-party metadata; only this dedicated namespace is editable. */
export function writeProductFactsMetadata(
  metadata: unknown,
  facts: ProductFacts,
): Record<string, unknown> {
  const existing=metadata && typeof metadata==='object'&&!Array.isArray(metadata)
    ? metadata as Record<string,unknown> : {};
  const {description,...fields}=facts;
  return {...existing,mw1ProductFacts:fields};
}

const normalized=(value:string)=>value.toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'');
export type ProductFactAnswer={
  answer:string;
  requested:(keyof ProductFacts)[];
  missing:(keyof ProductFacts)[];
};

/**
 * Read-only answer. In absence of merchant data, state the precise unknown.
 * Never assert fit, ingredients, fabric, guarantees or measurements from image
 * guesses. Facts are quoted as merchant-authored, not product certifications.
 */
export function answerProductFacts(message:string,facts:ProductFacts):ProductFactAnswer|null{
  const query=normalized(message);
  const wants=new Set<keyof ProductFacts>();
  if(/\b(material|materiales|tela|telas|tejido|tejidos)\b/.test(query))wants.add('material');
  if(/\b(composicion|porcentaje|porcentajes|fabricado|fabricada)\b/.test(query))wants.add('composition');
  if(/\b(medida|medidas|centimetro|centimetros|guia de talla|largo|ancho)\b/.test(query))wants.add('measurements');
  if(/\b(ingrediente|ingredientes|contiene|contenido)\b/.test(query))wants.add('ingredients');
  if(/\b(alergeno|alergenos|alergia|alergias|gluten|lactosa)\b/.test(query))wants.add('allergens');
  if(/\b(lavar|lavado|cuidado|cuidados|limpieza|conservar)\b/.test(query))wants.add('care');
  if(/\b(detalle|detalles|caracteristica|caracteristicas|descripcion|describe)\b/.test(query)){
    wants.add('details');wants.add('description');
  }
  if(!wants.size)return null;
  const requested=[...wants];
  const labels:Record<keyof ProductFacts,string>={
    description:'Descripción',material:'Material',composition:'Composición',
    measurements:'Medidas',ingredients:'Ingredientes',
    allergens:'Alérgenos',care:'Cuidados',details:'Características',
  };
  const known=requested.filter(key=>facts[key]);
  const missing=requested.filter(key=>!facts[key]);
  const snippets=known.map(key=>labels[key]+': '+facts[key]+'.');
  if(missing.length)snippets.push('La tienda no ha registrado información de '+
    missing.map(key=>labels[key].toLowerCase()).join(' y ')+
    ' en esta ficha; confírmala con un asesor antes de comprar.');
  return {
    answer:snippets.join(' ')+' Información proporcionada por el comercio; consulta el detalle si necesitas una confirmación.',
    requested,missing,
  };
}
