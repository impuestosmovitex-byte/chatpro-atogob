
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

type CartRecoverySettings = {
  fallbackMessage: string;
  defaultCountryCode: string;
  replyContextHours: number;
  testMode: boolean;
  testPhones: string;
};

type ShippingCarrier = {
  displayName: string;
  aliases: string;
  trackingUrl: string;
  instructions: string;
  isActive: boolean;
};

type ShippingTracking = {
  enabled: boolean;
  fallbackInstructions: string;
  carriers: ShippingCarrier[];
};

type SettingsBody = {
  assistantName?: unknown;
  tone?: unknown;
  aiInstructions?: unknown;
  commercialFlow?: unknown;
  knowledgeBase?: unknown;
  cartRecovery?: unknown;
  shippingTracking?: unknown;
};

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function cleanText(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().slice(0, 30000)
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

function cartRecoveryFrom(
  value: unknown,
  settings: Record<string, unknown>,
): CartRecoverySettings {
  const nested =
    value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};

  const testPhonesValue =
    nested.test_phones ?? settings.cart_recovery_test_phones;
  const testPhones = Array.isArray(testPhonesValue)
    ? testPhonesValue
        .filter((item): item is string => typeof item === 'string')
        .join('\n')
    : cleanText(testPhonesValue);

  const rawHours =
    nested.reply_context_hours ??
    settings.cart_recovery_reply_context_hours;
  const parsedHours =
    typeof rawHours === 'number'
      ? rawHours
      : typeof rawHours === 'string'
        ? Number(rawHours)
        : Number.NaN;

  return {
    fallbackMessage: cleanText(
      nested.fallback_message ?? settings.cart_recovery_fallback_message,
    ),
    defaultCountryCode:
      cleanText(
        nested.default_country_code ??
          settings.cart_recovery_default_country_code,
      ) || '57',
    replyContextHours:
      Number.isInteger(parsedHours) && parsedHours >= 1 && parsedHours <= 168
        ? parsedHours
        : 72,
    testMode:
      typeof nested.test_mode === 'boolean'
        ? nested.test_mode
        : settings.cart_recovery_test_mode !== false,
    testPhones,
  };
}


function shippingTrackingFrom(value: unknown): ShippingTracking {
  const source =
    value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};

  const rawCarriers = Array.isArray(source.carriers) ? source.carriers : [];

  const carriers = rawCarriers
    .map((item): ShippingCarrier => {
      const carrier =
        item && typeof item === 'object' && !Array.isArray(item)
          ? item as Record<string, unknown>
          : {};

      return {
        displayName: cleanText(carrier.displayName ?? carrier.display_name),
        aliases: cleanText(carrier.aliases),
        trackingUrl: cleanText(carrier.trackingUrl ?? carrier.tracking_url),
        instructions: cleanText(carrier.instructions),
        isActive:
          typeof carrier.isActive === 'boolean'
            ? carrier.isActive
            : carrier.is_active !== false,
      };
    })
    .filter(
      (carrier) =>
        carrier.displayName ||
        carrier.aliases ||
        carrier.trackingUrl ||
        carrier.instructions,
    );

  return {
    enabled:
      typeof source.enabled === 'boolean'
        ? source.enabled
        : carriers.length > 0,
    fallbackInstructions:
      cleanText(source.fallbackInstructions ?? source.fallback_instructions) ||
      'Ingresa al enlace principal de la transportadora, busca seguimiento o rastreo, copia la guía y consulta el estado.',
    carriers,
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
        cartRecovery: body?.cartRecovery,
        shippingTracking: body?.shippingTracking,
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
      cartRecovery: cartRecoveryFrom(
        profile.settings.cart_recovery,
        profile.settings,
      ),
      shippingTracking: shippingTrackingFrom(profile.settings.shipping_tracking),
    };
  }
}
