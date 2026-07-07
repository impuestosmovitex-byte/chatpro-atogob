import { Injectable } from '@nestjs/common';
import {
  CompanyShopifyService,
  type CompanyCommerceCartLineInput,
} from './company-shopify.service';

@Injectable()
export class CompanyCommerceService {
  constructor(
    private readonly companyShopifyService: CompanyShopifyService,
  ) {}

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
