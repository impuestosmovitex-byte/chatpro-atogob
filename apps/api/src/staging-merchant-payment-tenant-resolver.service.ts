import {Injectable} from '@nestjs/common';
import {SupabaseService} from './supabase.service';

/** Find tenant candidates ONLY from server-created payment attempts with the
 * provider payment ID already bound. Never derive a tenant from webhook fields.
 * Ambiguous matches are rejected, even if both belong to the same company.
 */
@Injectable()
export class StagingMerchantPaymentTenantResolver {
 constructor(private readonly db:SupabaseService){}
 async findBoundMerchantAttempt(providerPaymentId:string):Promise<{
   companyId:string;orderId:string;attemptId:string;
 }|null>{
  if(process.env.MW1_STAGING_MODE!=='true'||
    !/^[0-9]{1,40}$/.test(providerPaymentId))return null;
  const {data,error}=await this.db.getClient().from('commerce_payments')
   .select('id,company_id,order_id')
   .eq('provider','mercado_pago')
   .eq('provider_payment_id',providerPaymentId)
   .limit(2);
  if(error||!data||data.length!==1)return null;
  const attempt=data[0];
  if(!attempt.id||!attempt.company_id||!attempt.order_id)return null;
  return {companyId:attempt.company_id,orderId:attempt.order_id,attemptId:attempt.id};
 }
}
