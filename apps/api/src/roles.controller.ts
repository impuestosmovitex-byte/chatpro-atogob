import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Patch,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from './supabase.service';

type CompanyRow = {
  id: string;
  name: string;
  slug: string;
};

type RoleRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  company_id: string | null;
};

type PermissionRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
};

type RoleBody = {
  roleKey?: unknown;
  name?: unknown;
  description?: unknown;
  permissionKeys?: unknown;
};

@Controller('roles')
export class RolesController {
  constructor(private readonly supabaseService: SupabaseService) {}

  @Get()
  async listRoles(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('company') companySlug = '',
  ) {
    this.assertInternalKey(providedKey);
    const company = await this.getCompany(companySlug);

    return {
      ok: true,
      company,
      ...(await this.buildPayload(company.id)),
    };
  }

  @Post()
  async createRole(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('company') companySlug = '',
    @Body() body: RoleBody,
  ) {
    this.assertInternalKey(providedKey);
    const company = await this.getCompany(companySlug);
    const name = this.roleName(body.name);
    const description = this.optionalText(body.description);
    const permissions = await this.permissionsFrom(body.permissionKeys);
    const key = this.createKey(company.id, name);
    const client = this.supabaseService.getClient();

    const { data: role, error: roleError } = await client
      .from('app_roles')
      .insert({
        company_id: company.id,
        key,
        name,
        description,
      })
      .select('id, key, name, description, company_id')
      .maybeSingle();

    if (roleError || !role) {
      const message = roleError?.message || 'No se pudo crear el rol.';
      if (message.toLowerCase().includes('unique')) {
        throw new BadRequestException(
          'Ya existe un rol personalizado con ese nombre en esta empresa.',
        );
      }
      throw new BadRequestException(message);
    }

    const { error: permissionsError } = await client
      .from('app_role_permissions')
      .insert(
        permissions.map((permission) => ({
          role_id: role.id,
          permission_id: permission.id,
        })),
      );

    if (permissionsError) {
      await client.from('app_roles').delete().eq('id', role.id);
      throw new BadRequestException(
        `No se pudieron guardar los permisos: ${permissionsError.message}`,
      );
    }

    return {
      ok: true,
      message: `Rol "${name}" creado correctamente.`,
    };
  }

  @Patch()
  async updateRole(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('company') companySlug = '',
    @Body() body: RoleBody,
  ) {
    this.assertInternalKey(providedKey);
    const company = await this.getCompany(companySlug);
    const roleKey = this.requiredText(body.roleKey, 'Falta el rol.');
    const role = await this.getCustomRole(roleKey, company.id);
    const name = this.roleName(body.name);
    const description = this.optionalText(body.description);
    const permissions = await this.permissionsFrom(body.permissionKeys);
    const client = this.supabaseService.getClient();

    const { error: roleError } = await client
      .from('app_roles')
      .update({ name, description })
      .eq('id', role.id)
      .eq('company_id', company.id);

    if (roleError) {
      const message = roleError.message;
      if (message.toLowerCase().includes('unique')) {
        throw new BadRequestException(
          'Ya existe un rol personalizado con ese nombre en esta empresa.',
        );
      }
      throw new BadRequestException(
        `No se pudo actualizar el rol: ${message}`,
      );
    }

    const { error: removeError } = await client
      .from('app_role_permissions')
      .delete()
      .eq('role_id', role.id);

    if (removeError) {
      throw new BadRequestException(
        `No se pudieron actualizar los permisos: ${removeError.message}`,
      );
    }

    const { error: permissionsError } = await client
      .from('app_role_permissions')
      .insert(
        permissions.map((permission) => ({
          role_id: role.id,
          permission_id: permission.id,
        })),
      );

    if (permissionsError) {
      throw new BadRequestException(
        `No se pudieron guardar los permisos: ${permissionsError.message}`,
      );
    }

    return {
      ok: true,
      message: `Rol "${name}" actualizado correctamente.`,
    };
  }

  private assertInternalKey(providedKey: string): void {
    const expectedKey = process.env.CHATPRO_INBOX_KEY?.trim();
    if (!expectedKey || expectedKey !== providedKey) {
      throw new UnauthorizedException('No autorizado.');
    }
  }

  private async getCompany(companySlug: string): Promise<CompanyRow> {
    const slug = companySlug.trim().toLowerCase();
    if (!slug) {
      throw new BadRequestException('Falta la empresa.');
    }

    const { data, error } = await this.supabaseService
      .getClient()
      .from('companies')
      .select('id, name, slug')
      .eq('slug', slug)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(
        `No se pudo consultar la empresa: ${error.message}`,
      );
    }

    if (!data) {
      throw new NotFoundException('Empresa no encontrada.');
    }

