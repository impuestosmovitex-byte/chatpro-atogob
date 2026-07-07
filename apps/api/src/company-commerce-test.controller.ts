import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { CompanyCommerceService } from './company-commerce.service';
import { SupabaseService } from './supabase.service';

type PreviewBody = { company?: unknown; handle?: unknown };

@Controller('integrations/shopify')
export class CompanyCommerceTestController {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly companyCommerceService: CompanyCommerceService,
  ) {}

  @Post('commerce-preview')
  async preview(
    @Headers('x-chatpro-inbox-key') accessKey: string | undefined,
    @Body() body: PreviewBody,
  ) {
    this.requireAccess(accessKey);

    const slug = this.text(body.company).toLowerCase();

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

    const handle = this.text(body.handle).toLowerCase();
    const product = handle
      ? await this.companyCommerceService.getProductByHandle(company.id, handle)
      : (await this.companyCommerceService.searchProducts(company.id, '', 1))[0] ??
        null;

    if (!product) {
      throw new BadRequestException(
        handle
          ? 'No encontré un producto vendible con ese handle en esta empresa.'
          : 'No encontré productos vendibles para probar esta empresa.',
      );
    }

    const variant = product.variants[0];

    if (!variant) {
      throw new BadRequestException(
        'El producto elegido no tiene variantes vendibles para la prueba.',
      );
    }

    const links = await this.companyCommerceService.createCheckoutLink(
      company.id,
      [{ variantId: variant.id, quantity: 1 }],
    );

    return {
      ok: true,
      testedAt: new Date().toISOString(),
      company: { name: company.name, slug: company.slug },
      product: {
        title: product.title,
        handle: product.handle,
        url: product.onlineStoreUrl,
      },
      variant: {
        title: variant.title,
        sku: variant.sku,
        price: variant.price,
        inventoryQuantity: variant.inventoryQuantity,
        inventoryPolicy: variant.inventoryPolicy,
        tracked: variant.tracked,
      },
      links: {
        cartUrl: links.cartUrl,
        checkoutUrl: links.checkoutUrl,
      },
      note:
        'Prueba de solo lectura. No crea pedido, no descuenta inventario y no envía mensajes.',
    };
  }

  private requireAccess(value: string | undefined) {
    const expected = process.env.CHATPRO_INBOX_KEY?.trim();

    if (!expected || value?.trim() !== expected) {
      throw new UnauthorizedException('No autorizado.');
    }
  }

  private text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }
}
