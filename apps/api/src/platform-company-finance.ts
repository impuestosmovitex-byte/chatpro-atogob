/** Company financial entries are monthly manual records, never actual tenant entitlements. */
export type FinanceCompanySource='operational'|'staging';
export const DIRECT_FIELDS=['billedCop','receivedCop','openaiCop','supportCop','onboardingCop','otherDirectCop'] as const;
export type FinanceCompanyEntry={
 periodMonth:string;companySource:FinanceCompanySource;companySlug:string;
 billedCop:number|null;receivedCop:number|null;openaiCop:number|null;
 supportCop:number|null;onboardingCop:number|null;otherDirectCop:number|null;
 allocationWeight:number;includeInAllocation:boolean;evidenceNote:string;
};
export function validateFinanceCompanyEntry(raw:unknown):FinanceCompanyEntry{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Registro de empresa inválido.');
 const o=raw as Record<string,unknown>;
 const keys=new Set<string>(['periodMonth','companySource','companySlug','allocationWeight','includeInAllocation','evidenceNote',...DIRECT_FIELDS]);
 if(Object.keys(o).some(k=>!keys.has(k)))throw Error('Campo de empresa no permitido.');
 if(typeof o.periodMonth!=='string'||!/^20[2-9][0-9]-(0[1-9]|1[0-2])-01$/.test(o.periodMonth))
  throw Error('Mes no válido.');
 if(o.companySource!=='operational'&&o.companySource!=='staging')
  throw Error('Origen de empresa no válido.');
 if(typeof o.companySlug!=='string'||!/^[a-z0-9][a-z0-9-]{1,79}$/.test(o.companySlug))
  throw Error('Empresa no válida.');
 if(typeof o.allocationWeight!=='number'||!Number.isFinite(o.allocationWeight)||
    o.allocationWeight<=0||o.allocationWeight>1000||Math.round(o.allocationWeight*1000)!==o.allocationWeight*1000)
  throw Error('Peso de distribución inválido.');
 if(typeof o.includeInAllocation!=='boolean')throw Error('Asignación de costos inválida.');
 if(typeof o.evidenceNote!=='string'||o.evidenceNote.length>1000)
  throw Error('Nota financiera inválida.');
 for(const key of DIRECT_FIELDS){
  const amount=o[key];
  if(amount!==null&&(typeof amount!=='number'||!Number.isFinite(amount)||amount<0||amount>1000000000))
   throw Error('Monto financiero inválido: '+key);
 }
 return o as FinanceCompanyEntry;
}
/** Unknown amounts always make a complete profit calculation unavailable. */
export function companyFinancialResult(
 record:Pick<FinanceCompanyEntry,typeof DIRECT_FIELDS[number]>,
 allocatedShared:number|null,
){
 const direct=[record.openaiCop,record.supportCop,record.onboardingCop,record.otherDirectCop];
 const directKnown=direct.every(n=>n!==null);
 const directCost=directKnown?direct.reduce<number>((sum,n)=>sum+(n??0),0):null;
 const allKnown=record.billedCop!==null&&directCost!==null&&allocatedShared!==null;
 const contribution=allKnown?record.billedCop!-directCost!-allocatedShared!:null;
 return {directCost,allocatedShared,contribution,
   marginPct:contribution!==null&&record.billedCop!>0?contribution/record.billedCop!*100:null,
   collected:record.receivedCop};
}
