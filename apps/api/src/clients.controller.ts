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
    const aiTakeSettings =
      await this.getAiTakeSettings(payload.company.id);

    const start = this.startAvailability(
      actor,
      payload.client,
      aiTakeSettings,
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

    const aiTakeSettings =
      await this.getAiTakeSettings(payload.company.id);

    return {
      ok: true,
      ...payload,
      canEdit: this.hasPermission(actor, 'clients.manage'),
      clients: payload.clients
        .map((client) =>
          this.secureClientSummary(
            actor,
            client,
            aiTakeSettings,
          ),
        )
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
      const aiTakeSettings =
        await this.getAiTakeSettings(payload.company.id);

      const start = this.startAvailability(
        actor,
        payload.client,
        aiTakeSettings,
      );

      if (!start.startAvailable) {
        throw new ForbiddenException(
          start.startBlockedReason ||
            'Esta conversación todavía no está disponible.',
        );
      }

      const advisor = actor.userId
        ? {
            userId: actor.userId,
            fullName: actor.fullName,
          }
        : await this.resolveBootstrapOwner(payload.company.id);

      return {
        ok: true,
        session:
          await this.conversationMemoryService.takeConversation(
            payload.session.id,
            advisor,
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

    if (action === 'update-tags') {
      const phone = this.requiredPhone(this.readText(body.phone));
      const payload =
        await this.conversationMemoryService.getClientProfile(
          company,
          phone,
        );

      if (
        !actor.isFullAccess &&
        !this.canViewHistory(actor, payload.session)
      ) {
        throw new ForbiddenException(
          'Solo puedes modificar etiquetas de conversaciones a las que tienes acceso.',
        );
      }

      return {
        ok: true,
        contact: await this.conversationMemoryService.updateContact(
          company,
          phone,
          {
            tags: this.readTags(body.tags),
          },
        ),
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

  private async resolveBootstrapOwner(
    companyId: string,
  ): Promise<{ userId: string; fullName: string }> {
    const c = this.supabaseService.getClient();

    const { data: memberships, error: membershipError } = await c
      .from('company_memberships')
      .select('user_id,role_id')
      .eq('company_id', companyId)
      .eq('active', true);

    if (membershipError)
      throw new BadRequestException(
        `No se pudo resolver el propietario: ${membershipError.message}`,
      );

    const rows = (memberships ?? []).filter(
      (row: any) =>
        typeof row.user_id === 'string' && typeof row.role_id === 'string',
    );
    const roleIds = rows.map((row: any) => row.role_id);

    if (!roleIds.length)
      throw new ForbiddenException(
        'No hay un propietario activo configurado para tomar conversaciones.',
      );

    const { data: roles, error: rolesError } = await c
      .from('app_roles')
      .select('id,key')
      .in('id', roleIds);

    if (rolesError)
      throw new BadRequestException(
        `No se pudieron cargar los roles: ${rolesError.message}`,
      );

    const ownerRoleIds = new Set(
      (roles ?? [])
        .filter((role: any) => role?.key === 'owner')
        .map((role: any) => role.id)
        .filter((id: unknown): id is string => typeof id === 'string'),
    );

    const owner = rows.find((row: any) => ownerRoleIds.has(row.role_id));

    if (!owner)
      throw new ForbiddenException(
        'No hay un propietario activo configurado para tomar conversaciones.',
      );

    const { data: profile, error: profileError } = await c
      .from('app_profiles')
      .select('full_name')
      .eq('user_id', owner.user_id)
      .maybeSingle();

    if (profileError)
      throw new BadRequestException(
        `No se pudo cargar el propietario: ${profileError.message}`,
      );

    return {
      userId: owner.user_id,
      fullName:
        typeof profile?.full_name === 'string' && profile.full_name.trim()
          ? profile.full_name.trim()
          : 'Propietario',
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

  private async getAiTakeSettings(
    companyId: string,
  ): Promise<{
    advisorsCanTakeAi: boolean;
    aiTakeAfterMinutes: number;
  }> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('company_support_settings')
      .select('advisors_can_take_ai,ai_take_after_minutes')
      .eq('company_id', companyId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(
        `No se pudo cargar la configuración de chats de IA: ${error.message}`,
      );
    }

    const settings = data as {
      advisors_can_take_ai?: boolean | null;
      ai_take_after_minutes?: number | null;
    } | null;

    const configuredMinutes = Number(
      settings?.ai_take_after_minutes,
    );

    return {
      advisorsCanTakeAi:
        settings?.advisors_can_take_ai === true,
      aiTakeAfterMinutes:
        Number.isInteger(configuredMinutes) &&
        configuredMinutes >= 1 &&
        configuredMinutes <= 10080
          ? configuredMinutes
          : 60,
    };
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
    settings: {
      advisorsCanTakeAi: boolean;
      aiTakeAfterMinutes: number;
    },
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

    if (client.attentionStatus === 'closed') {
      return {
        startAvailable: true,
        startBlockedReason: null,
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

    if (client.attentionStatus !== 'ai') {
      return {
        startAvailable: false,
        startBlockedReason:
          'Esta conversación no está disponible.',
      };
    }

    if (actor.isFullAccess) {
      return {
        startAvailable: true,
        startBlockedReason: null,
      };
    }

    if (!settings.advisorsCanTakeAi) {
      return {
        startAvailable: false,
        startBlockedReason:
          'La empresa no permite que los asesores tomen chats atendidos por la IA.',
      };
    }

    const lastActivity =
      new Date(client.lastMessageAt).getTime();

    if (!Number.isFinite(lastActivity)) {
      return {
        startAvailable: false,
        startBlockedReason:
          'No se pudo validar la última actividad.',
      };
    }

    const elapsedMinutes = Math.floor(
      (Date.now() - lastActivity) / 60000,
    );

    const remainingMinutes = Math.max(
      0,
      settings.aiTakeAfterMinutes - elapsedMinutes,
    );

    if (remainingMinutes > 0) {
      return {
        startAvailable: false,
        startBlockedReason:
          `La IA sigue activa. Podrás iniciar esta conversación en ${remainingMinutes} minuto${remainingMinutes === 1 ? '' : 's'}.`,
      };
    }

    return {
      startAvailable: true,
      startBlockedReason: null,
    };
  }

  private secureClientSummary(
    actor: Actor,
    client: ClientSummary,
    settings: {
      advisorsCanTakeAi: boolean;
      aiTakeAfterMinutes: number;
    },
  ) {
    const historyRestricted = !this.canViewHistory(actor, client);
    const start = this.startAvailability(
      actor,
      client,
      settings,
    );

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
