import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Patch,
  UnauthorizedException,
} from '@nestjs/common';
import { MetaAdsLeadService } from './meta-ads-lead.service';
import { SupabaseService } from './supabase.service';

@Controller('meta-ads-leads')
export class MetaAdsLeadsController {
  constructor(
    private readonly metaAdsLeadService: MetaAdsLeadService,
    private readonly supabaseService: SupabaseService,
  ) {}

  @Patch('status')
  async updateStatus(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Headers('x-chatpro-company-id') headerCompanyId = '',
    @Body()
    body: {
      company?: unknown;
      contactId?: unknown;
      status?: unknown;
    } = {},
  ) {
    this.authorize(providedKey);

    const companySlug =
      typeof body.company === 'string' ? body.company.trim() : '';
    const contactId =
      typeof body.contactId === 'string' ? body.contactId.trim() : '';
    const status =
      typeof body.status === 'string' ? body.status.trim() : '';

    if (!companySlug || !contactId || !status) {
      throw new BadRequestException(
        'Faltan empresa, contacto o estado del lead.',
      );
    }

    const { data: company, error } = await this.supabaseService
      .getClient()
      .from('companies')
      .select('id, slug')
      .eq('slug', companySlug)
      .eq('status', 'active')
      .maybeSingle();

    if (error || !company?.id) {
      throw new BadRequestException(
        error?.message || 'No existe la empresa activa.',
      );
    }

    if (headerCompanyId.trim() !== company.id) {
      throw new UnauthorizedException('Empresa no autorizada.');
    }

    try {
      const result = await this.metaAdsLeadService.updateMetaAdsLeadStatus({
        companyId: company.id,
        contactId,
        status,
      });

      return {
        ok: true,
        ...result,
      };
    } catch (updateError) {
      throw new BadRequestException(
        updateError instanceof Error
          ? updateError.message
          : 'No se pudo actualizar el estado del lead.',
      );
    }
  }

  private authorize(providedKey: string): void {
    const expected = process.env.CHATPRO_INBOX_KEY?.trim();

    if (!expected || providedKey.trim() !== expected) {
      throw new UnauthorizedException('No autorizado para administrar leads.');
    }
  }
}
