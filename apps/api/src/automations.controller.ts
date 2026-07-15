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
import { AutomationRuntimeService } from './automation-runtime.service';
import { ConversationMemoryService } from './conversation-memory.service';

@Controller('automations')
export class AutomationsController {
  constructor(
    private readonly automationRuntimeService: AutomationRuntimeService,
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
    const dashboard =
      await this.automationRuntimeService.listDashboard(profile.id);

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
    const automation =
      await this.automationRuntimeService.updateDefinition(
        profile.id,
        automationKey,
        body,
      );

    return {
      ok: true,
      message: 'Automatización guardada correctamente.',
      automation,
    };
  }

  private authorize(provided: string) {
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
