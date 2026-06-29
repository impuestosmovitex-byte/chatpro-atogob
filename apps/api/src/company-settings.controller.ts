import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Put,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ConversationMemoryService,
  type CompanyProfile,
} from './conversation-memory.service';

type SettingsBody = {
  assistantName?: unknown;
  tone?: unknown;
  aiInstructions?: unknown;
};

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

@Controller('settings')
export class CompanySettingsController {
  constructor(
    private readonly conversationMemoryService: ConversationMemoryService,
  ) {}

  @Get()
  async getSettings(
    @Headers('x-chatpro-inbox-key') accessKey: string | undefined,
    @Query('company') company: string | undefined,
  ) {
    this.requireAccess(accessKey);
    const profile = await this.getProfile(company);

    return {
      ok: true,
      company: {
        id: profile.id,
        slug: profile.slug,
        name: profile.name,
      },
      configuration: this.toConfiguration(profile),
    };
  }

  @Put()
  async saveSettings(
    @Headers('x-chatpro-inbox-key') accessKey: string | undefined,
    @Query('company') company: string | undefined,
    @Body() body: SettingsBody,
  ) {
    this.requireAccess(accessKey);

    const slug = company?.trim().toLowerCase();
    if (!slug) {
      throw new BadRequestException('Falta la empresa.');
    }

    const profile =
      await this.conversationMemoryService.updateCompanyAiSettings(slug, {
        assistantName: optionalText(body?.assistantName),
        tone: optionalText(body?.tone),
        aiInstructions: optionalText(body?.aiInstructions),
      });

    return {
      ok: true,
      company: {
        id: profile.id,
        slug: profile.slug,
        name: profile.name,
      },
      configuration: this.toConfiguration(profile),
    };
  }

  private requireAccess(accessKey: string | undefined) {
    const expected = process.env.CHATPRO_INBOX_KEY?.trim();

    if (!expected || accessKey?.trim() !== expected) {
      throw new UnauthorizedException('Acceso no autorizado.');
    }
  }

  private async getProfile(company: string | undefined) {
    const slug = company?.trim().toLowerCase();

    if (!slug) {
      throw new BadRequestException('Falta la empresa.');
    }

    return this.conversationMemoryService.getCompanyProfile(slug);
  }

  private toConfiguration(profile: CompanyProfile) {
    const configuredTone = profile.settings.ai_tone;

    return {
      assistantName: profile.assistantName ?? '',
      tone:
        typeof configuredTone === 'string' && configuredTone.trim()
          ? configuredTone.trim()
          : 'Cercana, clara, breve y profesional',
      aiInstructions: profile.aiInstructions ?? '',
    };
  }
}
