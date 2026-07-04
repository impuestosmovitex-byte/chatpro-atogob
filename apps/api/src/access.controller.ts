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
import { AccessAuthService } from './access-auth.service';
import { SupabaseService } from './supabase.service';

type CompanyRow = {
  id: string;
  name: string;
  slug: string;
};

type ProfileRow = {
  user_id: string;
  full_name: string;
  login_identifier: string | null;
  password_hash: string | null;
};

type MembershipRow = {
  user_id: string;
  role_id: string;
  active: boolean;
};

type RoleRow = {
  id: string;
  key: string;
  name: string;
  company_id: string | null;
};

type LoginBody = {
  identifier?: unknown;
  password?: unknown;
};

@Controller('access')
export class AccessController {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly accessAuthService: AccessAuthService,
  ) {}

  @Get('bootstrap-status')
  async bootstrapStatus(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('company') companySlug = '',
  ) {
    this.assertInternalKey(providedKey);
    const company = await this.getCompany(companySlug);

    const { count, error } = await this.supabaseService
      .getClient()
      .from('company_memberships')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', company.id)
      .eq('active', true);

    if (error) {
      throw new BadRequestException(
        `No se pudo validar el acceso inicial: ${error.message}`,
      );
    }

    return {
      ok: true,
      setupRequired: (count ?? 0) === 0,
      company,
    };
  }

  @Get('companies')
  async companies(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('user') userIdInput = '',
  ) {
    this.assertInternalKey(providedKey);

    const userId = userIdInput.trim();

    if (!userId) {
      throw new BadRequestException('Falta el usuario.');
    }

    const { data: membershipData, error: membershipError } =
      await this.supabaseService
        .getClient()
        .from('company_memberships')
        .select('company_id, role_id, active')
        .eq('user_id', userId)
        .eq('active', true);

    if (membershipError) {
      throw new BadRequestException(
        `No se pudieron cargar las empresas: ${membershipError.message}`,
      );
    }

    const memberships = (membershipData ?? []) as Array<{
      company_id: string;
      role_id: string;
      active: boolean;
    }>;

    if (memberships.length === 0) {
      return { ok: true, companies: [] };
    }

    const companyIds = [...new Set(memberships.map((item) => item.company_id))];
    const roleIds = [...new Set(memberships.map((item) => item.role_id))];

    const [{ data: companyData, error: companyError }, { data: roleData, error: roleError }] =
      await Promise.all([
        this.supabaseService
          .getClient()
          .from('companies')
          .select('id, slug, name, status')
          .in('id', companyIds)
          .eq('status', 'active'),
        this.supabaseService
          .getClient()
          .from('app_roles')
          .select('id, key, name, company_id')
          .in('id', roleIds),
      ]);

    if (companyError || roleError) {
      throw new BadRequestException(
        companyError?.message ||
          roleError?.message ||
          'No se pudieron validar las empresas disponibles.',
      );
    }

    const companyById = new Map(
      (companyData ?? []).map((company: any) => [company.id, company]),
    );
    const roleById = new Map(
      (roleData ?? []).map((role: any) => [role.id, role]),
    );

    const companies = memberships
      .map((membership) => {
        const company = companyById.get(membership.company_id);
        const role = roleById.get(membership.role_id);

        if (
          !company ||
          !role ||
          (role.company_id && role.company_id !== company.id)
        ) {
          return null;
        }

        return {
          id: company.id as string,
          slug: company.slug as string,
          name: company.name as string,
          roleKey: role.key as string,
          roleName: role.name as string,
        };
      })
      .filter(Boolean)
      .sort((left: any, right: any) => left.name.localeCompare(right.name));

    return { ok: true, companies };
  }

  @Post('switch-company')
  async switchCompany(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Body() body: { userId?: unknown; companySlug?: unknown },
  ) {
    this.assertInternalKey(providedKey);

    const userId = this.requiredText(body.userId, 'Falta el usuario.');
    const companySlug = this.requiredText(
      body.companySlug,
      'Falta la empresa.',
    ).toLowerCase();

    const company = await this.getCompany(companySlug);

    const { data: profileData, error: profileError } = await this.supabaseService
      .getClient()
      .from('app_profiles')
      .select('user_id, full_name')
      .eq('user_id', userId)
      .maybeSingle();

    if (profileError || !profileData) {
      throw new UnauthorizedException(
        profileError?.message || 'No se pudo validar el usuario.',
      );
    }

    const { data: membershipData, error: membershipError } =
      await this.supabaseService
        .getClient()
        .from('company_memberships')
        .select('user_id, role_id, active')
        .eq('company_id', company.id)
        .eq('user_id', userId)
        .maybeSingle();

    if (membershipError || !membershipData) {
      throw new UnauthorizedException(
        membershipError?.message ||
          'No tienes acceso activo a esta empresa.',
      );
    }

    const membership = membershipData as MembershipRow;

    if (!membership.active) {
      throw new UnauthorizedException(
        'No tienes acceso activo a esta empresa.',
      );
    }

    const { data: roleData, error: roleError } = await this.supabaseService
      .getClient()
      .from('app_roles')
      .select('id, key, name, company_id')
      .eq('id', membership.role_id)
      .maybeSingle();

    if (roleError || !roleData) {
      throw new BadRequestException(
        roleError?.message || 'No se pudo validar el rol.',
      );
    }

    const role = roleData as RoleRow;

    if (role.company_id && role.company_id !== company.id) {
      throw new UnauthorizedException(
        'El rol asignado no pertenece a esta empresa.',
      );
    }

    return {
      ok: true,
      session: {
        type: 'user',
        userId,
        companyId: company.id,
        companySlug: company.slug,
        companyName: company.name,
        fullName: profileData.full_name || 'Usuario',
        roleKey: role.key,
        roleName: role.name,
      },
    };
  }

  @Post('login')
  async login(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('company') companySlug = '',
    @Body() body: LoginBody,
  ) {
    this.assertInternalKey(providedKey);

    const company = await this.getCompany(companySlug);
    const identifier = this.normalizeIdentifier(body.identifier);
    const password = this.requiredText(body.password, 'Escribe la contraseña.');

    const { data: profileData, error: profileError } = await this.supabaseService
      .getClient()
      .from('app_profiles')
      .select('user_id, full_name, login_identifier, password_hash')
      .eq('login_identifier', identifier)
      .maybeSingle();

    if (profileError) {
      throw new BadRequestException(
        `No se pudo validar el acceso: ${profileError.message}`,
      );
    }

    const profile = profileData as ProfileRow | null;

    if (
      !profile?.password_hash ||
      !this.accessAuthService.verify(password, profile.password_hash)
    ) {
      throw new UnauthorizedException(
        'La identificación o la contraseña no son correctas.',
      );
    }

    const { data: membershipData, error: membershipError } =
      await this.supabaseService
        .getClient()
        .from('company_memberships')
        .select('user_id, role_id, active')
        .eq('company_id', company.id)
        .eq('user_id', profile.user_id)
        .maybeSingle();

    if (membershipError) {
      throw new BadRequestException(
        `No se pudo validar la empresa: ${membershipError.message}`,
      );
    }

    const membership = membershipData as MembershipRow | null;

    if (!membership?.active) {
      throw new UnauthorizedException(
        'Este usuario no tiene un acceso activo para esta empresa.',
      );
    }

    const { data: roleData, error: roleError } = await this.supabaseService
      .getClient()
      .from('app_roles')
      .select('id, key, name, company_id')
      .eq('id', membership.role_id)
      .maybeSingle();

    if (roleError || !roleData) {
      throw new BadRequestException(
        roleError?.message || 'No se pudo cargar el rol de este usuario.',
      );
    }

    const role = roleData as RoleRow;

    if (role.company_id && role.company_id !== company.id) {
      throw new UnauthorizedException(
        'El rol asignado no pertenece a esta empresa.',
      );
    }

    return {
      ok: true,
      session: {
        type: 'user',
        userId: profile.user_id,
        companyId: company.id,
        companySlug: company.slug,
        companyName: company.name,
        fullName: profile.full_name || identifier,
        roleKey: role.key,
        roleName: role.name,
      },
    };
  }

  private assertInternalKey(providedKey: string): void {
    const expectedKey = process.env.CHATPRO_INBOX_KEY?.trim();

    if (!expectedKey || providedKey !== expectedKey) {
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
      .eq('status', 'active')
      .maybeSingle();

    if (error) {
      throw new BadRequestException(
        `No se pudo consultar la empresa: ${error.message}`,
      );
    }

    if (!data) {
      throw new BadRequestException('Empresa no encontrada.');
    }

    return data as CompanyRow;
  }

  private normalizeIdentifier(value: unknown): string {
    const identifier = this.requiredText(
      value,
      'Escribe tu identificación o código.',
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

  private requiredText(value: unknown, message: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(message);
    }

    return value.trim();
  }
}
