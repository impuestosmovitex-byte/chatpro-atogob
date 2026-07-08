
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

type CommercialFlow = {
  welcomeMessage: string;
  salesInstructions: string;
  shippingInstructions: string;
  paymentInstructions: string;
  checkoutInstructions: string;
};

type KnowledgeBase = {
  termsConditions: string;
  exchangesReturns: string;
  warranties: string;
  policiesFaq: string;
};

type SettingsBody = {
  assistantName?: unknown;
  tone?: unknown;
  aiInstructions?: unknown;
  commercialFlow?: unknown;
  knowledgeBase?: unknown;
};

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function cleanText(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().slice(0, 6000)
    : '';
}

function commercialFlowFrom(value: unknown): CommercialFlow {
  const source =
    value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};

  return {
    welcomeMessage: cleanText(source.welcome_message),
    salesInstructions: cleanText(source.sales_instructions),
    shippingInstructions: cleanText(source.shipping_instructions),
    paymentInstructions: cleanText(source.payment_instructions),
    checkoutInstructions: cleanText(source.checkout_instructions),
  };
}

function knowledgeBaseFrom(value: unknown): KnowledgeBase {
  const source =
    value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};

  return {
    termsConditions: cleanText(source.terms_conditions),
    exchangesReturns: cleanText(source.exchanges_returns),
    warranties: cleanText(source.warranties),
    policiesFaq: cleanText(source.policies_faq),
  };
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
        commercialFlow: body?.commercialFlow,
        knowledgeBase: body?.knowledgeBase,
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
      commercialFlow: commercialFlowFrom(profile.settings.commercial_flow),
      knowledgeBase: knowledgeBaseFrom(profile.settings.knowledge_base),
    };
  }
}
