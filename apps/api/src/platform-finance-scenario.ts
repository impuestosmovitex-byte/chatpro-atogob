/** Staging-only forecast. Never a billing ledger or a company entitlement. */
export type FinanceScenario={
 counts:[number,number,number]; prices:[number,number,number];
 railway:number;supabase:number;otherFixed:number;supportPerCompany:number;
 openAiPerCompany:number;fxRate:number;usdOpenAi:boolean;
 technicianMonthly:number;administrationMonthly:number;marketingMonthly:number;toolsMonthly:number;
 newCustomers:number;onboardingCostPerCustomer:number;onboardingFeePerCustomer:number;
 paymentProcessingPercent:number;targetMarginPercent:number;
};
const moneyKeys=[
 'railway','supabase','otherFixed','supportPerCompany','openAiPerCompany',
 'technicianMonthly','administrationMonthly','marketingMonthly','toolsMonthly',
 'onboardingCostPerCustomer','onboardingFeePerCustomer'
] as const;
const scenarioKeys=new Set<string>(['counts','prices','fxRate','usdOpenAi','newCustomers',
 'paymentProcessingPercent','targetMarginPercent',...moneyKeys]);
export function validateFinanceScenario(value:unknown):FinanceScenario{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Escenario inválido.');
 const o=value as Record<string,unknown>;
 if(Object.keys(o).some(k=>!scenarioKeys.has(k)))throw Error('Campo financiero no permitido.');
 for(const key of ['counts','prices'] as const){
  const list=o[key];
  if(!Array.isArray(list)||list.length!==3||
     list.some(n=>typeof n!=='number'||!Number.isSafeInteger(n)||n<0||
      n>(key==='counts'?100000:100000000)))throw Error('Planes, cantidades o precios inválidos.');
 }
 for(const key of moneyKeys){
  const n=o[key];if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>1000000000)
   throw Error('Monto financiero inválido: '+key);
 }
 if(typeof o.fxRate!=='number'||!Number.isFinite(o.fxRate)||o.fxRate<100||o.fxRate>100000)
  throw Error('Tipo de cambio inválido.');
 if(typeof o.usdOpenAi!=='boolean')throw Error('Moneda de IA inválida.');
 if(typeof o.newCustomers!=='number'||!Number.isSafeInteger(o.newCustomers)||o.newCustomers<0||o.newCustomers>100000)
  throw Error('Nuevos clientes inválidos.');
 for(const key of ['paymentProcessingPercent','targetMarginPercent'] as const){
  if(typeof o[key]!=='number'||!Number.isFinite(o[key])||o[key]<0||
      o[key]>(key==='targetMarginPercent'?90:30))throw Error('Porcentaje inválido: '+key);
 }
 return o as FinanceScenario;
}
export const FINANCE_ACTUAL_KEYS=[
 'receivedCop','railwayCop','supabaseCop','openaiCop','technicalSupportCop',
 'personnelCop','marketingCop','otherCop'
] as const;
export type FinanceActualKey=typeof FINANCE_ACTUAL_KEYS[number];
export type FinanceActualInput={periodMonth:string; evidenceNote:string}&Record<FinanceActualKey,number|null>;
export function validateFinanceActual(value:unknown):FinanceActualInput{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Registro inválido.');
 const o=value as Record<string,unknown>;
 if(Object.keys(o).some(k=>!['periodMonth','evidenceNote',...FINANCE_ACTUAL_KEYS].includes(k)))
  throw Error('Campo no permitido.');
 if(typeof o.periodMonth!=='string'||!/^(20[2-9][0-9])-(0[1-9]|1[0-2])-01$/.test(o.periodMonth))
  throw Error('Selecciona el primer día del mes (YYYY-MM-01).');
 if(typeof o.evidenceNote!=='string'||o.evidenceNote.length>1000)
  throw Error('Nota de soporte inválida.');
 for(const key of FINANCE_ACTUAL_KEYS){
  const v=o[key];
  if(v!==null&&(typeof v!=='number'||!Number.isFinite(v)||v<0||v>1000000000))
   throw Error('Monto real inválido: '+key);
 }
 return o as FinanceActualInput;
}
export function calculateFinanceScenario(s:FinanceScenario){
 const clients=s.counts.reduce((total,n)=>total+n,0);
 const recurringRevenue=s.counts.reduce((total,n,i)=>total+n*s.prices[i],0);
 const onboardingIncome=s.newCustomers*s.onboardingFeePerCustomer;
 const income=recurringRevenue+onboardingIncome;
 const fixed=s.railway+s.supabase+s.otherFixed+s.technicianMonthly+
   s.administrationMonthly+s.marketingMonthly+s.toolsMonthly;
 const aiUnit=s.usdOpenAi?s.openAiPerCompany*s.fxRate:s.openAiPerCompany;
 const variable=clients*(aiUnit+s.supportPerCompany);
 const onboardingCost=s.newCustomers*s.onboardingCostPerCustomer;
 const processingCost=income*s.paymentProcessingPercent/100;
 const costs=fixed+variable+onboardingCost+processingCost;
 const contribution=income-costs;
 const avgRecurringRevenue=clients?recurringRevenue/clients:0;
 const avgVariable=aiUnit+s.supportPerCompany+avgRecurringRevenue*s.paymentProcessingPercent/100;
 const breakEvenClients=avgRecurringRevenue>avgVariable?
   Math.ceil(fixed/(avgRecurringRevenue-avgVariable)):null;
 const targetDenominator=1-s.targetMarginPercent/100-s.paymentProcessingPercent/100;
 const minimumRevenueForTarget=targetDenominator>0?
   (fixed+variable+onboardingCost)/targetDenominator:null;
 return {clients,recurringRevenue,onboardingIncome,income,fixed,variable,onboardingCost,
  processingCost,costs,contribution,margin:income?contribution/income*100:0,
  unitCost:clients?costs/clients:0,breakEvenClients,minimumRevenueForTarget};
}
