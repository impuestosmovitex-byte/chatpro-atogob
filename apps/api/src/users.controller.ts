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
import { createHash } from 'crypto';
import { AccessAuthService } from './access-auth.service';
import { SupabaseService } from './supabase.service';

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

type MembershipRow = {
  id: string;
  user_id: string;
  role_id: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

type ProfileRow = {
  user_id: string;
  full_name: string;
  login_identifier: string | null;
  contact_email: string | null;
};

type CreateUserBody = {
  fullName?: unknown;
  identifier?: unknown;
  password?: unknown;
  roleKey?: unknown;
  areaIds?: unknown;
};

type UpdateUserBody = {
  userId?: unknown;
  fullName?: unknown;
  roleKey?: unknown;
  active?: unknown;
  areaIds?: unknown;
};

type ResetPasswordBody = {
  userId?: unknown;
  password?: unknown;
};

@Controller('users')
export class UsersController {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly accessAuthService: AccessAuthService,
  ) {}

  @Get()
  async listUsers(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('company') companySlug = '',
  ) {
    this.assertInternalKey(providedKey);
    const company = await this.getCompany(companySlug);

    return {
      ok: true,
      company,
      ...(await this.buildCompanyUsers(company.id)),
    };
  }

  @Post()
  async createUser(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('company') companySlug = '',
    @Body() body: CreateUserBody,
  ) {
    this.assertInternalKey(providedKey);

    const company = await this.getCompany(companySlug);
    const fullName = this.requiredText(body.fullName, 'Escribe el nombre.');
    const identifier = this.normalizeIdentifier(body.identifier);
    const password = this.validPassword(body.password);
    const role = await this.getRole(
      this.requiredText(body.roleKey, 'Selecciona un rol.'),
      company.id,
    );
    const client = this.supabaseService.getClient();

    const { count, error: countError } = await client
      .from('company_memberships')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', company.id)
      .eq('active', true);

    if (countError) {
      throw new BadRequestException(
        `No se pudo validar el primer usuario: ${countError.message}`,
      );
    }

    if ((count ?? 0) === 0 && role.key !== 'owner') {
      throw new BadRequestException(
        'El primer usuario de la empresa debe tener el rol Propietario.',
      );
    }

    const { data: existing, error: existingError } = await client
      .from('app_profiles')
      .select('user_id')
      .eq('login_identifier', identifier)
      .maybeSingle();

    if (existingError) {
      throw new BadRequestException(
        `No se pudo validar la identificación: ${existingError.message}`,
      );
    }

    if (existing) {
      throw new BadRequestException(
        'Esta identificación o código ya está en uso.',
      );
    }

    const technicalEmail = this.technicalEmail(company.slug, identifier);
    const { data: created, error: createError } =
      await client.auth.admin.createUser({
        email: technicalEmail,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
          login_identifier: identifier,
        },
      });

    if (createError || !created.user) {
      throw new BadRequestException(
        createError?.message || 'No se pudo crear el usuario.',
      );
    }

    try {
      const { error: profileError } = await client.from('app_profiles').upsert(
        {
          user_id: created.user.id,
          full_name: fullName,
          email: technicalEmail,
          contact_email: null,
          login_identifier: identifier,
          password_hash: this.accessAuthService.hash(password),
          active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );

      if (profileError) {
        throw new Error(profileError.message);
      }

      const { error: membershipError } = await client
        .from('company_memberships')
        .insert({
          company_id: company.id,
          user_id: created.user.id,
          role_id: role.id,
          active: true,
        });

      if (membershipError) {
        throw new Error(membershipError.message);
      }

      await this.replaceUserAreas(company.id, created.user.id, body.areaIds);
    } catch (error) {
      await client.auth.admin.deleteUser(created.user.id);

      throw new BadRequestException(
        `No se pudo vincular el usuario a ${company.name}: ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
    }

    return {
      ok: true,
      message: 'Usuario creado correctamente.',
    };
  }

  @Patch()
  async updateUser(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('company') companySlug = '',
    @Body() body: UpdateUserBody,
  ) {
    this.assertInternalKey(providedKey);

    const company = await this.getCompany(companySlug);
    const userId = this.requiredText(body.userId, 'Falta el usuario.');
    const membership = await this.getMembership(company.id, userId);
    const client = this.supabaseService.getClient();
    const currentRole = await this.getRoleById(membership.role_id, company.id);
    const nextRole =
      typeof body.roleKey === 'string'
        ? await this.getRole(body.roleKey, company.id)
        : currentRole;
    const nextActive =
      typeof body.active === 'boolean' ? body.active : membership.active;

    if (
      currentRole.key === 'owner' &&
      (!nextActive || nextRole.key !== 'owner')
    ) {
      await this.assertCompanyKeepsOwner(company.id, currentRole.id);
    }

    const membershipUpdate: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (nextRole.id !== membership.role_id) {
      membershipUpdate.role_id = nextRole.id;
    }

    if (nextActive !== membership.active) {
      membershipUpdate.active = nextActive;
    }

    if (Object.keys(membershipUpdate).length > 1) {
      const { error } = await client
        .from('company_memberships')
        .update(membershipUpdate)
        .eq('id', membership.id);

      if (error) {
        throw new BadRequestException(
          `No se pudo actualizar el usuario: ${error.message}`,
        );
      }
    }

    if (typeof body.fullName === 'string') {
      const fullName = this.requiredText(body.fullName, 'Escribe el nombre.');

      const { error } = await client
        .from('app_profiles')
        .update({
          full_name: fullName,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);

      if (error) {
        throw new BadRequestException(
          `No se pudo actualizar el nombre: ${error.message}`,
        );
      }

      await client.auth.admin.updateUserById(userId, {
        user_metadata: { full_name: fullName },
      });
    }

    if (body.areaIds !== undefined) {
      await this.replaceUserAreas(company.id, userId, body.areaIds);
    }

    return { ok: true, message: 'Usuario actualizado correctamente.' };
  }

  @Post('reset-password')
  async resetPassword(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('company') companySlug = '',
    @Body() body: ResetPasswordBody,
  ) {
    this.assertInternalKey(providedKey);

    const company = await this.getCompany(companySlug);
    const userId = this.requiredText(body.userId, 'Falta el usuario.');
    const password = this.validPassword(body.password);
    await this.getMembership(company.id, userId);

    const client = this.supabaseService.getClient();
    const { error: authError } = await client.auth.admin.updateUserById(userId, {
      password,
    });

    if (authError) {
      throw new BadRequestException(
        `No se pudo cambiar la contraseña: ${authError.message}`,
      );
    }

    const { error: profileError } = await client
      .from('app_profiles')
      .update({
        password_hash: this.accessAuthService.hash(password),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    if (profileError) {
      throw new BadRequestException(
        `No se pudo actualizar la contraseña: ${profileError.message}`,
      );
    }

    return { ok: true, message: 'Contraseña actualizada correctamente.' };
  }

  private assertInternalKey(providedKey: string): void {
    const expectedKey = process.env.CHATPRO_INBOX_KEY?.trim();

    if (!expectedKey || providedKey !== expectedKey) {
      throw new UnauthorizedException('No autorizado.');
    }
  }

  private async getCompany(companySlug: string) {
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

    return data as { id: string; name: string; slug: string };
  }

  private async getRolesForCompany(companyId: string): Promise<RoleRow[]> {
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

  private async buildCompanyUsers(companyId: string) {
    const client = this.supabaseService.getClient();
    const roles = await this.getRolesForCompany(companyId);
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

    const permissionsByRoleId = new Map<string, PermissionRow[]>();

    for (const item of rolePermissions.data ?? []) {
      const permission = permissionsById.get(item.permission_id);

      if (!permission) {
        continue;
      }

      const list = permissionsByRoleId.get(item.role_id) ?? [];
      list.push(permission);
      permissionsByRoleId.set(item.role_id, list);
    }

    const { data: membershipsData, error: membershipsError } = await client
      .from('company_memberships')
      .select('id, user_id, role_id, active, created_at, updated_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: true });

    if (membershipsError) {
      throw new BadRequestException(
        `No se pudieron consultar los usuarios: ${membershipsError.message}`,
      );
    }

    const memberships = (membershipsData ?? []) as MembershipRow[];
    const userIds = memberships.map((membership) => membership.user_id);
    const rolesById = new Map(roles.map((role) => [role.id, role]));

    const profiles =
      userIds.length > 0
        ? await client
            .from('app_profiles')
            .select('user_id, full_name, login_identifier, contact_email')
            .in('user_id', userIds)
        : { data: [], error: null };

    if (profiles.error) {
      throw new BadRequestException(
        `No se pudieron consultar los perfiles: ${profiles.error.message}`,
      );
    }

    const profilesByUserId = new Map(
      ((profiles.data ?? []) as ProfileRow[]).map((profile) => [
        profile.user_id,
        profile,
      ]),
    );

    const { data: areasData, error: areasError } = await client
      .from('service_areas')
      .select('id, name, is_active')
      .eq('company_id', companyId)
      .order('created_at', { ascending: true });

    if (areasError) {
      throw new BadRequestException(
        `No se pudieron consultar las áreas: ${areasError.message}`,
      );
    }

    const areas = (areasData ?? []) as Array<{ id: string; name: string; is_active: boolean }>;
    const areasById = new Map(areas.map((area) => [area.id, area]));
    const mappings = userIds.length > 0
      ? await client.from('advisor_service_areas').select('user_id, area_id').eq('company_id', companyId).in('user_id', userIds)
      : { data: [], error: null };

    if (mappings.error) {
      throw new BadRequestException(
        `No se pudieron consultar las áreas asignadas: ${mappings.error.message}`,
      );
    }

    const areaIdsByUser = new Map<string, string[]>();
    for (const item of mappings.data ?? []) {
      const list = areaIdsByUser.get(item.user_id) ?? [];
      list.push(item.area_id);
      areaIdsByUser.set(item.user_id, list);
    }

    const { data: authData, error: authError } =
      await client.auth.admin.listUsers({ page: 1, perPage: 1000 });

    if (authError) {
      throw new BadRequestException(
        `No se pudieron consultar los accesos: ${authError.message}`,
      );
    }

    const authById = new Map(
      (authData.users ?? []).map((user) => [user.id, user]),
    );

    return {
      areas: areas.map((area) => ({
        id: area.id,
        name: area.name,
        isActive: area.is_active,
      })),
      roles: roles.map((role) => ({
        key: role.key,
        name: role.name,
        description: role.description ?? '',
        scope: role.company_id ? 'custom' : 'base',
        permissions: (permissionsByRoleId.get(role.id) ?? [])
          .map((permission) => ({
            key: permission.key,
            name: permission.name,
            description: permission.description ?? '',
          }))
          .sort((left, right) => left.name.localeCompare(right.name)),
      })),
      users: memberships.map((membership) => {
        const profile = profilesByUserId.get(membership.user_id);
        const authUser = authById.get(membership.user_id);
        const role = rolesById.get(membership.role_id);

        return {
          id: membership.user_id,
          membershipId: membership.id,
          fullName:
            profile?.full_name ||
            String(authUser?.user_metadata?.full_name ?? '') ||
            'Sin nombre',
          identifier:
            profile?.login_identifier ||
            String(authUser?.user_metadata?.login_identifier ?? '') ||
            'Sin identificación',
          roleKey: role?.key ?? '',
          roleName: role?.name ?? 'Sin rol',
          active: membership.active,
          areaIds: areaIdsByUser.get(membership.user_id) ?? [],
          areas: (areaIdsByUser.get(membership.user_id) ?? [])
            .map((areaId) => areasById.get(areaId))
            .filter(Boolean)
            .map((area) => ({ id: area!.id, name: area!.name, isActive: area!.is_active })),
          createdAt: membership.created_at,
          lastSignInAt: authUser?.last_sign_in_at ?? null,
        };
      }),
    };
  }

  private async replaceUserAreas(companyId: string, userId: string, value: unknown): Promise<void> {
    if (value === undefined || value === null) return;
    if (!Array.isArray(value)) throw new BadRequestException('Las áreas del usuario no son válidas.');
    const areaIds = value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
    if (areaIds.length !== value.length || new Set(areaIds).size !== areaIds.length) {
      throw new BadRequestException('Las áreas del usuario no son válidas.');
    }
    const client = this.supabaseService.getClient();
    if (areaIds.length) {
      const { data, error } = await client.from('service_areas').select('id').eq('company_id', companyId).eq('is_active', true).in('id', areaIds);
      if (error) throw new BadRequestException(`No se pudieron validar las áreas: ${error.message}`);
      if ((data ?? []).length !== areaIds.length) throw new BadRequestException('Una o varias áreas no existen o están inactivas.');
    }
    const { error: deleteError } = await client.from('advisor_service_areas').delete().eq('company_id', companyId).eq('user_id', userId);
    if (deleteError) throw new BadRequestException(`No se pudieron actualizar las áreas: ${deleteError.message}`);
    if (!areaIds.length) return;
    const { error: insertError } = await client.from('advisor_service_areas').insert(areaIds.map((areaId) => ({ company_id: companyId, user_id: userId, area_id: areaId })));
    if (insertError) throw new BadRequestException(`No se pudieron asignar las áreas: ${insertError.message}`);
  }

  private async getMembership(companyId: string, userId: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('company_memberships')
      .select('id, user_id, role_id, active, created_at, updated_at')
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(
        `No se pudo consultar el usuario: ${error.message}`,
      );
    }

    if (!data) {
      throw new NotFoundException('El usuario no pertenece a esta empresa.');
    }

    return data as MembershipRow;
  }

  private async getRole(roleKey: string, companyId: string): Promise<RoleRow> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('app_roles')
      .select('id, key, name, description, company_id')
      .eq('key', roleKey.trim().toLowerCase())
      .maybeSingle();

    if (error) {
      throw new BadRequestException(
        `No se pudo consultar el rol: ${error.message}`,
      );
    }

    if (!data) {
      throw new BadRequestException('El rol seleccionado no existe.');
    }

    const role = data as RoleRow;

    if (role.company_id && role.company_id !== companyId) {
      throw new BadRequestException(
        'El rol seleccionado no pertenece a esta empresa.',
      );
    }

    return role;
  }

  private async getRoleById(
    roleId: string,
    companyId: string,
  ): Promise<RoleRow> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('app_roles')
      .select('id, key, name, description, company_id')
      .eq('id', roleId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(
        `No se pudo consultar el rol: ${error.message}`,
      );
    }

    if (!data) {
      throw new BadRequestException('No se encontró el rol del usuario.');
    }

    const role = data as RoleRow;

    if (role.company_id && role.company_id !== companyId) {
      throw new BadRequestException(
        'El rol del usuario no pertenece a esta empresa.',
      );
    }

    return role;
  }

  private async assertCompanyKeepsOwner(
    companyId: string,
    ownerRoleId: string,
  ): Promise<void> {
    const { count, error } = await this.supabaseService
      .getClient()
      .from('company_memberships')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('role_id', ownerRoleId)
      .eq('active', true);

    if (error) {
      throw new BadRequestException(
        `No se pudo validar los propietarios: ${error.message}`,
      );
    }

    if ((count ?? 0) <= 1) {
      throw new BadRequestException(
        'La empresa debe conservar al menos un propietario activo.',
      );
    }
  }

  private normalizeIdentifier(value: unknown): string {
    const identifier = this.requiredText(
      value,
      'Escribe la identificación o código de acceso.',
    )
      .toUpperCase()
      .replace(/\s+/g, '');

    if (!/^[A-Z0-9._-]{3,60}$/.test(identifier)) {
      throw new BadRequestException(
        'La identificación o código solo puede usar letras, números, punto, guion o guion bajo.',
      );
    }

    return identifier;
  }

  private technicalEmail(companySlug: string, identifier: string): string {
    const hash = createHash('sha256')
      .update(`${companySlug}:${identifier}`)
      .digest('hex')
      .slice(0, 28);

    return `access-${hash}@chatpro.invalid`;
  }

  private requiredText(value: unknown, message: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(message);
    }

    return value.trim();
  }

  private validPassword(value: unknown): string {
    const password = this.requiredText(
      value,
      'Escribe una contraseña inicial.',
    );

    if (password.length < 8) {
      throw new BadRequestException(
        'La contraseña debe tener mínimo 8 caracteres.',
      );
    }

    return password;
  }
}
