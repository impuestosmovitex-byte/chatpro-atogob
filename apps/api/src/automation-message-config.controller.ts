import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Put,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { AutomationMessageConfigService } from './automation-message-config.service';
import { ConversationMemoryService } from './conversation-memory.service';

@Controller('automation-messages')
export class AutomationMessageConfigController {
  constructor(
    private readonly automationMessageConfigService: AutomationMessageConfigService,
    private readonly conversationMemoryService: ConversationMemoryService,
  ) {}

  @Get()
  async list(
    @Headers('x-chatpro-inbox-key') key = '',
    @Query('company') company = '',
  ) {
    this.authorize(key);
    const profile =
      await this.conversationMemoryService.getCompanyProfile(
        this.requiredCompany(company),
      );

    return {
      ok: true,
      company: {
        id: profile.id,
        slug: profile.slug,
        name: profile.name,
      },
      configuration:
        await this.automationMessageConfigService.list(profile.id),
    };
  }

  @Put(':automationKey')
  async update(
    @Headers('x-chatpro-inbox-key') key = '',
    @Query('company') company = '',
    @Param('automationKey') automationKey = '',
    @Body() body: Record<string, unknown> = {},
  ) {
    this.authorize(key);
    const profile =
      await this.conversationMemoryService.getCompanyProfile(
        this.requiredCompany(company),
      );

    return {
      ok: true,
      message: 'Mensajes guardados correctamente.',
      configuration:
        await this.automationMessageConfigService.update(
          profile.id,
          automationKey,
          body,
        ),
    };
  }

  private authorize(provided: string): void {
    const expected = process.env.CHATPRO_INBOX_KEY?.trim();

    if (!expected || provided.trim() !== expected) {
      throw new UnauthorizedException('Acceso no autorizado.');
    }
  }

  private requiredCompany(value: string): string {
    const company = value.trim().toLowerCase();

    if (!company) {
      throw new BadRequestException('Falta la empresa.');
    }

    return company;
  }
}
