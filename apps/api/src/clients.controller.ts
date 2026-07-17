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
    const historyRestricted = !this.canViewHistory(
      actor,
      payload.session,
    );
    const start = this.startAvailability(
      actor,
      payload.client,
    );

    return {
      ok: true,
      ...payload,
      client: historyRestricted
        ? { ...payload.client, lastMessage: null, ...start }
        : { ...payload.client, ...start },
      messages: historyRestricted ? [] : payload.messages,
      historyRestricted,
      canEdit: this.hasPermission(actor, 'clients.manage'),
      ...start,
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
      canEdit: this.hasPermission(actor, 'clients.manage'),
      clients: payload.clients
        .map((client) => this.secureClientSummary(actor, client))
        .filter(
          (client) =>
            !client.historyRestricted || client.startAvailable,
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
    const actor = await this.actor(
      sessionType,
      userId,
      fullName,
      headerCompanyId,
      roleKey,
      profile.id,
    );

    const action = this.readText(body.action);

    if (action === 'start-conversation') {
      const phone = this.requiredPhone(this.readText(body.phone));
      const payload =
        await this.conversationMemoryService.getClientProfile(
          company,
          phone,
        );
      const start = this.startAvailability(actor, payload.client);

      if (!start.startAvailable) {
        throw new ForbiddenException(
          start.startBlockedReason ||
            'Esta conversación todavía no está disponible.',
        );
      }

      if (!actor.userId) {
        throw new BadRequestException(
          'Inicia sesión con un usuario para tomar la conversación.',
        );
      }

      return {
        ok: true,
        session:
          await this.conversationMemoryService.takeConversation(
            payload.session.id,
            {
              userId: actor.userId,
              fullName: actor.fullName,
            },
          ),
      };
    }

    if (action === 'create') {
      this.assertPermission(
        actor,
        'clients.manage',
        'No tienes permiso para crear contactos.',
      );
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
      this.assertPermission(
        actor,
        'clients.manage',
        'No tienes permiso para editar clientes.',
      );

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

    if (
      role !== 'owner' &&
      role !== 'admin' &&
      !permissions.has('clients.view')
    ) {
      throw new ForbiddenException(
        'No tienes permiso para ver clientes.',
      );
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

    if (
      session.attentionStatus === 'human' &&
      session.assignedToUserId === actor.userId &&
      actor.permissions.has('inbox.view_own')
    ) {
      return true;
    }

    if (
      session.attentionStatus === 'human' &&
      actor.permissions.has('inbox.view_team')
    ) {
      return true;
    }

    if (
      session.attentionStatus === 'ai' &&
      actor.permissions.has('inbox.view_ai')
    ) {
      return true;
    }

    return (
      session.attentionStatus === 'waiting' &&
      actor.permissions.has('inbox.view_waiting')
    );
  }

  private startAvailability(
    actor: Actor,
    client: Pick<
      ClientSummary,
      | 'attentionStatus'
      | 'assignedToUserId'
      | 'lastMessageAt'
      | 'totalMessages'
    >,
  ): {
    startAvailable: boolean;
    startBlockedReason: string | null;
  } {
    if (!this.hasPermission(actor, 'inbox.start')) {
      return {
        startAvailable: false,
        startBlockedReason:
          'No tienes permiso para iniciar conversaciones.',
      };
    }

    if (
      client.attentionStatus === 'human' &&
      client.assignedToUserId === actor.userId
    ) {
      return {
        startAvailable: false,
        startBlockedReason:
          'La conversación ya está asignada a tu usuario.',
      };
    }

    if (client.attentionStatus === 'human') {
      return {
        startAvailable: false,
        startBlockedReason:
          'La conversación está asignada a otro asesor.',
      };
    }

    if (
      client.attentionStatus === 'waiting' ||
      client.totalMessages === 0
    ) {
      return {
        startAvailable: true,
        startBlockedReason: null,
      };
    }

    const lastActivity = new Date(client.lastMessageAt).getTime();
    const inactiveForTwelveHours =
      Number.isFinite(lastActivity) &&
      Date.now() - lastActivity >= 12 * 60 * 60 * 1000;

    if (
      inactiveForTwelveHours &&
      (client.attentionStatus === 'ai' ||
        client.attentionStatus === 'closed')
    ) {
      return {
        startAvailable: true,
        startBlockedReason: null,
      };
    }

    return {
      startAvailable: false,
      startBlockedReason:
        'La IA tuvo actividad durante las últimas 12 horas.',
    };
  }

  private secureClientSummary(actor: Actor, client: ClientSummary) {
    const historyRestricted = !this.canViewHistory(actor, client);
    const start = this.startAvailability(actor, client);

    return {
      ...client,
      lastMessage: historyRestricted ? null : client.lastMessage,
      historyRestricted,
      ...start,
    };
  }

  private hasPermission(actor: Actor, permission: string): boolean {
    return actor.isFullAccess || actor.permissions.has(permission);
  }

  private assertPermission(
    actor: Actor,
    permission: string,
    message: string,
  ): void {
    if (!this.hasPermission(actor, permission)) {
      throw new ForbiddenException(message);
    }
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
