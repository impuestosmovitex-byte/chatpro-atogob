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
import { SupabaseService } from './supabase.service';
import { ConversationMemoryService } from './conversation-memory.service';

type Actor = {
  userId: string;
  fullName: string;
  permissions: Set<string>;
  isFullAccess: boolean;
};

type TagBody = {
  action?: unknown;
  company?: unknown;
  id?: unknown;
  name?: unknown;
  color?: unknown;
  isActive?: unknown;
};

@Controller('contact-tags')
export class ContactTagsController {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly conversationMemoryService: ConversationMemoryService,
  ) {}

  @Get()
  async list(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Headers('x-chatpro-session-type') sessionType = '',
    @Headers('x-chatpro-user-id') userId = '',
    @Headers('x-chatpro-user-name') fullName = '',
    @Headers('x-chatpro-company-id') headerCompanyId = '',
    @Headers('x-chatpro-role-key') roleKey = '',
    @Query('company') company = '',
  ) {
    this.authorize(providedKey);

    const profile =
      await this.conversationMemoryService.getCompanyProfile(
        this.requiredCompany(company),
      );

    const actor = await this.actor(
      sessionType,
      userId,
      fullName,
      headerCompanyId,
      roleKey,
      profile.id,
    );

    const { data, error } = await this.supabaseService
      .getClient()
      .from('contact_tag_definitions')
      .select('id,company_id,name,color,is_active,created_at,updated_at')
      .eq('company_id', profile.id)
      .order('name', { ascending: true });

    if (error) {
      throw new BadRequestException(
        `No se pudieron consultar las etiquetas: ${error.message}`,
      );
    }

    return {
      ok: true,
      canManageTags: actor.isFullAccess,
      tags: (data ?? []).map((row: any) => ({
        id: row.id,
        companyId: row.company_id,
        name: row.name,
        color: row.color,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    };
  }

  @Post()
  @HttpCode(200)
  async save(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Headers('x-chatpro-session-type') sessionType = '',
    @Headers('x-chatpro-user-id') userId = '',
    @Headers('x-chatpro-user-name') fullName = '',
    @Headers('x-chatpro-company-id') headerCompanyId = '',
    @Headers('x-chatpro-role-key') roleKey = '',
    @Query('company') companyQuery = '',
    @Body() body: TagBody = {},
  ) {
    this.authorize(providedKey);

    const company = this.requiredCompany(
      this.readText(body.company) || companyQuery,
    );

    const profile =
      await this.conversationMemoryService.getCompanyProfile(company);

    const actor = await this.actor(
      sessionType,
      userId,
      fullName,
      headerCompanyId,
      roleKey,
      profile.id,
    );

    if (!actor.isFullAccess) {
      throw new ForbiddenException(
        'Solo propietarios y administradores pueden administrar etiquetas.',
      );
    }

    const action = this.readText(body.action);

    if (action === 'create') {
      const name = this.requiredName(body.name);
      const color = this.readColor(body.color);

      const { data, error } = await this.supabaseService
        .getClient()
        .from('contact_tag_definitions')
        .insert({
          company_id: profile.id,
          name,
          color,
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .select('id,company_id,name,color,is_active,created_at,updated_at')
        .single();

      if (error || !data) {
        if (
          error?.code === '23505' ||
          error?.message?.toLowerCase().includes('duplicate')
        ) {
          throw new BadRequestException(
            'Ya existe una etiqueta con ese nombre.',
          );
        }

        throw new BadRequestException(
          `No se pudo crear la etiqueta: ${error?.message ?? 'respuesta vacía'}`,
        );
      }

      return {
        ok: true,
        tag: {
          id: data.id,
          companyId: data.company_id,
          name: data.name,
          color: data.color,
          isActive: data.is_active,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        },
      };
    }

    if (action === 'update') {
      const id = this.requiredId(body.id);
      const name = this.requiredName(body.name);
      const color = this.readColor(body.color);
      const isActive = this.readBoolean(body.isActive, true);
      const client = this.supabaseService.getClient();

      const { data: previous, error: previousError } = await client
        .from('contact_tag_definitions')
        .select('id,name')
        .eq('id', id)
        .eq('company_id', profile.id)
        .maybeSingle();

      if (previousError) {
        throw new BadRequestException(
          `No se pudo consultar la etiqueta actual: ${previousError.message}`,
        );
      }

      if (!previous) {
        throw new BadRequestException(
          'La etiqueta no existe en esta empresa.',
        );
      }

      const { data, error } = await client
        .from('contact_tag_definitions')
        .update({
          name,
          color,
          is_active: isActive,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('company_id', profile.id)
        .select('id,company_id,name,color,is_active,created_at,updated_at')
        .maybeSingle();

      if (error) {
        if (
          error.code === '23505' ||
          error.message?.toLowerCase().includes('duplicate')
        ) {
          throw new BadRequestException(
            'Ya existe una etiqueta con ese nombre.',
          );
        }

        throw new BadRequestException(
          `No se pudo actualizar la etiqueta: ${error.message}`,
        );
      }

      if (!data) {
        throw new BadRequestException(
          'La etiqueta no existe en esta empresa.',
        );
      }

      if (
        previous.name.trim().toLocaleLowerCase() !==
        data.name.trim().toLocaleLowerCase()
      ) {
        await this.replaceTagOnContacts(
          profile.id,
          previous.name,
          data.name,
        );
      }

      return {
        ok: true,
        tag: {
          id: data.id,
          companyId: data.company_id,
          name: data.name,
          color: data.color,
          isActive: data.is_active,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        },
      };
    }

    if (action === 'delete') {
      const id = this.requiredId(body.id);
      const client = this.supabaseService.getClient();

      const { data: current, error: currentError } = await client
        .from('contact_tag_definitions')
        .select('id,name')
        .eq('id', id)
        .eq('company_id', profile.id)
        .maybeSingle();

      if (currentError) {
        throw new BadRequestException(
          `No se pudo consultar la etiqueta: ${currentError.message}`,
        );
      }

      if (!current) {
        throw new BadRequestException(
          'La etiqueta no existe en esta empresa.',
        );
      }

      await this.removeTagFromContacts(profile.id, current.name);

      const { error: deleteError } = await client
        .from('contact_tag_definitions')
        .delete()
        .eq('id', id)
        .eq('company_id', profile.id);

      if (deleteError) {
        throw new BadRequestException(
          `No se pudo eliminar la etiqueta: ${deleteError.message}`,
        );
      }

      return {
        ok: true,
        deletedId: id,
        deletedName: current.name,
      };
    }

    throw new BadRequestException('Acción de etiqueta no válida.');
  }

  private async replaceTagOnContacts(
    companyId: string,
    oldName: string,
    newName: string,
  ): Promise<void> {
    const client = this.supabaseService.getClient();

    const { data: contacts, error } = await client
      .from('contacts')
      .select('id,tags')
      .eq('company_id', companyId);

    if (error) {
      throw new BadRequestException(
        `No se pudieron actualizar los contactos: ${error.message}`,
      );
    }

    const oldKey = oldName.trim().toLocaleLowerCase();

    for (const contact of contacts ?? []) {
      const tags = Array.isArray(contact.tags)
        ? contact.tags.filter((tag: unknown): tag is string =>
            typeof tag === 'string',
          )
        : [];

      let changed = false;

      const nextTags = tags.map((tag: string) => {
        if (tag.trim().toLocaleLowerCase() === oldKey) {
          changed = true;
          return newName;
        }

        return tag;
      });

      if (!changed) continue;

      const { error: updateError } = await client
        .from('contacts')
        .update({ tags: nextTags })
        .eq('id', contact.id)
        .eq('company_id', companyId);

      if (updateError) {
        throw new BadRequestException(
          `No se pudo propagar el cambio de etiqueta: ${updateError.message}`,
        );
      }
    }
  }

  private async removeTagFromContacts(
    companyId: string,
    name: string,
  ): Promise<void> {
    const client = this.supabaseService.getClient();

    const { data: contacts, error } = await client
      .from('contacts')
      .select('id,tags')
      .eq('company_id', companyId);

    if (error) {
      throw new BadRequestException(
        `No se pudieron consultar los contactos: ${error.message}`,
      );
    }

    const key = name.trim().toLocaleLowerCase();

    for (const contact of contacts ?? []) {
      const tags = Array.isArray(contact.tags)
        ? contact.tags.filter((tag: unknown): tag is string =>
            typeof tag === 'string',
          )
        : [];

      const nextTags = tags.filter(
        (tag: string) => tag.trim().toLocaleLowerCase() !== key,
      );

      if (nextTags.length === tags.length) continue;

      const { error: updateError } = await client
        .from('contacts')
        .update({ tags: nextTags })
        .eq('id', contact.id)
        .eq('company_id', companyId);

      if (updateError) {
        throw new BadRequestException(
          `No se pudo retirar la etiqueta de los contactos: ${updateError.message}`,
        );
      }
    }
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
      if (
        role !== 'owner' ||
        headerCompanyId.trim() !== companyId
      ) {
        throw new UnauthorizedException(
          'Sesión inicial no válida.',
        );
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
      throw new UnauthorizedException(
        'Sesión de asesor no válida.',
      );
    }

    const client = this.supabaseService.getClient();

    const { data: membership, error: membershipError } =
      await client
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
        (value: unknown): value is string =>
          typeof value === 'string',
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
        .filter(
          (value: unknown): value is string =>
            typeof value === 'string',
        ),
    );

    return {
      userId: id,
      fullName: name,
      permissions,
      isFullAccess:
        role === 'owner' || role === 'admin',
    };
  }

  private hasPermission(
    actor: Actor,
    permission: string,
  ): boolean {
    return (
      actor.isFullAccess ||
      actor.permissions.has(permission)
    );
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
    const expectedKey =
      process.env.CHATPRO_INBOX_KEY?.trim();

    if (
      !expectedKey ||
      providedKey.trim() !== expectedKey
    ) {
      throw new UnauthorizedException(
        'No autorizado para ver etiquetas.',
      );
    }
  }

  private requiredCompany(value: string): string {
    const company = value.trim().toLowerCase();

    if (!company) {
      throw new BadRequestException('Falta la empresa.');
    }

    return company;
  }

  private requiredId(value: unknown): string {
    const id = this.readText(value);

    if (!id) {
      throw new BadRequestException(
        'Falta el identificador de la etiqueta.',
      );
    }

    return id;
  }

  private requiredName(value: unknown): string {
    const name = this.readText(value);

    if (!name) {
      throw new BadRequestException(
        'Escribe el nombre de la etiqueta.',
      );
    }

    if (name.length > 60) {
      throw new BadRequestException(
        'La etiqueta no puede superar 60 caracteres.',
      );
    }

    return name;
  }

  private readColor(value: unknown): string {
    const color = this.readText(value).toLowerCase();

    const allowed = new Set([
      'green',
      'yellow',
      'red',
      'blue',
      'purple',
      'orange',
      'gray',
      'pink',
      'teal',
    ]);

    return allowed.has(color) ? color : 'green';
  }

  private readBoolean(
    value: unknown,
    fallback: boolean,
  ): boolean {
    if (typeof value === 'boolean') {
      return value;
    }

    if (value === 'true') {
      return true;
    }

    if (value === 'false') {
      return false;
    }

    return fallback;
  }

  private readText(value: unknown): string {
    return typeof value === 'string'
      ? value.trim()
      : '';
  }
}
