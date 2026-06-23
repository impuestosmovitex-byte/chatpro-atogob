import { Controller, Get, Query } from '@nestjs/common';
import { AiService } from './ai.service';
import { ShopifyService } from './shopify.service';

@Controller()
export class AppController {
  constructor(
    private readonly shopifyService: ShopifyService,
    private readonly aiService: AiService,
  ) {}

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

  @Get('catalog-search')
  async catalogSearch(@Query('q') q = '') {
    const search = q.trim();

    if (!search) {
      return {
        ok: false,
        error: 'Envía una búsqueda usando ?q=...',
      };
    }

    try {
      const products = await this.shopifyService.searchCatalog(search);

      return {
        ok: true,
        query: search,
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

  @Get('collections-test')
  async collectionsTest() {
    try {
      const collections = await this.shopifyService.getCollections();

      return {
        ok: true,
        count: collections.length,
        collections,
      };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Error desconocido al consultar colecciones.',
      };
    }
  }

  @Get('ai-test')
  async aiTest(@Query('q') q = '') {
    const message = q.trim();

    if (!message) {
      return {
        ok: false,
        error: 'Envía un mensaje usando ?q=...',
      };
    }

    try {
      const reply = await this.aiService.answerSalesQuestion(message);

      return {
        ok: true,
        message,
        reply,
      };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Error desconocido al consultar la IA.',
      };
    }
  }
}