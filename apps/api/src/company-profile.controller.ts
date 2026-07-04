import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Put,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from './supabase.service';

type JsonObject = Record<string, unknown>;

type CompanyProfileBody = {
  businessName?: unknown;
  legalName?: unknown;
  taxId?: unknown;
  logoUrl?: unknown;
  phone?: unknown;
  email?: unknown;
  website?: unknown;
  country?: unknown;
  city?: unknown;
  currency?: unknown;
  timezone?: unknown;
};

type CompanyRow = {
  id: string;
  slug: string;
  name: string;
};

@Controller('company-profile')
export class CompanyProfileController {
  constructor(private readonly supabaseService: SupabaseService) {}

  @Get()
  async getProfile(
    @Headers('x-chatpro-inbox-key') accessKey: string | undefined,
    @Query('company') companySlug: string | undefined,
  ) {
    this.requireAccess(accessKey);
    const company = await this.getCompany(companySlug);
    const identity = await this.getIdentity(company.id);

    return {
      ok: true,
      company: {
        id: company.id,
        slug: company.slug,
        name: company.name,
      },
      identity: this.toResponseIdentity(company.name, identity),
    };
  }

  @Put()
  async saveProfile(
    @Headers('x-chatpro-inbox-key') accessKey: string | undefined,
    @Query('company') companySlug: string | undefined,
    @Body() body: CompanyProfileBody,
  ) {
    this.requireAccess(accessKey);
    const company = await this.getCompany(companySlug);

    const businessName = this.requiredText(
      body?.businessName,
      'Escribe el nombre comercial de la empresa.',
    );

    const client = this.supabaseService.getClient();
    const { error: companyError } = await client
      .from('companies')
      .update({ name: businessName })
      .eq('id', company.id);

    if (companyError) {
      throw new BadRequestException(
        `No se pudo guardar el nombre comercial: ${companyError.message}`,
      );
    }

    const currentSettings = await this.getSettings(company.id);
    const nextSettings: JsonObject = { ...currentSettings };
    const currentIdentity = this.toRecord(nextSettings.business_identity);

    nextSettings.business_identity = {
      ...currentIdentity,
      legal_name: this.optionalText(body?.legalName),
      tax_id: this.optionalText(body?.taxId),
      logo_url: this.optionalText(body?.logoUrl),
      phone: this.optionalText(body?.phone),
      email: this.optionalText(body?.email),
      website: this.optionalText(body?.website),
      country: this.optionalText(body?.country),
      city: this.optionalText(body?.city),
      currency: this.optionalText(body?.currency) || 'COP',
      timezone: this.optionalText(body?.timezone) || 'America/Bogota',
    };

    // Mantiene la zona horaria operativa existente y la sincroniza con identidad.
    nextSettings.timezone =
      this.optionalText(body?.timezone) || 'America/Bogota';

    const { error: settingsError } = await client
      .from('company_settings')
      .upsert(
        {
          company_id: company.id,
          settings: nextSettings,
        },
        { onConflict: 'company_id' },
      );

    if (settingsError) {
      throw new BadRequestException(
        `No se pudo guardar la identidad: ${settingsError.message}`,
      );
    }

    const updatedCompany = await this.getCompanyById(company.id);
    const updatedIdentity = await this.getIdentity(company.id);

    return {
      ok: true,
      company: {
        id: updatedCompany.id,
        slug: updatedCompany.slug,
        name: updatedCompany.name,
      },
      identity: this.toResponseIdentity(updatedCompany.name, updatedIdentity),
    };
  }

  private requireAccess(accessKey: string | undefined) {
    const expected = process.env.CHATPRO_INBOX_KEY?.trim();

    if (!expected || accessKey?.trim() !== expected) {
      throw new UnauthorizedException('Acceso no autorizado.');
    }
  }

  private async getCompany(companySlug: string | undefined): Promise<CompanyRow> {
    const slug = companySlug?.trim().toLowerCase();

    if (!slug) {
      throw new BadRequestException('Falta la empresa.');
    }

    const { data, error } = await this.supabaseService
      .getClient()
      .from('companies')
      .select('id, slug, name')
      .eq('slug', slug)
      .eq('status', 'active')
      .maybeSingle();

    if (error || !data) {
      throw new BadRequestException(
        error?.message || 'No existe una empresa activa con ese identificador.',
      );
    }

    return data as CompanyRow;
  }

  private async getCompanyById(companyId: string): Promise<CompanyRow> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('companies')
      .select('id, slug, name')
      .eq('id', companyId)
      .eq('status', 'active')
      .maybeSingle();

    if (error || !data) {
      throw new BadRequestException(
        error?.message || 'No existe una empresa activa con ese identificador.',
      );
    }

    return data as CompanyRow;
  }

  private async getSettings(companyId: string): Promise<JsonObject> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('company_settings')
      .select('settings')
      .eq('company_id', companyId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(
        `No se pudo consultar la configuración: ${error.message}`,
      );
    }

    return this.toRecord(data?.settings);
  }

  private async getIdentity(companyId: string): Promise<JsonObject> {
    const settings = await this.getSettings(companyId);
    return this.toRecord(settings.business_identity);
  }

  private toResponseIdentity(companyName: string, identity: JsonObject) {
    return {
      businessName: companyName,
      legalName: this.text(identity.legal_name),
      taxId: this.text(identity.tax_id),
      logoUrl: this.text(identity.logo_url),
      phone: this.text(identity.phone),
      email: this.text(identity.email),
      website: this.text(identity.website),
      country: this.text(identity.country),
      city: this.text(identity.city),
      currency: this.text(identity.currency) || 'COP',
      timezone: this.text(identity.timezone) || 'America/Bogota',
    };
  }

  private requiredText(value: unknown, message: string): string {
    const text = this.text(value);

    if (!text) {
      throw new BadRequestException(message);
    }

    return text;
  }

  private optionalText(value: unknown): string {
    return this.text(value);
  }

  private text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private toRecord(value: unknown): JsonObject {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as JsonObject;
    }

    return {};
  }
}
