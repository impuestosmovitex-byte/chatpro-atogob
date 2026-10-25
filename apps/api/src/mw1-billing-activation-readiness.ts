/** Pure, staging-safe eligibility guard. Never activates a tenant. */
export type MW1ActivationReadinessInput={
 subscriptionId:string;companyId:string;providerSubscriptionId:string|null;
 subscriptionStatus:string;verifiedPaidCycles:number;
 approvedPaymentCount:number;providerAuthorizationConfirmed:boolean;
};
export function evaluateMW1ActivationReadiness(input:MW1ActivationReadinessInput){
 const reasons:string[]=[];
 if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(input.subscriptionId)||!input.companyId)
  reasons.push('subscription_identity_missing');
 if(!input.providerSubscriptionId)reasons.push('provider_subscription_missing');
 if(!['pending','awaiting_authorization','active','grace_period'].includes(input.subscriptionStatus))
  reasons.push('subscription_not_eligible');
 if(!input.providerAuthorizationConfirmed)reasons.push('provider_authorization_not_confirmed');
 if(!Number.isSafeInteger(input.verifiedPaidCycles)||input.verifiedPaidCycles<1)
  reasons.push('no_verified_billing_cycle');
 if(!Number.isSafeInteger(input.approvedPaymentCount)||input.approvedPaymentCount<1)
  reasons.push('no_approved_payment_record');
 if(input.approvedPaymentCount<input.verifiedPaidCycles)
  reasons.push('billing_cycle_ledger_mismatch');
 return {eligible:reasons.length===0,reasons,willActivate:false};
}
