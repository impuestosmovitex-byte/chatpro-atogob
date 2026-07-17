import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ConversationMemoryService } from './conversation-memory.service';
import { PlatformHealthService } from './platform-health.service';

@Controller('platform-health')
export class PlatformHealthController {
  constructor(
    private readonly platformHealthService: PlatformHealthService,
    private readonly conversationMemoryService: ConversationMemoryService,
  ) {}

  @Get()
  async dashboard(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('company') company = '',
    @Query('refresh') refresh = 'true',
  ) {
    this.authorize(providedKey);

    const slug = company.trim().toLowerCase();

    if (!slug) {
      throw new BadRequestException('Falta la empresa.');
    }

    const profile =
      await this.conversationMemoryService.getCompanyProfile(slug);
    const dashboard = await this.platformHealthService.dashboard(
      profile.id,
      refresh !== 'false' && refresh !== '0',
    );

    return {
      ok: true,
      company: {
        id: profile.id,
        slug: profile.slug,
        name: profile.name,
      },
      ...dashboard,
    };
  }

  private authorize(provided: string) {
    const expected = process.env.CHATPRO_INBOX_KEY?.trim();

    if (!expected || provided.trim() !== expected) {
      throw new UnauthorizedException('Acceso no autorizado.');
    }
  }
}
