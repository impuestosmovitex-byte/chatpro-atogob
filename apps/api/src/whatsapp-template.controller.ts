import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ConversationMemoryService } from './conversation-memory.service';
import { WhatsappTemplateService } from './whatsapp-template.service';

@Controller('whatsapp-templates')
export class WhatsappTemplateController {
  constructor(
    private readonly whatsappTemplateService: WhatsappTemplateService,
    private readonly conversationMemoryService: ConversationMemoryService,
  ) {}

  @Get()
  async dashboard(
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
      ...(await this.whatsappTemplateService.dashboard(profile.id)),
    };
  }

  @Post('sync')
  async sync(
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
      result: await this.whatsappTemplateService.sync(profile.id),
    };
  }

  @Put('bindings/:eventKey')
  async saveBinding(
    @Headers('x-chatpro-inbox-key') key = '',
    @Query('company') company = '',
    @Param('eventKey') eventKey = '',
    @Body() body: Record<string, unknown> = {},
  ) {
    this.authorize(key);
    const profile =
      await this.conversationMemoryService.getCompanyProfile(
        this.requiredCompany(company),
      );

    return {
      ok: true,
      binding: await this.whatsappTemplateService.saveBinding(
        profile.id,
        eventKey.trim(),
        body,
      ),
    };
  }

  private authorize(value: string) {
    const expected = process.env.CHATPRO_INBOX_KEY?.trim();

    if (!expected || value.trim() !== expected) {
      throw new UnauthorizedException('Acceso no autorizado.');
    }
  }

  private requiredCompany(value: string): string {
    const company = value.trim().toLowerCase();

    if (!company) {
      throw new Error('Falta la empresa.');
    }

    return company;
  }
}
