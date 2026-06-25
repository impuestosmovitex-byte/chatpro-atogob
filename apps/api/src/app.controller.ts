import { Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { AiService } from './ai.service';
import { ConversationMemoryService } from './conversation-memory.service';
import { ShopifyService } from './shopify.service';
import { ShopifyAbandonedCheckoutSyncService } from './shopify-abandoned-checkout-sync.service';
import { SupabaseService } from './supabase.service';

@Controller()
export class AppController {
  constructor(
    private readonly shopifyService: ShopifyService,
    private readonly shopifyAbandonedCheckoutSyncService: ShopifyAbandonedCheckoutSyncService,
    private readonly aiService: AiService,
    private readonly supabaseService: SupabaseService,
    private readonly conversationMemoryService: ConversationMemoryService,
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

  @Get('shopify-abandoned-checkouts-test')
  async shopifyAbandonedCheckoutsTest() {
    try {
      const result =
        await this.shopifyService.getOpenAbandonedCheckoutsCount();

      return {
        ok: true,
        open_abandoned_checkouts: result.count,
        precision: result.precision,
      };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'No se pudieron consultar los abandonados de Shopify.',
      };
    }
  }
  @Get('shopify-abandoned-checkouts-preview')
  async shopifyAbandonedCheckoutsPreview() {
    try {
      const abandonedCheckouts =
        await this.shopifyService.getOpenAbandonedCheckoutsPreview();

      return {
        ok: true,
        count: abandonedCheckouts.length,
        abandoned_checkouts: abandonedCheckouts,
      };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'No se pudieron previsualizar los abandonados de Shopify.',
      };
    }
  }
  @Post('internal/shopify-abandoned-checkouts/sync')
  async syncShopifyAbandonedCheckouts(
    @Headers('x-chatpro-internal-key') providedKey = '',
    @Query('company') companySlug = '',
    @Query('since') updatedSince = '',
    @Query('limit') limit = '3',
  ) {
    const expectedKey = process.env.CHATPRO_INTERNAL_SYNC_KEY?.trim();

    if (!expectedKey || providedKey !== expectedKey) {
      return {
        ok: false,
        error: 'No autorizado.',
      };
    }

    const cleanCompanySlug = companySlug.trim().toLowerCase();
    const cleanUpdatedSince = updatedSince.trim();
    const parsedLimit = Number(limit);

    if (!cleanCompanySlug || !cleanUpdatedSince) {
      return {
        ok: false,
        error: 'Envía company y since.',
      };
    }

    if (
      !Number.isInteger(parsedLimit) ||
      parsedLimit < 1 ||
      parsedLimit > 50
    ) {
      return {
        ok: false,
        error: 'limit debe ser un entero entre 1 y 50.',
      };
    }

    try {
      const { data: company, error: companyError } =
        await this.supabaseService
          .getClient()
          .from('companies')
          .select('id')
          .eq('slug', cleanCompanySlug)
          .maybeSingle();

      if (companyError) {
        throw new Error(
          `No se pudo consultar la empresa: ${companyError.message}`,
        );
      }

      if (!company) {
        return {
          ok: false,
          error: 'Empresa no encontrada.',
        };
      }

      const result =
        await this.shopifyAbandonedCheckoutSyncService.syncCompany(
          company.id,
          cleanUpdatedSince,
          parsedLimit,
        );

      return {
        ok: true,
        result,
      };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo sincronizar Shopify.',
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

  @Get('supabase-test')
  async supabaseTest() {
    try {
      await this.supabaseService.checkConnection();

      return {
        ok: true,
        connected: true,
      };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Error desconocido al consultar Supabase.',
      };
    }
  }

  @Get('memory-test')
  async memoryTest(
    @Query('company') company = '',
    @Query('phone') phone = '',
  ) {
    const companySlug = company.trim();
    const customerPhone = phone.trim();

    if (!companySlug || !customerPhone) {
      return {
        ok: false,
        error: 'Envía company y phone en la URL.',
      };
    }

    try {
      const profile =
        await this.conversationMemoryService.getCompanyProfile(companySlug);

      const session =
        await this.conversationMemoryService.getOrCreateSession(
          companySlug,
          customerPhone,
        );

      return {
        ok: true,
        company: {
          slug: profile.slug,
          name: profile.name,
        },
        session,
      };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Error desconocido al crear la sesión.',
      };
    }
  }
}