import {
  BadRequestException,
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
import { AutomationRuntimeService } from './automation-runtime.service';
import { AutomationTestSendService } from './automation-test-send.service';
import { ConversationMemoryService } from './conversation-memory.service';
import { ShopifyAutomaticTestSendService } from './shopify-automatic-test-send.service';

@Controller('automations')
export class AutomationsController {
  constructor(
    private readonly automationRuntimeService: AutomationRuntimeService,
    private readonly conversationMemoryService: ConversationMemoryService,
    private readonly automationTestSendService: AutomationTestSendService,
    private readonly shopifyAutomaticTestSendService: ShopifyAutomaticTestSendService,
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

  @Post('executions/:executionId/test-send')
  async sendTest(
    @Headers('x-chatpro-inbox-key') key = '',
    @Query('company') company = '',
    @Param('executionId') executionId = '',
  ) {
    this.authorize(key);
    const profile =
      await this.conversationMemoryService.getCompanyProfile(
        this.requiredCompany(company),
      );

    return this.automationTestSendService.sendPrepared(
      profile.id,
      executionId,
    );
  }

  @Put('delivery-mode')
  async updateDeliveryMode(
    @Headers('x-chatpro-inbox-key') key = '',
    @Query('company') company = '',
    @Body() body: Record<string, unknown> = {},
  ) {
    this.authorize(key);
    const profile =
      await this.conversationMemoryService.getCompanyProfile(
        this.requiredCompany(company),
      );
    const result =
      await this.automationRuntimeService.updateDeliveryMode(
        profile.id,
        body,
      );

    return {
      ok: true,
      message:
        result.mode === 'production'
          ? 'Modo producción activado. Los nuevos eventos podrán enviarse a los clientes reales.'
          : 'Modo de prueba protegido activado.',
      deliveryMode: result.mode,
    };
  }

  @Post('executions/:executionId/retry')
  async retryExecution(
    @Headers('x-chatpro-inbox-key') key = '',
    @Query('company') company = '',
    @Param('executionId') executionId = '',
  ) {
    this.authorize(key);
    const profile =
      await this.conversationMemoryService.getCompanyProfile(
        this.requiredCompany(company),
      );

    const result =
      await this.shopifyAutomaticTestSendService.sendIfAllowed(
        profile.id,
        executionId,
      );

    if (result === 'blocked') {
      throw new BadRequestException(
        'El envío continúa bloqueado por el modo de prueba.',
      );
    }

    return {
      ok: true,
      message:
        result === 'already_sent'
          ? 'Este mensaje ya había sido enviado.'
          : 'Mensaje enviado correctamente.',
      executionId,
      result,
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
