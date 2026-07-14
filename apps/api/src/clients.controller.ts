import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ConversationMemoryService,
  type ClientSummary,
  type ConversationSession,
} from './conversation-memory.service';
import { SupabaseService } from './supabase.service';

type ContactBody = {
  action?: unknown;
  company?: unknown;
  phone?: unknown;
  displayName?: unknown;
  tags?: unknown;
  notes?: unknown;
};

type Actor = {
  userId: string;
  fullName: string;
  permissions: Set<string>;
  isFullAccess: boolean;
};

@Controller('clients')
export class ClientsController {
  constructor(
    private readonly conversationMemoryService: ConversationMemoryService,
    private readonly supabaseService: SupabaseService,
  ) {}

  @Get('profile')
  async profile(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Headers('x-chatpro-session-type') sessionType = '',
    @Headers('x-chatpro-user-id') userId = '',
    @Headers('x-chatpro-user-name') fullName = '',
    @Headers('x-chatpro-company-id') headerCompanyId = '',
    @Headers('x-chatpro-role-key') roleKey = '',
    @Query('company') company = '',
    @Query('phone') phone = '',
  ) {
    this.authorize(providedKey);

    const payload = await this.conversationMemoryService.getClientProfile(
      this.requiredCompany(company),
      this.requiredPhone(phone),
    );
    const actor = await this.actor(
      sessionType,
      userId,
      fullName,
      headerCompanyId,
      roleKey,
      payload.company.id,
    );
    const historyRestricted = !this.canViewHistory(actor, payload.session);

    return {
      ok: true,
      ...payload,
      client: historyRestricted
        ? { ...payload.client, lastMessage: null }
        : payload.client,
      messages: historyRestricted ? [] : payload.messages,
      historyRestricted,
    };
  }

  @Get()
  async list(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Headers('x-chatpro-session-type') sessionType = '',
    @Headers('x-chatpro-user-id') userId = '',
    @Headers('x-chatpro-user-name') fullName = '',
    @Headers('x-chatpro-company-id') headerCompanyId = '',
    @Headers('x-chatpro-role-key') roleKey = '',
    @Query('company') company = '',
    @Query('search') search = '',
    @Query('limit') limit = '100',
  ) {
    this.authorize(providedKey);

    const payload = await this.conversationMemoryService.listClients(
      this.requiredCompany(company),
      this.readText(search),
      Number(limit),
    );
    const actor = await this.actor(
      sessionType,
      userId,
      fullName,
      headerCompanyId,
      roleKey,
      payload.company.id,
    );

    return {
      ok: true,
      ...payload,
      clients: payload.clients.map((client) =>
        this.secureClientSummary(actor, client),
      ),
    };
  }

  @Post()
  @HttpCode(200)
  async saveContact(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Headers('x-chatpro-session-type') sessionType = '',
    @Headers('x-chatpro-user-id') userId = '',
    @Headers('x-chatpro-user-name') fullName = '',
    @Headers('x-chatpro-company-id') headerCompanyId = '',
    @Headers('x-chatpro-role-key') roleKey = '',
    @Query('company') companyQuery = '',
    @Body() body: ContactBody = {},
  ) {
    this.authorize(providedKey);

    const company = this.requiredCompany(
      this.readText(body.company) || companyQuery,
    );
    const profile = await this.conversationMemoryService.getCompanyProfile(
      company,
    );
    await this.actor(
      sessionType,
      userId,
      fullName,
      headerCompanyId,
      roleKey,
      profile.id,
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

  private async actor(
    sessionType: string,
    userId: string,
    fullName: string,
    headerCompanyId: string,
    roleKey: string,
    companyId: string,
  ): Promise<Actor> {
    const type = sessionType.trim().toLowerCase();
    const id = userId.trim();
    const name = fullName.trim();
    const role = roleKey.trim().toLowerCase();

    if (type === 'bootstrap') {
      if (role !== 'owner' || headerCompanyId.trim() !== companyId) {
        throw new UnauthorizedException('Sesión inicial no válida.');
      }

      return {
        userId: '',
        fullName: name || 'Configuración inicial',
        permissions: new Set<string>(),
        isFullAccess: true,
      };
    }

    if (
      type !== 'user' ||
      !id ||
      !name ||
      headerCompanyId.trim() !== companyId
    ) {
      throw new UnauthorizedException('Sesión de asesor no válida.');
    }

    const client = this.supabaseService.getClient();
    const { data: membership, error: membershipError } = await client
      .from('company_memberships')
      .select('role_id,active')
      .eq('company_id', companyId)
      .eq('user_id', id)
      .maybeSingle();

    if (
      membershipError ||
      !membership?.active ||
      !membership.role_id
    ) {
      throw new UnauthorizedException(
        'Tu acceso a esta empresa no está activo.',
      );
    }

    const { data: links, error: linksError } = await client
      .from('app_role_permissions')
      .select('permission_id')
      .eq('role_id', membership.role_id);

    if (linksError) {
      throw new BadRequestException(
        `No se pudieron validar tus permisos: ${linksError.message}`,
      );
    }

    const permissionIds = (links ?? [])
      .map((item: any) => item.permission_id)
      .filter(
        (value: unknown): value is string => typeof value === 'string',
      );
    const { data: permissionRows, error: permissionsError } =
      permissionIds.length
        ? await client
            .from('app_permissions')
            .select('key')
            .in('id', permissionIds)
        : { data: [], error: null };

    if (permissionsError) {
      throw new BadRequestException(
        `No se pudieron cargar tus permisos: ${permissionsError.message}`,
      );
    }

    const permissions = new Set<string>(
      (permissionRows ?? [])
        .map((item: any) => item.key)
        .filter((value: unknown): value is string => typeof value === 'string'),
    );

    if (!permissions.has('inbox.view')) {
      throw new ForbiddenException('No tienes permiso para ver clientes.');
    }

    return {
      userId: id,
      fullName: name,
      permissions,
      isFullAccess: role === 'owner' || role === 'admin',
    };
  }

  private canViewHistory(
    actor: Actor,
    session: Pick<
      ConversationSession,
      'attentionStatus' | 'assignedToUserId'
    >,
  ): boolean {
    if (actor.isFullAccess) {
      return true;
    }

    return (
      session.attentionStatus === 'human' &&
      session.assignedToUserId === actor.userId
    );
  }

  private secureClientSummary(actor: Actor, client: ClientSummary) {
    const historyRestricted = !this.canViewHistory(actor, client);

    return {
      ...client,
      lastMessage: historyRestricted ? null : client.lastMessage,
      historyRestricted,
    };
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
