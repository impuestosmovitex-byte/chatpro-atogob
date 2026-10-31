/** MW1 billing calculation only: never triggers provider operations. */
export type BillingPhase = {cycle:number;amountCop:number;discountPercent:0|50};
export function nextVerifiedBillingPhase(baseMonthlyCop:number,verifiedPaidCycles:number,introductoryDiscountUsed:boolean):BillingPhase {
 if(!Number.isSafeInteger(baseMonthlyCop)||baseMonthlyCop<=0)throw new Error('Tarifa inválida.');
 if(!Number.isSafeInteger(verifiedPaidCycles)||verifiedPaidCycles<0)throw new Error('Ciclos inválidos.');
 const cycle=verifiedPaidCycles+1;
 const discounted=cycle===2&&!introductoryDiscountUsed;
 return {cycle,amountCop:discounted?Math.round(baseMonthlyCop/2):baseMonthlyCop,discountPercent:discounted?50:0};
}
/** Persist confirmed cycle and one-time promotion in one transaction on verified provider events only.
 * Calling this function is never sufficient proof of payment. */
