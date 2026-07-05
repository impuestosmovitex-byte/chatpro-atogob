import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { CompanyShopifyService } from './company-shopify.service';
import { SupabaseService } from './supabase.service';

type ProductsQuery = {
  company?: string;
  search?: string;
  status?: string;
  after?: string;
  limit?: string;
};

@Controller('company-products')
export class CompanyProductsController {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly companyShopifyService: CompanyShopifyService,
  ) {}

  @Get()
  async list(
    @Headers('x-chatpro-inbox-key') accessKey: string | undefined,
    @Query() query: ProductsQuery,
  ) {
    this.requireAccess(accessKey);

    const slug = this.text(query.company).toLowerCase();

    if (!slug) {
      throw new BadRequestException('Falta la empresa activa.');
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

    const result = await this.companyShopifyService.listProducts(company.id, {
      searchText: this.text(query.search),
      status: this.text(query.status),
      after: this.text(query.after) || null,
      limit: this.readLimit(query.limit),
    });

    return {
      ok: true,
      company: {
        name: company.name,
        slug: company.slug,
      },
      ...result,
    };
  }

  private requireAccess(value: string | undefined) {
    const expected = process.env.CHATPRO_INBOX_KEY?.trim();

    if (!expected || value?.trim() !== expected) {
      throw new UnauthorizedException('No autorizado para ver productos.');
    }
  }

  private readLimit(value: string | undefined): number {
    const parsed = Number.parseInt(this.text(value), 10);

    if (!Number.isFinite(parsed)) {
      return 20;
    }

    return Math.min(Math.max(parsed, 1), 20);
  }

  private text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }
}
