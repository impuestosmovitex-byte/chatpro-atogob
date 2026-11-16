import {ForbiddenException, Injectable, ServiceUnavailableException} from '@nestjs/common';
import {SupabaseService} from './supabase.service';

/**
 * Only manual contracts opt into this staging-only gate. Operational tenants
 * without manual contract rows keep the legacy paths unchanged.
 *
 * This is evaluated from the database for each guarded operation, including
 * requests using a still-valid browser cookie. The database is authoritative:
 * status='active' by itself is NOT proof of a current subscription.
 */
export type ManualContractWindow={
 status:string;starts_at:string;expires_at:string;
};
export type ManualAccessDecision={
 hasManualContract:boolean;commercialAllowed:boolean;
 state:'legacy'|'active'|'not_started'|'expired'|'suspended';
 expiresAt:string|null;
};
export function evaluateManualContractWindow(
 contract:ManualContractWindow|null, now:Date,
):ManualAccessDecision{
 if(!contract)return {hasManualContract:false,commercialAllowed:true,state:'legacy',expiresAt:null};
 const start=Date.parse(contract.starts_at);
 const expiry=Date.parse(contract.expires_at);
 const expiresAt=Number.isFinite(expiry)?new Date(expiry).toISOString():null;
 if(!Number.isFinite(start)||!Number.isFinite(expiry)||expiry<=start)
  return {hasManualContract:true,commercialAllowed:false,state:'suspended',expiresAt};
 if(contract.status!=='active')
  return {hasManualContract:true,commercialAllowed:false,state:'suspended',expiresAt};
 if(now.getTime()<start)
  return {hasManualContract:true,commercialAllowed:false,state:'not_started',expiresAt};
 if(now.getTime()>=expiry)
  return {hasManualContract:true,commercialAllowed:false,state:'expired',expiresAt};
 return {hasManualContract:true,commercialAllowed:true,state:'active',expiresAt};
}
@Injectable()
export class ManualContractAccessService{
 constructor(private readonly supabase:SupabaseService){}
 async access(companyId:string):Promise<ManualAccessDecision>{
  if(process.env.MW1_STAGING_MODE!=='true')
   return evaluateManualContractWindow(null,new Date());
  if(!companyId)throw new ForbiddenException('Empresa no identificada.');
  const {data,error}=await this.supabase.getClient()
   .from('mw1_manual_company_contracts')
   .select('status,starts_at,expires_at')
   .eq('company_id',companyId).maybeSingle();
  if(error)throw new ServiceUnavailableException(
   'No fue posible comprobar la vigencia contractual. Intenta nuevamente.',
  );
  return evaluateManualContractWindow(data as ManualContractWindow|null,new Date());
 }
 async assertCommercial(companyId:string):Promise<void>{
  const decision=await this.access(companyId);
  if(!decision.commercialAllowed)
   throw new ForbiddenException({
    code:'MW1_MANUAL_CONTRACT_INACTIVE',
    state:decision.state,
    expiresAt:decision.expiresAt,
    message:'La suscripción de esta empresa no está vigente. El propietario puede gestionar la renovación.',
   });
 }
 async assertLogin(companyId:string,roleKey:string):Promise<void>{
  const decision=await this.access(companyId);
  if(!decision.commercialAllowed &&
     !['owner','admin'].includes(roleKey.trim().toLowerCase()))
   throw new ForbiddenException({
    code:'MW1_MANUAL_CONTRACT_INACTIVE',
    state:decision.state,
    message:'El acceso de asesores está suspendido hasta que se renueve la suscripción.',
   });
  // Owner/admin can sign in to use plan/renewal management. Commercial
  // endpoints must independently call assertCommercial even for owners.
 }
}
