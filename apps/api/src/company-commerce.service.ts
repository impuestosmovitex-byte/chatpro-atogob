import { Injectable } from '@nestjs/common';
import { CompanyIntegrationService } from './company-integration.service';
import {
  CompanyShopifyService,
  type CompanyCommerceCartLineInput,
} from './company-shopify.service';

@Injectable()
export class CompanyCommerceService {
  constructor(
    private readonly companyShopifyService: CompanyShopifyService,
    private readonly companyIntegrationService: CompanyIntegrationService,
  ) {}

  async isEnabled(companyId: string): Promise<boolean> {
    const integration =
      await this.companyIntegrationService.getActiveIntegration(
        companyId,
        'shopify',
        'store',
      );

    return integration?.credentialMode === 'encrypted';
  }

  async searchProducts(
    companyId: string,
    searchText = '',
    limit = 8,
  ) {
    return this.companyShopifyService.searchCommerceProducts(
      companyId,
      searchText,
      limit,
    );
  }

  async getProductByHandle(companyId: string, handle: string) {
    return this.companyShopifyService.getCommerceProductByHandle(
      companyId,
      handle,
    );
  }

  async createCheckoutLink(
    companyId: string,
    lines: CompanyCommerceCartLineInput[],
  ) {
    return this.companyShopifyService.buildCommerceCartLinks(
      companyId,
      lines,
    );
  }
}
