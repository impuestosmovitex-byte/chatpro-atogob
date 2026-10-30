/**
 * MW1 checkout method registry — staging foundation.
 * This module only describes supported provider capabilities.
 * No payment can be charged or marked paid through this module.
 * Never trust prices, merchant IDs, payment links or payment status from AI/chat.
 */
export type PaymentProvider = 'mercado_pago' | 'bold' | 'addi' | 'sistecredito' | 'bank_transfer';
export type PaymentMethod = 'card' | 'pse' | 'credit_financing' | 'transfer';
export type CheckoutCapability = 'hosted_checkout' | 'merchant_instruction';
export type PaymentOption = Readonly<{
  id: string;
  provider: PaymentProvider;
  label: string;
  method: PaymentMethod;
  capability: CheckoutCapability;
  integrationStatus: 'planned';
}>;

export const PAYMENT_OPTIONS: readonly PaymentOption[] = [
  {id:'mercadopago_card',provider:'mercado_pago',label:'Tarjeta — Mercado Pago',method:'card',capability:'hosted_checkout',integrationStatus:'planned'},
  {id:'mercadopago_pse',provider:'mercado_pago',label:'PSE — Mercado Pago',method:'pse',capability:'hosted_checkout',integrationStatus:'planned'},
  {id:'bold_card',provider:'bold',label:'Tarjeta — Bold',method:'card',capability:'hosted_checkout',integrationStatus:'planned'},
  {id:'bold_pse',provider:'bold',label:'PSE — Bold',method:'pse',capability:'hosted_checkout',integrationStatus:'planned'},
  {id:'addi',provider:'addi',label:'Addi',method:'credit_financing',capability:'hosted_checkout',integrationStatus:'planned'},
  {id:'sistecredito',provider:'sistecredito',label:'Sistecrédito',method:'credit_financing',capability:'hosted_checkout',integrationStatus:'planned'},
  {id:'transfer',provider:'bank_transfer',label:'Transferencia bancaria',method:'transfer',capability:'merchant_instruction',integrationStatus:'planned'},
] as const;

/**
 * Deliberately returns no public methods until a tenant's authorized
 * integration is enabled and individually verified by its provider adapter.
 */
export function enabledPaymentOptions(
  configured: readonly {provider:PaymentProvider;verified:boolean;enabled:boolean}[],
): PaymentOption[] {
  const active=new Set(configured.filter(c=>c.verified&&c.enabled).map(c=>c.provider));
  return PAYMENT_OPTIONS.filter(o=>active.has(o.provider) && o.integrationStatus!=='planned');
}

export type PaymentState = 'pending' | 'requires_action' | 'approved' | 'rejected' | 'expired' | 'refunded';
export type PaymentEvent = Readonly<{
  companyId:string;
  orderId:string;
  provider:PaymentProvider;
  externalPaymentId:string;
  amountMinor:number;
  currency:string;
  state:PaymentState;
}>;

/** No optimistic paid transitions; only provider-signed/verified backend events. */
export function canConfirmPayment(input:{
  verifiedProviderEvent:boolean;
  tenantMatches:boolean;
  orderMatches:boolean;
  amountMatches:boolean;
  currencyMatches:boolean;
  event:PaymentEvent;
}):boolean{
  return input.verifiedProviderEvent && input.tenantMatches && input.orderMatches &&
    input.amountMatches && input.currencyMatches && input.event.state==='approved';
}
