import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ConversationMemoryService } from './conversation-memory.service';

type InboxBody = {
  message?: unknown;
};

@Controller('inbox')
export class InboxController {
  constructor(
    private readonly conversationMemoryService: ConversationMemoryService,
  ) {}

  @Get()
  async list(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('company') company = '',
    @Query('status') status = 'all',
    @Query('limit') limit = '60',
  ) {
    this.authorize(providedKey);

    return {
      ok: true,
      ...(await this.conversationMemoryService.listInboxSessions(
        this.requiredCompany(company),
        status,
        Number(limit),
      )),
    };
  }

  @Get(':sessionId')
  async getConversation(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('company') company = '',
    @Param('sessionId') sessionId = '',
  ) {
    this.authorize(providedKey);

    return {
      ok: true,
      ...(await this.conversationMemoryService.getInboxConversation(
        this.requiredCompany(company),
        sessionId,
      )),
    };
  }

  @Post(':sessionId/take')
  @HttpCode(200)
  async takeConversation(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Headers('x-chatpro-user-id') userId = '',
    @Headers('x-chatpro-user-name') fullName = '',
    @Headers('x-chatpro-company-id') headerCompanyId = '',
    @Query('company') company = '',
    @Param('sessionId') sessionId = '',
  ) {
    this.authorize(providedKey);
    const conversation = await this.conversationMemoryService.getInboxConversation(
      this.requiredCompany(company),
      sessionId,
    );
    if (!userId.trim() || !fullName.trim() || headerCompanyId.trim() !== conversation.company.id) {
      throw new UnauthorizedException('Sesión de asesor no válida.');
    }

    const session = await this.conversationMemoryService.takeConversation(
      sessionId,
      { userId, fullName },
    );

    return { ok: true, session };
  }

  @Post(':sessionId/close')
  @HttpCode(200)
  async closeConversation(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('company') company = '',
    @Param('sessionId') sessionId = '',
  ) {
    this.authorize(providedKey);
    await this.conversationMemoryService.getInboxConversation(
      this.requiredCompany(company),
      sessionId,
    );

    const session = await this.conversationMemoryService.closeConversation(
      sessionId,
    );

    return { ok: true, session };
  }

  @Post(':sessionId/messages')
  @HttpCode(200)
  async sendAdvisorMessage(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('company') company = '',
    @Param('sessionId') sessionId = '',
    @Body() body: InboxBody = {},
  ) {
    this.authorize(providedKey);
    const conversation = await this.conversationMemoryService.getInboxConversation(
      this.requiredCompany(company),
      sessionId,
    );

    if (conversation.session.attentionStatus !== 'human') {
      throw new BadRequestException(
        'Toma la conversación antes de responder como asesor.',
      );
    }

    const message = this.readText(body.message);

    if (!message) {
      throw new BadRequestException('Escribe un mensaje antes de enviarlo.');
    }

    await this.sendTextMessage(conversation.session.customerPhone, message);

    await this.conversationMemoryService.saveMessage({
      companyId: conversation.company.id,
      sessionId: conversation.session.id,
      customerPhone: conversation.session.customerPhone,
      message,
      sender: 'assistant',
      authorType: 'advisor',
      aiResponse: null,
    });

    await this.conversationMemoryService.touchSession(
      conversation.session.id,
    );

    return {
      ok: true,
      conversation: await this.conversationMemoryService.getInboxConversation(
        conversation.company.slug,
        conversation.session.id,
      ),
    };
  }

  private authorize(providedKey: string) {
    const expectedKey = process.env.CHATPRO_INBOX_KEY?.trim();

    if (!expectedKey || providedKey.trim() !== expectedKey) {
      throw new UnauthorizedException('No autorizado para usar la bandeja.');
    }
  }

  private requiredCompany(value: string): string {
    const company = value.trim().toLowerCase();

    if (!company) {
      throw new BadRequestException('Falta la empresa.');
    }

    return company;
  }

  private readText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private async sendTextMessage(to: string, body: string) {
    const accessToken = process.env.META_WHATSAPP_ACCESS_TOKEN?.trim();
    const phoneNumberId = process.env.META_PHONE_NUMBER_ID?.trim();

    if (!accessToken || !phoneNumberId) {
      throw new Error('Faltan variables de Meta en Railway.');
    }

    const response = await fetch(
      `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(await response.text());
    }
  }
}
