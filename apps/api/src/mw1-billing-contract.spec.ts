import {nextVerifiedBillingPhase} from './mw1-billing-promotion';
import {assessMW1RenewalSafety} from './mw1-billing-renewal-safety';
import {auditBillingContract} from './mw1-billing-contract-audit';
import {evaluateMW1ActivationReadiness} from './mw1-billing-activation-readiness';
import {validateMW1Payment} from './mw1-mercadopago-payment-verification';
import {extractAccreditedInvoicePayment} from './mw1-mercadopago-invoice-verification';

describe('MW1 Mercado Pago staging billing invariants',()=>{
 test.each([[149000,74500],[259000,129500],[599000,299500]])('discount applies only to second month for %i', (base,half)=>{
  expect(nextVerifiedBillingPhase(base,0,false).amountCop).toBe(base);
  expect(nextVerifiedBillingPhase(base,1,false)).toMatchObject({cycle:2,amountCop:half,discountPercent:50});
  expect(nextVerifiedBillingPhase(base,2,true)).toMatchObject({cycle:3,amountCop:base,discountPercent:0});
  expect(nextVerifiedBillingPhase(base,3,true).amountCop).toBe(base);
 });
 test('does not activate a tenant from unverified authorization',()=>{
  const result=evaluateMW1ActivationReadiness({subscriptionId:'12345678-1234-1234-1234-123456789abc',
   companyId:'12345678-1234-1234-1234-123456789abd',providerSubscriptionId:'1234567890',
   subscriptionStatus:'pending',verifiedPaidCycles:1,approvedPaymentCount:1,providerAuthorizationConfirmed:false});
  expect(result.eligible).toBe(false);
  expect(result.reasons).toContain('provider_authorization_not_confirmed');
  expect(result.willActivate).toBe(false);
 });
 test('never treats a signed webhook as proof of accredited payment',()=>{
  const expected={paymentId:'12345',providerSubscriptionId:'subscription-1',amountCop:259000};
  const good={id:12345,preapproval_id:'subscription-1',status:'approved',
   status_detail:'accredited',currency_id:'COP',transaction_amount:259000};
  expect(validateMW1Payment(good,expected).status).toBe('approved');
  expect(()=>validateMW1Payment({...good,status:'pending'},expected)).toThrow();
  expect(()=>validateMW1Payment({...good,transaction_amount:149000},expected)).toThrow();
  expect(()=>validateMW1Payment({...good,preapproval_id:'another'},expected)).toThrow();
 });
 test('rejects an invoice without verified payment',()=>{
  const input={id:'123',preapproval_id:'subscription-1',currency_id:'COP',transaction_amount:259000,
   payment:{id:12345,status:'approved',status_detail:'accredited'}};
  expect(extractAccreditedInvoicePayment(input,{invoiceId:'123',subscriptionId:'subscription-1',amountCop:259000}).paymentId).toBe('12345');
  expect(()=>extractAccreditedInvoicePayment({...input,payment:{id:12345,status:'pending'}},{invoiceId:'123',subscriptionId:'subscription-1',amountCop:259000})).toThrow();
 });
 test('blocks renewal if provider amount differs from discounted second cycle',()=>{
  const result=assessMW1RenewalSafety({baseMonthlyAmountCop:259000,verifiedPaidCycles:1,
   introductoryDiscountUsed:false,providerAmountCop:259000,nextPaymentDate:'2030-01-01T12:00:00Z',now:new Date('2026-10-25T20:00:00Z')});
  expect(result.expectedAmountCop).toBe(129500);
  expect(result.reasons).toContain('provider_amount_does_not_match_next_cycle');
  expect(result.automaticBillingApproved).toBe(false);
 });
 test('preflight never authorizes charges',()=>{
  const result=auditBillingContract({planKey:'pro',baseAmountCop:259000,verifiedPaidCycles:0,
   introductoryDiscountUsed:false,providerNextAmountCop:null,payerEmailConfigured:false,
   buyerIdConfigured:true,sandboxConfirmed:false,webhookSecretConfigured:true,checkoutEnabled:false});
  expect(result.chargeAuthorized).toBe(false);
  expect(result.blockers).toContain('payer_email_not_verified');
  expect(result.blockers).toContain('test_credentials_not_confirmed');
 });
});
