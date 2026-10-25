import {nextVerifiedBillingPhase} from './mw1-billing-promotion';

/** Read-only billing safety decision. Never updates a Mercado Pago subscription. */
export function assessMW1RenewalSafety(input:{
 baseMonthlyAmountCop:number;verifiedPaidCycles:number;introductoryDiscountUsed:boolean;
 providerAmountCop:number;nextPaymentDate:string|null;now?:Date;
}){
 const expected=nextVerifiedBillingPhase(input.baseMonthlyAmountCop,input.verifiedPaidCycles,input.introductoryDiscountUsed);
 const providerAmountValid=Number.isSafeInteger(input.providerAmountCop)&&input.providerAmountCop>0;
 const amountMatches=providerAmountValid&&input.providerAmountCop===expected.amountCop;
 const parsed=input.nextPaymentDate?Date.parse(input.nextPaymentDate):NaN;
 const validNextPaymentDate=Number.isFinite(parsed)&&parsed>Date.now();
 const hoursBeforeCharge=validNextPaymentDate?(parsed-(input.now??new Date()).getTime())/3600000:null;
 const safeLeadTime=hoursBeforeCharge!==null&&hoursBeforeCharge>=72;
 const reasons:string[]=[];
 if(!providerAmountValid)reasons.push('provider_amount_unknown');
 if(!amountMatches)reasons.push('provider_amount_does_not_match_next_cycle');
 if(!validNextPaymentDate)reasons.push('next_payment_date_unverified');
 if(!safeLeadTime)reasons.push('insufficient_prebilling_validation_window');
 // Matching amounts is not sufficient to start billing. Update+confirmation automation
 // and end-to-end tests must be independently approved.
 return {cycle:expected.cycle,expectedAmountCop:expected.amountCop,
  discountPercent:expected.discountPercent,providerAmountCop:input.providerAmountCop,
  amountMatches,safeLeadTime,reasons,automaticBillingApproved:false,providerUpdatePerformed:false};
}
