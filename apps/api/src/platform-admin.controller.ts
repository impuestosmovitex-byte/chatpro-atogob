import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { AccessAuthService } from './access-auth.service';
import { SupabaseService } from './supabase.service';

type CreateCompanyBody = {
  name?: unknown;
  slug?: unknown;
  planKey?: unknown;
  aiEnabled?: unknown;
  whatsappEnabled?: unknown;
  instagramEnabled?: unknown;
  messengerEnabled?: unknown;
  automationsEnabled?: unknown;
  statisticsEnabled?: unknown;
  maxUsers?: unknown;
  maxWhatsappLines?: unknown;
  ownerFullName?: unknown;
  ownerIdentifier?: unknown;
  ownerPassword?: unknown;
};

type EntitlementRow = {
  company_id: string;
  plan_key: string;
  ai_enabled: boolean;
  whatsapp_enabled: boolean;
  instagram_enabled: boolean;
  messenger_enabled: boolean;
  automations_enabled: boolean;
  statistics_enabled: boolean;
  max_users: number;
  max_whatsapp_lines: number;
};

@Controller('platform-admin')
export class PlatformAdminController {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly accessAuthService: AccessAuthService,
  ) {}

  @Get('me')
  async me(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('user') userId = '',
  ) {
    this.assertInternalKey(providedKey);
    const normalizedUserId = this.requiredText(userId, 'Falta el usuario.');

    return {
      ok: true,
      platformAdmin: await this.isPlatformAdmin(normalizedUserId),
    };
  }

  @Get('companies')
  async listCompanies(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('user') userId = '',
  ) {
    this.assertInternalKey(providedKey);
    await this.assertPlatformAdmin(userId);

    const client = this.supabaseService.getClient();
    const { data: companies, error: companiesError } = await client
      .from('companies')
      .select('id,slug,name,status')
      .order('name', { ascending: true });

    if (companiesError) {
      throw new BadRequestException(
        `No se pudieron consultar las empresas: ${companiesError.message}`,
      );
    }

    const companyIds = (companies ?? []).map((company) => company.id);

    const entitlements = companyIds.length
      ? await client
          .from('company_entitlements')
          .select(
            'company_id,plan_key,ai_enabled,whatsapp_enabled,instagram_enabled,messenger_enabled,automations_enabled,statistics_enabled,max_users,max_whatsapp_lines',
          )
          .in('company_id', companyIds)
      : { data: [], error: null };

    if (entitlements.error) {
      throw new BadRequestException(
        `No se pudieron consultar los planes: ${entitlements.error.message}`,
      );
    }

    const memberships = companyIds.length
      ? await client
          .from('company_memberships')
          .select('company_id')
          .in('company_id', companyIds)
          .eq('active', true)
      : { data: [], error: null };

    if (memberships.error) {
      throw new BadRequestException(
        `No se pudieron consultar los usuarios: ${memberships.error.message}`,
      );
    }

    const entitlementsByCompany = new Map<string, EntitlementRow>(
      ((entitlements.data ?? []) as EntitlementRow[]).map((row) => [
        row.company_id,
        row,
      ]),
    );

    const activeUsersByCompany = new Map<string, number>();
    for (const membership of memberships.data ?? []) {
      activeUsersByCompany.set(
        membership.company_id,
        (activeUsersByCompany.get(membership.company_id) ?? 0) + 1,
      );
    }

    return {
      ok: true,
      companies: (companies ?? []).map((company) => {
        const entitlement = entitlementsByCompany.get(company.id);

        return {
          id: company.id,
          slug: company.slug,
          name: company.name,
          status: company.status,
          activeUsers: activeUsersByCompany.get(company.id) ?? 0,
          entitlements: entitlement
            ? this.toEntitlementResponse(entitlement)
            : {
                planKey: 'legacy',
                aiEnabled: true,
                whatsappEnabled: true,
                instagramEnabled: true,
                messengerEnabled: true,
                automationsEnabled: true,
                statisticsEnabled: true,
                maxUsers: null,
                maxWhatsappLines: null,
              },
        };
      }),
    };
  }

  @Post('companies')
  async createCompany(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('user') userId = '',
    @Body() body: CreateCompanyBody,
  ) {
    this.assertInternalKey(providedKey);
    await this.assertPlatformAdmin(userId);

    const name = this.requiredText(body.name, 'Escribe el nombre de la empresa.');
    const slug = this.validSlug(body.slug);
    const planKey = this.optionalText(body.planKey).toLowerCase() || 'custom';
    const maxUsers = this.positiveInteger(body.maxUsers, 3, 'usuarios');
    const maxWhatsappLines = this.positiveInteger(
      body.maxWhatsappLines,
      1,
      'líneas de WhatsApp',
    );
    const ownerFullName = this.requiredText(
      body.ownerFullName,
      'Escribe el nombre del propietario.',
    );
    const ownerIdentifier = this.normalizeIdentifier(body.ownerIdentifier);
    const ownerPassword = this.validPassword(body.ownerPassword);

    const entitlement = {
      plan_key: planKey,
      ai_enabled: body.aiEnabled === true,
      whatsapp_enabled: body.whatsappEnabled !== false,
      instagram_enabled: body.instagramEnabled === true,
      messenger_enabled: body.messengerEnabled === true,
      automations_enabled: body.automationsEnabled !== false,
      statistics_enabled: body.statisticsEnabled !== false,
      max_users: maxUsers,
      max_whatsapp_lines: maxWhatsappLines,
    };

    const client = this.supabaseService.getClient();

    const { data: existingCompany, error: existingCompanyError } = await client
      .from('companies')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();

    if (existingCompanyError) {
      throw new BadRequestException(
        `No se pudo validar el identificador de empresa: ${existingCompanyError.message}`,
      );
    }

    if (existingCompany) {
      throw new BadRequestException('Ya existe una empresa con ese identificador.');
    }

    const { data: existingProfile, error: existingProfileError } = await client
      .from('app_profiles')
      .select('user_id')
      .eq('login_identifier', ownerIdentifier)
      .maybeSingle();

    if (existingProfileError) {
      throw new BadRequestException(
        `No se pudo validar el acceso del propietario: ${existingProfileError.message}`,
      );
    }

    if (existingProfile) {
      throw new BadRequestException(
        'La identificación o código del propietario ya está en uso.',
      );
    }

    const { data: ownerRole, error: ownerRoleError } = await client
      .from('app_roles')
      .select('id,key')
      .eq('key', 'owner')
      .is('company_id', null)
      .maybeSingle();

    if (ownerRoleError || !ownerRole?.id) {
      throw new BadRequestException(
        ownerRoleError?.message || 'No existe el rol base Propietario.',
      );
    }

    let createdCompanyId = '';
    let createdUserId = '';

    try {
      const { data: company, error: companyError } = await client
        .from('companies')
        .insert({ name, slug, status: 'active' })
        .select('id,slug,name,status')
        .single();

      if (companyError || !company?.id) {
        throw new Error(companyError?.message || 'No se pudo crear la empresa.');
      }

      createdCompanyId = company.id;

      const { error: entitlementError } = await client
        .from('company_entitlements')
        .insert({
          company_id: createdCompanyId,
          ...entitlement,
        });

      if (entitlementError) {
        throw new Error(entitlementError.message);
      }

      const technicalEmail = this.technicalEmail(slug, ownerIdentifier);
      const { data: authUser, error: authError } =
        await client.auth.admin.createUser({
          email: technicalEmail,
          password: ownerPassword,
          email_confirm: true,
          user_metadata: {
            full_name: ownerFullName,
            login_identifier: ownerIdentifier,
          },
        });

      if (authError || !authUser.user) {
        throw new Error(authError?.message || 'No se pudo crear el propietario.');
      }

      createdUserId = authUser.user.id;

      const { error: profileError } = await client.from('app_profiles').upsert(
        {
          user_id: createdUserId,
          full_name: ownerFullName,
          email: technicalEmail,
          contact_email: null,
          login_identifier: ownerIdentifier,
          password_hash: this.accessAuthService.hash(ownerPassword),
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
          company_id: createdCompanyId,
          user_id: createdUserId,
          role_id: ownerRole.id,
          active: true,
        });

      if (membershipError) {
        throw new Error(membershipError.message);
      }

      const { error: settingsError } = await client
        .from('company_settings')
        .upsert(
          {
            company_id: createdCompanyId,
            settings: {},
          },
          { onConflict: 'company_id' },
        );

      if (settingsError) {
        throw new Error(settingsError.message);
      }

      return {
        ok: true,
        message: 'Empresa y propietario creados correctamente.',
        company: {
          id: company.id,
          slug: company.slug,
          name: company.name,
          status: company.status,
        },
        entitlements: this.toEntitlementResponse({
          company_id: createdCompanyId,
          ...entitlement,
        } as EntitlementRow),
        owner: {
          userId: createdUserId,
          fullName: ownerFullName,
          identifier: ownerIdentifier,
        },
      };
    } catch (error) {
      if (createdUserId) {
        await client.auth.admin.deleteUser(createdUserId);
      }

      if (createdCompanyId) {
        await client.from('company_memberships').delete().eq('company_id', createdCompanyId);
        await client.from('company_settings').delete().eq('company_id', createdCompanyId);
        await client.from('company_entitlements').delete().eq('company_id', createdCompanyId);
        await client.from('companies').delete().eq('id', createdCompanyId);
      }

      throw new BadRequestException(
        `No se pudo crear la empresa: ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
    }
  }

  private async assertPlatformAdmin(userId: string): Promise<void> {
    const normalizedUserId = this.requiredText(userId, 'Falta el usuario.');

    if (!(await this.isPlatformAdmin(normalizedUserId))) {
      throw new UnauthorizedException(
        'No tienes permiso de Super Admin de MW1.',
      );
    }
  }

  private async isPlatformAdmin(userId: string): Promise<boolean> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('platform_admins')
      .select('user_id,active')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(
        `No se pudo validar el Super Admin: ${error.message}`,
      );
    }

    return data?.active === true;
  }

  private assertInternalKey(providedKey: string): void {
    const expectedKey = process.env.CHATPRO_INBOX_KEY?.trim();

    if (!expectedKey || providedKey !== expectedKey) {
      throw new UnauthorizedException('No autorizado.');
    }
  }

  private toEntitlementResponse(row: EntitlementRow) {
    return {
      planKey: row.plan_key,
      aiEnabled: row.ai_enabled,
      whatsappEnabled: row.whatsapp_enabled,
      instagramEnabled: row.instagram_enabled,
      messengerEnabled: row.messenger_enabled,
      automationsEnabled: row.automations_enabled,
      statisticsEnabled: row.statistics_enabled,
      maxUsers: row.max_users,
      maxWhatsappLines: row.max_whatsapp_lines,
    };
  }

  private validSlug(value: unknown): string {
    const slug = this.requiredText(
      value,
      'Escribe el identificador de la empresa.',
    )
      .toLowerCase()
      .replace(/\s+/g, '-');

    if (!/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(slug)) {
      throw new BadRequestException(
        'El identificador solo puede usar letras minúsculas, números y guiones.',
      );
    }

    return slug;
  }

  private normalizeIdentifier(value: unknown): string {
    const identifier = this.requiredText(
      value,
      'Escribe la identificación o código de acceso del propietario.',
    )
      .toUpperCase()
      .replace(/\s+/g, '');

    if (!/^[A-Z0-9._-]{3,60}$/.test(identifier)) {
      throw new BadRequestException(
        'El código de acceso solo puede usar letras, números, punto, guion o guion bajo.',
      );
    }

    return identifier;
  }

  private validPassword(value: unknown): string {
    const password = this.requiredText(
      value,
      'Escribe una contraseña inicial para el propietario.',
    );

    if (password.length < 8) {
      throw new BadRequestException(
        'La contraseña debe tener mínimo 8 caracteres.',
      );
    }

    return password;
  }

  private positiveInteger(
    value: unknown,
    fallback: number,
    label: string,
  ): number {
    if (value === undefined || value === null || value === '') return fallback;

    const number = Number(value);
    if (!Number.isInteger(number) || number < 1 || number > 1000) {
      throw new BadRequestException(`El límite de ${label} no es válido.`);
    }

    return number;
  }

  private technicalEmail(companySlug: string, identifier: string): string {
    const hash = createHash('sha256')
      .update(`${companySlug}:${identifier}`)
      .digest('hex')
      .slice(0, 28);

    return `access-${hash}@chatpro.invalid`;
  }

  private optionalText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private requiredText(value: unknown, message: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(message);
    }

    return value.trim();
  }
}
