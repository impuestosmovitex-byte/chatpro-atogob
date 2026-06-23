import { Controller, Get } from '@nestjs/common';
import { ShopifyService } from './shopify.service';

@Controller()
export class AppController {
  constructor(private readonly shopifyService: ShopifyService) {}

  @Get()
  getStatus() {
    return {
      ok: true,
      service: 'Chat Pro API',
    };
  }

  @Get('catalog-test')
  async catalogTest() {
    try {
      const products = await this.shopifyService.getRecentProducts();

      return {
        ok: true,
        count: products.length,
        products,
      };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Error desconocido al consultar Shopify.',
      };
    }
  }
}