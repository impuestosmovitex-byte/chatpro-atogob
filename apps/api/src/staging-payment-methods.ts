// Staging payment provider catalog. No live collection paths are enabled.
export const MW1_PAYMENT_METHODS = Object.freeze([
  {id:'mercadopago_card',provider:'mercado_pago',label:'Tarjeta — Mercado Pago',method:'card'},
  {id:'mercadopago_pse',provider:'mercado_pago',label:'PSE — Mercado Pago',method:'pse'},
  {id:'bold_card',provider:'bold',label:'Tarjeta — Bold',method:'card'},
  {id:'bold_pse',provider:'bold',label:'PSE — Bold',method:'pse'},
  {id:'addi',provider:'addi',label:'Addi',method:'financing'},
  {id:'sistecredito',provider:'sistecredito',label:'Sistecrédito',method:'financing'},
  {id:'transfer',provider:'bank_transfer',label:'Transferencia',method:'transfer'},
] as const);

export function stagingPaymentMethods() {
  return MW1_PAYMENT_METHODS.map(option=>({
    ...option,enabled:false,status:'pending_integration' as const,
  }));
}

// The provider must be verified server-side, and the tenant must own the
// credentials. Never rely on merchant-supplied flags or a customer message.
export function isPaymentMethodAvailable(input: {
  tenantVerified: boolean;
  providerConnected: boolean;
  providerEnabled: boolean;
  orderTenantMatches: boolean;
  amountVerified: boolean;
}): boolean {
  return input.tenantVerified && input.providerConnected &&
    input.providerEnabled && input.orderTenantMatches && input.amountVerified;
}