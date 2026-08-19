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
import { MetaMessengerService } from './meta-messenger.service';
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

@Controller('integrations/messenger')
export class MetaMessengerController {
  constructor(
    private readonly messengerService: MetaMessengerService,
    private readonly supabaseService: SupabaseService,
  ) {}

  @Get('config')
  async config(
    @Headers('x-chatpro-inbox-key')
    accessKey: string | undefined,
    @Query('company') companySlug: string | undefined,
  ) {
    this.requireAccess(accessKey);
    const company = await this.getCompany(companySlug);

    return {
      ok: true,
      company,
      ...this.messengerService.publicConfig(),
    };
  }

  @Post('exchange-code')
  async exchangeCode(
    @Headers('x-chatpro-inbox-key')
    accessKey: string | undefined,
    @Query('company') companySlug: string | undefined,
    @Body() body: ExchangeCodeBody,
  ) {
    this.requireAccess(accessKey);
    const company = await this.getCompany(companySlug);

    const authorization =
      await this.messengerService.exchangeAuthorizationCode(
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
    @Headers('x-chatpro-inbox-key')
    accessKey: string | undefined,
    @Query('company') companySlug: string | undefined,
    @Body() body: DiscoverBody,
  ) {
    this.requireAccess(accessKey);
    const company = await this.getCompany(companySlug);

    const pages = await this.messengerService.discoverPages(
      body.accessToken,
    );

    return {
      ok: true,
      company,
      pages,
    };
  }

  @Post('complete')
  async complete(
    @Headers('x-chatpro-inbox-key')
    accessKey: string | undefined,
    @Query('company') companySlug: string | undefined,
    @Body() body: CompleteBody,
  ) {
    this.requireAccess(accessKey);
    const company = await this.getCompany(companySlug);

    const messenger = await this.messengerService.connect({
      companyId: company.id,
      accessToken: body.accessToken,
      pageId: body.pageId,
    });

    return {
      ok: true,
      message:
        'Facebook Messenger quedó conectado para esta empresa.',
      company,
      messenger,
    };
  }

  private requireAccess(accessKey: string | undefined) {
    const expected =
      process.env.CHATPRO_INBOX_KEY?.trim() || '';

    if (!expected || accessKey !== expected) {
      throw new UnauthorizedException(
        'No tienes permiso para administrar integraciones.',
      );
    }
  }

  private async getCompany(companySlug: string | undefined) {
    const slug = companySlug?.trim();

    if (!slug) {
      throw new BadRequestException(
        'Falta indicar la empresa.',
      );
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
