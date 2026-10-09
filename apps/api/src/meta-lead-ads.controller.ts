import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { MetaLeadAdsService } from './meta-lead-ads.service';
import { SupabaseService } from './supabase.service';

type DiscoverBody = {
  accessToken?: unknown;
};

type ExchangeCodeBody = {
  code?: unknown;
  redirectUri?: unknown;
};

type CompleteBody = {
  accessToken?: unknown;
  pageId?: unknown;
};

@Controller('integrations/meta-leads')
export class MetaLeadAdsController {
  constructor(
    private readonly metaLeadAdsService: MetaLeadAdsService,
    private readonly supabaseService: SupabaseService,
  ) {}

  @Get('config')
  async config(
    @Headers('x-chatpro-inbox-key') accessKey: string | undefined,
    @Query('company') companySlug: string | undefined,
  ) {
    this.requireAccess(accessKey);
    const company = await this.getCompany(companySlug);

    return {
      ok: true,
      company,
      ...this.metaLeadAdsService.publicConfig(),
    };
  }

  @Post('exchange-code')
  async exchangeCode(
    @Headers('x-chatpro-inbox-key') accessKey: string | undefined,
    @Query('company') companySlug: string | undefined,
    @Body() body: ExchangeCodeBody,
  ) {
    this.requireAccess(accessKey);
    const company = await this.getCompany(companySlug);

    const authorization =
      await this.metaLeadAdsService.exchangeAuthorizationCode(
        body.code,
        body.redirectUri,
      );

    return {
      ok: true,
      company,
      ...authorization,
    };
  }

  @Post('discover')
  async discover(
    @Headers('x-chatpro-inbox-key') accessKey: string | undefined,
    @Query('company') companySlug: string | undefined,
    @Body() body: DiscoverBody,
  ) {
    this.requireAccess(accessKey);
    const company = await this.getCompany(companySlug);
    const pages = await this.metaLeadAdsService.discoverPages(body.accessToken);

    return {
      ok: true,
      company,
      pages,
    };
  }

  @Post('complete')
  async complete(
    @Headers('x-chatpro-inbox-key') accessKey: string | undefined,
    @Query('company') companySlug: string | undefined,
    @Body() body: CompleteBody,
  ) {
    this.requireAccess(accessKey);
    const company = await this.getCompany(companySlug);

    const leadAds = await this.metaLeadAdsService.connect({
      companyId: company.id,
      accessToken: body.accessToken,
      pageId: body.pageId,
    });

    return {
      ok: true,
      message:
        'Meta Lead Ads quedó conectado. Los formularios instantáneos de esta Página podrán entrar a MW1.',
      company,
      leadAds,
    };
  }

  private requireAccess(accessKey: string | undefined) {
    const expected = process.env.CHATPRO_INBOX_KEY?.trim() || '';

    if (!expected || accessKey !== expected) {
      throw new UnauthorizedException(
        'No tienes permiso para administrar integraciones.',
      );
    }
  }

  private async getCompany(companySlug: string | undefined) {
    const slug = companySlug?.trim();

    if (!slug) {
      throw new BadRequestException('Falta indicar la empresa.');
    }

    const { data, error } = await this.supabaseService
      .getClient()
      .from('companies')
      .select('id, slug, name')
      .eq('slug', slug)
      .eq('status', 'active')
      .maybeSingle();

    if (error || !data) {
      throw new BadRequestException(
        error?.message ||
          'No existe una empresa activa con ese identificador.',
      );
    }

    return data as {
      id: string;
      slug: string;
      name: string;
    };
  }
}
