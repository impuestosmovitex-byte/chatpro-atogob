import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { CompanyShopifyService } from './company-shopify.service';
import { SupabaseService } from './supabase.service';

type PreviewBody = {
  company?: unknown;
};

@Controller('integrations/shopify')
export class ShopifyCatalogPreviewController {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly companyShopifyService: CompanyShopifyService,
  ) {}

  @Post('catalog-preview')
  async preview(
    @Headers('x-chatpro-inbox-key') accessKey: string | undefined,
    @Body() body: PreviewBody,
  ) {
    this.requireAccess(accessKey);

    const slug =
      typeof body.company === 'string' ? body.company.trim().toLowerCase() : '';

    if (!slug) {
      throw new BadRequestException('Falta la empresa.');
    }

    const { data: company, error } = await this.supabaseService
      .getClient()
      .from('companies')
      .select('id, name, slug')
      .eq('slug', slug)
      .eq('status', 'active')
      .maybeSingle();

    if (error || !company) {
      throw new BadRequestException(
        error?.message || 'Empresa activa no encontrada.',
      );
    }

    const [products, diagnostics] = await Promise.all([
      this.companyShopifyService.listCatalog(company.id, '', 10),
      this.companyShopifyService.getCatalogDiagnostics(company.id, 20),
    ]);

    return {
      ok: true,
      company: {
        name: company.name,
        slug: company.slug,
      },
      products,
      diagnostics,
    };
  }

  private requireAccess(value: string | undefined) {
    const expected = process.env.CHATPRO_INBOX_KEY?.trim();

    if (!expected || value?.trim() !== expected) {
      throw new UnauthorizedException('No autorizado.');
    }
  }
}