    return data as CompanyRow;
  }

  private async getRoles(companyId: string): Promise<RoleRow[]> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('app_roles')
      .select('id, key, name, description, company_id')
      .or(`company_id.is.null,company_id.eq.${companyId}`)
      .order('company_id', { ascending: true, nullsFirst: true })
      .order('name', { ascending: true });

    if (error) {
      throw new BadRequestException(
        `No se pudieron consultar los roles: ${error.message}`,
      );
    }

    return (data ?? []) as RoleRow[];
  }

  private async buildPayload(companyId: string) {
    const client = this.supabaseService.getClient();
    const roles = await this.getRoles(companyId);
    const roleIds = roles.map((role) => role.id);

    const { data: permissionsData, error: permissionsError } = await client
      .from('app_permissions')
      .select('id, key, name, description')
      .order('name', { ascending: true });

    if (permissionsError) {
      throw new BadRequestException(
        `No se pudieron consultar los permisos: ${permissionsError.message}`,
      );
    }

    const permissions = (permissionsData ?? []) as PermissionRow[];
    const permissionsById = new Map(
      permissions.map((permission) => [permission.id, permission]),
    );

    const rolePermissions =
      roleIds.length > 0
        ? await client
            .from('app_role_permissions')
            .select('role_id, permission_id')
            .in('role_id', roleIds)
        : { data: [], error: null };

    if (rolePermissions.error) {
      throw new BadRequestException(
        `No se pudieron consultar los permisos por rol: ${rolePermissions.error.message}`,
      );
    }

    const permissionsByRole = new Map<string, PermissionRow[]>();
    for (const item of rolePermissions.data ?? []) {
      const permission = permissionsById.get(item.permission_id);
      if (!permission) continue;
      const list = permissionsByRole.get(item.role_id) ?? [];
      list.push(permission);
      permissionsByRole.set(item.role_id, list);
    }

    const memberships =
      roleIds.length > 0
        ? await client
            .from('company_memberships')
            .select('role_id')
            .eq('company_id', companyId)
            .in('role_id', roleIds)
        : { data: [], error: null };

    if (memberships.error) {
      throw new BadRequestException(
        `No se pudo revisar el uso de los roles: ${memberships.error.message}`,
      );
    }

    const memberCount = new Map<string, number>();
    for (const item of memberships.data ?? []) {
      memberCount.set(
        item.role_id,
        (memberCount.get(item.role_id) ?? 0) + 1,
      );
    }

    return {
      permissions: permissions.map((permission) => ({
        key: permission.key,
        name: permission.name,
        description: permission.description ?? '',
      })),
      roles: roles.map((role) => ({
        key: role.key,
        name: role.name,
        description: role.description ?? '',
        scope: role.company_id ? 'custom' : 'base',
        memberCount: memberCount.get(role.id) ?? 0,
        permissions: (permissionsByRole.get(role.id) ?? [])
          .map((permission) => ({
            key: permission.key,
            name: permission.name,
            description: permission.description ?? '',
          }))
          .sort((left, right) => left.name.localeCompare(right.name)),
      })),
    };
  }

  private async getCustomRole(
    roleKey: string,
    companyId: string,
  ): Promise<RoleRow> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('app_roles')
      .select('id, key, name, description, company_id')
      .eq('key', roleKey.trim().toLowerCase())
      .eq('company_id', companyId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(
        `No se pudo consultar el rol: ${error.message}`,
      );
    }

    if (!data) {
      throw new BadRequestException(
        'Solo se pueden editar roles personalizados de esta empresa.',
      );
    }

    return data as RoleRow;
  }

  private async permissionsFrom(value: unknown): Promise<PermissionRow[]> {
    if (!Array.isArray(value)) {
      throw new BadRequestException('Selecciona al menos un permiso.');
    }

    const keys = Array.from(
      new Set(
        value
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    );

    if (!keys.length) {
      throw new BadRequestException('Selecciona al menos un permiso.');
    }

    const { data, error } = await this.supabaseService
      .getClient()
      .from('app_permissions')
      .select('id, key, name, description')
      .in('key', keys);

    if (error) {
      throw new BadRequestException(
        `No se pudieron validar los permisos: ${error.message}`,
      );
    }

    const permissions = (data ?? []) as PermissionRow[];

    if (permissions.length !== keys.length) {
      throw new BadRequestException(
        'Uno de los permisos seleccionados no existe.',
      );
    }

    return permissions;
  }

  private roleName(value: unknown): string {
    const name = this.requiredText(value, 'Escribe el nombre del rol.');
    if (name.length > 70) {
      throw new BadRequestException(
        'El nombre del rol debe tener máximo 70 caracteres.',
      );
    }
    return name;
  }

  private optionalText(value: unknown): string | null {
    if (typeof value !== 'string' || !value.trim()) {
      return null;
    }

    const text = value.trim();
    if (text.length > 220) {
      throw new BadRequestException(
        'La descripción debe tener máximo 220 caracteres.',
      );
    }
    return text;
  }

  private requiredText(value: unknown, message: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(message);
    }
    return value.trim();
  }

  private createKey(companyId: string, roleName: string): string {
    const companyPrefix = companyId
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase()
      .slice(0, 8);

    const normalized = roleName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .slice(0, 36) || 'rol';

    // Solo letras minúsculas y números. Ejemplo:
    // custom4ebe87b9servicioalclienteabc123
    return `custom${companyPrefix}${normalized}${Date.now().toString(36)}`;
  }
}
