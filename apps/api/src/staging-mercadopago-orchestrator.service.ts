import { Injectable } from '@nestjs/common';
import { StagingMerchantPaymentCredentialsService } from './staging-merchant-payment-credentials.service';
import { createMercadoPagoSandboxOrder } from './staging-mercadopago-sandbox-client';
import type { MerchantOrderInput } from './staging-mercadopago-order-draft';

/** Server-only orchestration. No controller calls this until merchant onboarding
 * and provider webhook reconciliation have been exercised in staging.
 */
@Injectable()
export class StagingMercadoPagoOrchestratorService {
  constructor(private readonly credentials:StagingMerchantPaymentCredentialsService){}

  async createSandboxCheckout(input:MerchantOrderInput,verification:{
    authorizedTenant:boolean;
    orderMatchesTenant:boolean;
    orderEligible:boolean;
    attemptMatchesOrder:boolean;
  }) {
    if(process.env.MW1_STAGING_MODE!=='true' ||
       process.env.MW1_MP_SANDBOX_ORDERS_ENABLED!=='true' ||
       !verification.authorizedTenant || !verification.orderMatchesTenant ||
       !verification.orderEligible || !verification.attemptMatchesOrder) {
      throw new Error('Checkout de prueba no autorizado.');
    }
    const merchant=await this.credentials.resolveMercadoPago(input.companyId);
    // Token remains server-side and is never returned in API results.
    return createMercadoPagoSandboxOrder(input,merchant.accessToken,{
      merchantConnectionVerified:true,sandboxOnly:true,
    });
  }
}
