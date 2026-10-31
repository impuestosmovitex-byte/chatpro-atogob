import {nextVerifiedBillingPhase} from './mw1-billing-promotion';

export type BillingAuditInput={
 planKey:string;baseAmountCop:number;verifiedPaidCycles:number;
 introductoryDiscountUsed:boolean;providerNextAmountCop:number|null;
 payerEmailConfigured:boolean;buyerIdConfigured:boolean;sandboxConfirmed:boolean;
 webhookSecretConfigured:boolean;checkoutEnabled:boolean;
};
export function auditBillingContract(input:BillingAuditInput){
 const blockers:string[]=[];
 if(!['inicial','pro','empresa'].includes(input.planKey))blockers.push('unknown_plan');
 if(!input.buyerIdConfigured)blockers.push('test_buyer_not_identified');
 if(!input.payerEmailConfigured)blockers.push('payer_email_not_verified');
 if(!input.sandboxConfirmed)blockers.push('test_credentials_not_confirmed');
 if(!input.webhookSecretConfigured)blockers.push('webhook_secret_missing');
 if(!input.checkoutEnabled)blockers.push('test_checkout_disabled');
 const next=nextVerifiedBillingPhase(input.baseAmountCop,input.verifiedPaidCycles,input.introductoryDiscountUsed);
 if(input.providerNextAmountCop!==null&&input.providerNextAmountCop!==next.amountCop)
  blockers.push('provider_renewal_amount_mismatch');
 // This is a read-only preflight, not an authorization to collect money.
 return {planKey:input.planKey,firstMonthCop:input.baseAmountCop,
  secondMonthCop:Math.round(input.baseAmountCop/2),
  thirdMonthCop:input.baseAmountCop,
  nextCycle:next.cycle,nextExpectedCop:next.amountCop,
  discountPercent:next.discountPercent,blockers,
  chargeAuthorized:false,tenantActivationAuthorized:false};
}
