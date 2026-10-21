/**
 * Refinement of a previously authorized visual shortlist, inside the staging
 * simulator. Results only narrow choices; this never edits the shopping cart.
 * Catalog suggestions still require an explicit button press.
 */
export type VisualChoice = { variantId: string; label: string };

const COLOR_WORDS: Record<string,string> = {
  negro:'negro', negra:'negro', blanco:'blanco', blanca:'blanco',
  rojo:'rojo', roja:'rojo', azul:'azul', verde:'verde', gris:'gris',
  beige:'beige', arena:'arena', cafe:'cafe', marron:'marron',
  rosa:'rosa', rosado:'rosa', rosada:'rosa', vinotinto:'vinotinto',
  amarillo:'amarillo', amarilla:'amarillo', lila:'lila',
  morado:'morado', morada:'morado', fucsia:'fucsia',
};
function normalize(text:string):string {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}
function words(text:string):string[] {
  return normalize(text).split(/[^a-z0-9]+/).filter(Boolean);
}
const ORDINALS:Record<string,number>={
  primero:0,primera:0,segundo:1,segunda:1,tercero:2,tercera:2,
};
export type VisualRefinement = {
  handled:boolean;
  choices:VisualChoice[];
  reply:string;
};

/**
 * Important: "la talla 8" cannot become "eight units".  "el de la izquierda"
 * cannot be resolved from shortlist order, which is not a spatial coordinate.
 */
export function refineVisualChoices(
  userText:string,
  choices:VisualChoice[],
):VisualRefinement {
  const text=normalize(userText.trim().slice(0,450));
  if(!text||!choices.length) return {handled:false,choices,reply:''};
  const t=words(text);
  const size=/\b(?:talla|size|tamano)\s*(?:numero|nro|#)?\s*(xs|xxxl|xxl|xl|s|m|l|\d{1,3})\b/.exec(text)?.[1]||null;
  const colors=[...new Set(t.map(w=>COLOR_WORDS[w]).filter((w):w is string=>Boolean(w)))];
  const ordinal=t.map(w=>ORDINALS[w]).find((n):n is number=>n!==undefined);
  const numericOption=/\b(?:opcion|op|numero)\s*(?:#)?\s*([1-3])\b/.exec(text);
  const rank=ordinal??(numericOption?Number(numericOption[1])-1:null);
  const unresolvedSpatial=/\b(izquierda|derecha|centro|arriba|abajo)\b/.test(text);
  const referring=/\b(este|esta|ese|esa|aquel|aquella|quiero|llevar|me gusta|el|la|foto|imagen)\b/.test(text);
  const relevant=Boolean(size||colors.length||rank!==null||unresolvedSpatial||
    (referring && /\b(este|esta|ese|esa|aquel|aquella|foto|imagen)\b/.test(text)));
  if(!relevant)return {handled:false,choices,reply:''};
  if(unresolvedSpatial && rank===null && !size && !colors.length){
    return {handled:true,choices,reply:
      'No puedo determinar cuál es el de la izquierda o derecha solo por el orden de estas sugerencias. Dime la opción 1, 2 o 3, o el color y la talla.'};
  }
  const subset=choices.filter((choice,i)=>{
    if(rank!==null&&i!==rank)return false;
    const candidate=words(choice.label);
    if(size && !candidate.includes(size))return false;
    if(colors.length && !colors.every(color=>candidate.some(w=>COLOR_WORDS[w]===color)))return false;
    return true;
  });
  if(!subset.length){
    return {handled:true,choices,reply:
      'No encontré esa talla, color u opción entre las coincidencias de la foto. No cambié el carrito; puedes elegir otra referencia o tomar una foto más clara.'};
  }
  if(subset.length>1){
    return {handled:true,choices:subset,reply:
      'Encontré '+subset.length+' referencias posibles. Confírmame la talla, color o número de opción. No he agregado ningún producto.'};
  }
  return {handled:true,choices:subset,reply:
    'Encontré esta referencia entre las sugerencias de la foto: '+subset[0].label+
    '. Revisa el precio y el inventario, y pulsa «Agregar» si es la correcta. No he cambiado el carrito.'};
}
