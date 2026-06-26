import { Injectable } from '@nestjs/common';
import { SupabaseService } from './supabase.service';

type CompanyIntegrationRow = {
  id: string;
  company_id: string;
  provider: string;
  integration_type: string;
  external_id: string;
  status: 'pending' | 'active' | 'disconnected' | 'error';
  config: unknown;
  credential_mode: 'environment' | 'encrypted';
  credential_reference: unknown;
};

export type CompanyIntegration = {
  id: string;
  companyId: string;
  provider: string;
  integrationType: string;
  externalId: string;
  status: 'pending' | 'active' | 'disconnected' | 'error';
  config: Record<string, unknown>;
  credentialMode: 'environment' | 'encrypted';
  credentialReference: Record<string, unknown>;
};

@Injectable()
export class CompanyIntegrationService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async getActiveIntegration(
    companyId: string,
    provider: string,
    integrationType: string,
  ): Promise<CompanyIntegration | null> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('company_integrations')
      .select(
        'id, company_id, provider, integration_type, external_id, status, config, credential_mode, credential_reference',
      )
      .eq('company_id', companyId)
      .eq('provider', provider)
      .eq('integration_type', integrationType)
      .eq('status', 'active')
      .maybeSingle();

    if (error) {
      throw new Error(
        `No se pudo consultar la integración de la empresa: ${error.message}`,
      );
    }

    return data
      ? this.mapIntegration(data as CompanyIntegrationRow)
      : null;
  }

  async findActiveIntegrationByExternalId(
    provider: string,
    integrationType: string,
    externalId: string,
  ): Promise<CompanyIntegration | null> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('company_integrations')
      .select(
        'id, company_id, provider, integration_type, external_id, status, config, credential_mode, credential_reference',
      )
      .eq('provider', provider)
      .eq('integration_type', integrationType)
      .eq('external_id', externalId)
      .eq('status', 'active')
      .maybeSingle();

    if (error) {
      throw new Error(
        `No se pudo identificar la integración entrante: ${error.message}`,
      );
    }

    return data
      ? this.mapIntegration(data as CompanyIntegrationRow)
      : null;
  }

  private mapIntegration(row: CompanyIntegrationRow): CompanyIntegration {
    return {
      id: row.id,
      companyId: row.company_id,
      provider: row.provider,
      integrationType: row.integration_type,
      externalId: row.external_id,
      status: row.status,
      config: this.toRecord(row.config),
      credentialMode: row.credential_mode,
      credentialReference: this.toRecord(row.credential_reference),
    };
  }

  private toRecord(value: unknown): Record<string, unknown> {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      return value as Record<string, unknown>;
    }

    return {};
  }
}