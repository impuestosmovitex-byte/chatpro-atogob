/**
 * Staging-only, deterministic shopping request recognizer.
 * NOT an AI model. Only recognizes names visible in the merchant catalog.
 * It never assigns a price or creates an order.
 */
export type CatalogChoice = {
  variantId: string;
  label: string;
  unitPrice: number;
  stock: number | null;
};

export type ParsedCatalogLine = {
  variantId: string;
  label: string;
  quantity: number;
  unitPrice: number;
};

export type ParseResult = {
  lines: ParsedCatalogLine[];
  unmatched: string[];
  ambiguous: string[];
};

const NUMBER_WORDS: Record<string, number> = {
  un:1, una:1, uno:1, dos:2, tres:3, cuatro:4, cinco:5,
  seis:6, siete:7, ocho:8, nueve:9, diez:10,
};

export function normalizeWord(value: string): string {
  const word = value.toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g,'');
  if (word === 'panes') return 'pan';
  if (word.endsWith('s') && word.length > 3) return word.slice(0,-1);
  return word;
}

function words(value: string): string[] {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .split(/[^a-z0-9]+/g).filter(Boolean).map(normalizeWord);
}

function quantityBefore(segment: string, start: number): number {
  const prefix=words(segment.slice(0,start)).slice(-4);
  for(let i=prefix.length-1;i>=0;i--){
    const part=prefix[i];
    if (/^[0-9]{1,3}$/.test(part)) return Number(part);
    if (NUMBER_WORDS[part]!==undefined) return NUMBER_WORDS[part];
  }
  return 1;
}

export function parseCatalogRequest(
  message: string,
  catalog: CatalogChoice[],
): ParseResult {
  const result: ParseResult={lines:[],unmatched:[],ambiguous:[]};
  if (!message.trim()) return result;

  const segments=message.split(/[,;]|\s+y\s+|\s+ademas\s+/i).map(x=>x.trim()).filter(Boolean);
  for (const segment of segments) {
    const segmentWords=words(segment);
    const candidates: Array<{item:CatalogChoice;start:number;length:number}> = [];
    for(const item of catalog){
      const nameWords=words(item.label).filter(Boolean);
      if (!nameWords.length) continue;
      for(let start=0;start<=segmentWords.length-nameWords.length;start++){
        if(nameWords.every((w,i)=>segmentWords[start+i]===w)){
          candidates.push({item,start,length:nameWords.length});
          break;
        }
      }
    }

    if(candidates.length===0){
      result.unmatched.push(segment);
      continue;
    }
    const maxLength=Math.max(...candidates.map(x=>x.length));
    const winning=candidates.filter(x=>x.length===maxLength);
    // Never guess if the same phrase could refer to two distinct variants.
    if(winning.length!==1){
      result.ambiguous.push(segment);
      continue;
    }
    const target=winning[0];
    const phraseBefore=segmentWords.slice(0,target.start).join(' ');
    const quantity=quantityBefore(phraseBefore,phraseBefore.length);
    if(!Number.isInteger(quantity)||quantity<1||quantity>100){
      result.unmatched.push(segment);
      continue;
    }
    result.lines.push({
      variantId:target.item.variantId,label:target.item.label,
      quantity,unitPrice:target.item.unitPrice,
    });
  }
  return result;
}
