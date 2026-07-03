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
    @Headers('x-chatpro-user-id') userId = '',
    @Headers('x-chatpro-user-name') fullName = '',
    @Headers('x-chatpro-company-id') headerCompanyId = '',
    @Headers('x-chatpro-role-key') roleKey = '',
    @Query('company') company = '',
    @Query('phone') phone = '',
  ) {
    this.authorize(providedKey);
    const result = await this.conversationMemoryService.getClientProfile(
      this.requiredCompany(company),
      this.requiredPhone(phone),
    );
    const actor = await this.actor(
      userId,
      fullName,
      headerCompanyId,
      roleKey,
      result.company.id,
    );

    this.assertCanAccessSession(actor, result.session);

    return { ok: true, ...result };
  }

  @Get()
  async list(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Headers('x-chatpro-user-id') userId = '',
    @Headers('x-chatpro-user-name') fullName = '',
    @Headers('x-chatpro-company-id') headerCompanyId = '',
    @Headers('x-chatpro-role-key') roleKey = '',
    @Query('company') company = '',
    @Query('search') search = '',
    @Query('limit') limit = '100',
  ) {
    this.authorize(providedKey);
    const result = await this.conversationMemoryService.listClients(
      this.requiredCompany(company),
      this.readText(search),
      Number(limit),
    );
    const actor = await this.actor(
      userId,
      fullName,
      headerCompanyId,
      roleKey,
      result.company.id,
    );

    return {
      ok: true,
      ...result,
      clients: actor.isFullAccess
        ? result.clients
        : result.clients.filter(
            (client) =>
              client.attentionStatus === 'human' &&
              client.assignedToName === actor.fullName,
          ),
    };
  }

  @Post()
  @HttpCode(200)
  async saveContact(
    @Headers('x-chatpro-inbox-key') providedKey = '',
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
      userId,
      fullName,
      headerCompanyId,
      roleKey,
      profile.id,
    );
    const action = this.readText(body.action);

    if (action === 'create') {
      if (!actor.isFullAccess) {
        throw new ForbiddenException(
          'Solo un administrador puede crear contactos manuales.',
        );
      }

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
      const phone = this.requiredPhone(this.readText(body.phone));
      const existing = await this.conversationMemoryService.getClientProfile(
        company,
        phone,
      );

      this.assertCanAccessSession(actor, existing.session);

      return {
        ok: true,
        contact: await this.conversationMemoryService.updateContact(
          company,
          phone,
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
    userId: string,
    fullName: string,
    headerCompanyId: string,
    roleKey: string,
    companyId: string,
  ): Promise<Actor> {
    const id = userId.trim();
    const name = fullName.trim();
    const role = roleKey.trim().toLowerCase();

    if (!id || !name || headerCompanyId.trim() !== companyId) {
      throw new UnauthorizedException('Sesión de usuario no válida.');
    }

    const client = this.supabaseService.getClient();
    const { data: membership, error: membershipError } = await client
      .from('company_memberships')
      .select('role_id, active')
      .eq('company_id', companyId)
      .eq('user_id', id)
      .maybeSingle();

    if (membershipError || !membership?.active || !membership.role_id) {
      throw new UnauthorizedException('Tu acceso a esta empresa no está activo.');
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
      .map((item: { permission_id?: unknown }) => item.permission_id)
      .filter((value): value is string => typeof value === 'string');

    const { data: rows, error: permissionsError } = permissionIds.length
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

    const permissions = new Set(
      (rows ?? [])
        .map((item: { key?: unknown }) => item.key)
        .filter((value): value is string => typeof value === 'string'),
    );

    if (!permissions.has('inbox.view') && role !== 'owner' && role !== 'admin') {
      throw new ForbiddenException('No tienes permiso para ver clientes.');
    }

    return {
      userId: id,
      fullName: name,
      permissions,
      isFullAccess: role === 'owner' || role === 'admin',
    };
  }

  private assertCanAccessSession(
    actor: Actor,
    session: ConversationSession,
  ) {
    if (actor.isFullAccess) {
      return;
    }

    if (
      session.attentionStatus !== 'human' ||
      session.assignedToUserId !== actor.userId
    ) {
      throw new ForbiddenException(
        'Solo puedes ver o editar clientes de conversaciones activas asignadas a tu usuario.',
      );
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
