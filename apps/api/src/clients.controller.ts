import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ConversationMemoryService } from './conversation-memory.service';

type ContactBody = {
  action?: unknown;
  company?: unknown;
  phone?: unknown;
  displayName?: unknown;
  tags?: unknown;
  notes?: unknown;
};

@Controller('clients')
export class ClientsController {
  constructor(
    private readonly conversationMemoryService: ConversationMemoryService,
  ) {}

  @Get('profile')
  async profile(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('company') company = '',
    @Query('phone') phone = '',
  ) {
    this.authorize(providedKey);

    return {
      ok: true,
      ...(await this.conversationMemoryService.getClientProfile(
        this.requiredCompany(company),
        this.requiredPhone(phone),
      )),
    };
  }

  @Get()
  async list(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('company') company = '',
    @Query('search') search = '',
    @Query('limit') limit = '100',
  ) {
    this.authorize(providedKey);

    return {
      ok: true,
      ...(await this.conversationMemoryService.listClients(
        this.requiredCompany(company),
        this.readText(search),
        Number(limit),
      )),
    };
  }

  @Post()
  @HttpCode(200)
  async saveContact(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('company') companyQuery = '',
    @Body() body: ContactBody = {},
  ) {
    this.authorize(providedKey);

    const company = this.requiredCompany(
      this.readText(body.company) || companyQuery,
    );
    const action = this.readText(body.action);

    if (action === 'create') {
      return {
        ok: true,
        ...(await this.conversationMemoryService.createManualContact(
          company,
          {
            phone: this.requiredPhone(this.readText(body.phone)),
            displayName: this.readText(body.displayName),
            tags: this.readTags(body.tags),
            notes: this.readText(body.notes),
          },
        )),
      };
    }

    if (action === 'update') {
      return {
        ok: true,
        contact: await this.conversationMemoryService.updateContact(
          company,
          this.requiredPhone(this.readText(body.phone)),
          {
            displayName: this.readText(body.displayName),
            tags: this.readTags(body.tags),
            notes: this.readText(body.notes),
          },
        ),
      };
    }

    throw new BadRequestException('Acción de contacto no válida.');
  }

  private authorize(providedKey: string) {
    const expectedKey = process.env.CHATPRO_INBOX_KEY?.trim();

    if (!expectedKey || providedKey.trim() !== expectedKey) {
      throw new UnauthorizedException('No autorizado para ver clientes.');
    }
  }

  private requiredCompany(value: string): string {
    const company = value.trim().toLowerCase();

    if (!company) {
      throw new BadRequestException('Falta la empresa.');
    }

    return company;
  }

  private requiredPhone(value: string): string {
    const phone = value.trim();

    if (!phone) {
      throw new BadRequestException('Falta el número de teléfono.');
    }

    return phone;
  }

  private readText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private readTags(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean);
    }

    if (typeof value === 'string') {
      return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }

    return [];
  }
}
