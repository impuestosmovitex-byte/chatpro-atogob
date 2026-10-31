import { Injectable } from '@nestjs/common';
import { SupabaseService } from './supabase.service';
import { IntegrationCredentialsService } from './integration-credentials.service';

/**
 * Resolves a Mercado Pago merchant token only inside the API server.
 * The web client, AI model, chat messages and API responses must never
 * receive this value. This does not authorize payments by itself.
 */
@Injectable()
export class StagingMerchantPaymentCredentialsService {
  constructor(
    private readonly db: SupabaseService,
    private readonly encryption: IntegrationCredentialsService,
  ) {}

  async resolveMercadoPago(companyId:string):Promise<{accessToken:string;merchantId:string}> {
    if(process.env.MW1_STAGING_MODE!=='true' ||
       process.env.MW1_MP_SANDBOX_ORDERS_ENABLED!=='true'){
      throw new Error('Credenciales de pagos deshabilitadas.');
    }
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyId)){
      throw new Error('Empresa inválida.');
    }
    const {data,error}=await this.db.getClient().from('company_integrations')
      .select('company_id,external_id,status,credential_mode,credentials_encrypted')
      .eq('company_id',companyId)
      .eq('provider','mercado_pago')
      .eq('integration_type','payments')
      .eq('status','active')
      .limit(2);
    if(error||!data||data.length!==1){
      throw new Error('No existe una conexión de pagos activa y única para la empresa.');
    }
    const record=data[0];
    if(record.company_id!==companyId || record.credential_mode!=='encrypted' ||
       typeof record.credentials_encrypted!=='string' ||
       typeof record.external_id!=='string' || !/^\d{4,24}$/.test(record.external_id)){
      throw new Error('Conexión de pagos inválida.');
    }
    const credentials=this.encryption.decrypt(record.credentials_encrypted);
    const token=credentials.access_token;
    if(typeof token!=='string'||!/^TEST-[A-Za-z0-9_-]{20,}$/.test(token)){
      throw new Error('La conexión no contiene una credencial sandbox válida.');
    }
    return {accessToken:token,merchantId:record.external_id};
  }
}
