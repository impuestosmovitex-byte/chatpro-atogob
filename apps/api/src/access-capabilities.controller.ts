import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from './supabase.service';

type CapabilityKey =
  | 'inbox'
  | 'clients'
  | 'automations'
  | 'configuration'
  | 'testAgent';

@Controller('access-capabilities')
export class AccessCapabilitiesController {
  constructor(private readonly supabaseService: SupabaseService) {}

  @Get()
  async getCapabilities(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('company') companySlug = '',
    @Query('user') userId = '',
  ) {
    this.authorize(providedKey);

    const company = companySlug.trim().toLowerCase();
    const user = userId.trim();

    if (!company || !user) {
      throw new BadRequestException('Faltan la empresa o el usuario.');
    }

    const client = this.supabaseService.getClient();

    const { data: companyRow, error: companyError } = await client
      .from('companies')
      .select('id')
      .eq('slug', company)
      .maybeSingle();

    if (companyError) {
      throw new BadRequestException(
        `No se pudo consultar la empresa: ${companyError.message}`,
      );
    }

    if (!companyRow?.id) {
      throw new BadRequestException('Empresa no encontrada.');
    }

    const { data: membership, error: membershipError } = await client
      .from('company_memberships')
      .select('role_id,active')
      .eq('company_id', companyRow.id)
      .eq('user_id', user)
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

    const { data: role, error: roleError } = await client
      .from('app_roles')
      .select('key')
      .eq('id', membership.role_id)
      .maybeSingle();

    if (roleError || !role?.key) {
      throw new BadRequestException(
        roleError
          ? `No se pudo consultar el rol: ${roleError.message}`
          : 'El usuario no tiene un rol válido.',
      );
    }

    const { data: links, error: linksError } = await client
      .from('app_role_permissions')
      .select('permission_id')
      .eq('role_id', membership.role_id);

    if (linksError) {
      throw new BadRequestException(
        `No se pudieron consultar los permisos: ${linksError.message}`,
      );
    }

    const permissionIds = (links ?? [])
      .map((item: { permission_id?: unknown }) => item.permission_id)
      .filter(
        (value: unknown): value is string =>
          typeof value === 'string' && Boolean(value),
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
        `No se pudieron cargar los permisos: ${permissionsError.message}`,
      );
    }

    const permissionKeys = (permissionRows ?? [])
      .map((item: { key?: unknown }) =>
        typeof item.key === 'string'
          ? item.key.trim().toLowerCase()
          : '',
      )
      .filter(Boolean);

    const roleKey = String(role.key).trim().toLowerCase();
    const fullAccess = roleKey === 'owner' || roleKey === 'admin';

    const hasPrefix = (...prefixes: string[]) =>
      permissionKeys.some((permission) =>
        prefixes.some(
          (prefix) =>
            permission === prefix ||
            permission.startsWith(`${prefix}.`),
        ),
      );

    const capabilities: Record<CapabilityKey, boolean> = {
      inbox: fullAccess || hasPrefix('inbox', 'conversation', 'conversations'),
      clients:
        fullAccess ||
        hasPrefix('client', 'clients', 'customer', 'customers', 'inbox'),
      automations:
        fullAccess || hasPrefix('automation', 'automations'),
      configuration:
        fullAccess ||
        hasPrefix(
          'setting',
          'settings',
          'configuration',
          'user',
          'users',
          'role',
          'roles',
        ),
      // Probar agente es una herramienta administrativa interna.
      testAgent: fullAccess,
    };

    return {
      ok: true,
      roleKey,
      permissionKeys,
      capabilities,
    };
  }

  private authorize(provided: string) {
    const expected = process.env.CHATPRO_INBOX_KEY?.trim();

    if (!expected || provided.trim() !== expected) {
      throw new UnauthorizedException('Acceso no autorizado.');
    }
  }
}
