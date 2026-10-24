import {Controller, ForbiddenException, Get, Headers, UnauthorizedException} from '@nestjs/common';
import {SupabaseService} from './supabase.service';

@Controller('staging-subscription-admin')
export class StagingSubscriptionAdminController {
 constructor(private readonly supabase:SupabaseService){}
 @Get()
 async list(@Headers('x-chatpro-inbox-key') key='',@Headers('x-chatpro-user-id') userId=''){
  if(process.env.MW1_STAGING_MODE!=='true')throw new ForbiddenException();
  if(!process.env.CHATPRO_INBOX_KEY||key!==process.env.CHATPRO_INBOX_KEY||!userId)throw new UnauthorizedException();
  const db=this.supabase.getClient();
  const {data:admin,error:adminError}=await db.from('platform_admins')
   .select('user_id').eq('user_id',userId).eq('active',true).maybeSingle();
  if(adminError||!admin)throw new ForbiddenException('Acceso reservado a superadministradores.');
  const {data:requests,error}=await db.from('mw1_subscription_requests')
   .select('id,company_id,requested_by,request_type,requested_plan_key,note,status,created_at,reviewed_at')
   .order('created_at',{ascending:false}).limit(100);
  if(error)throw new ForbiddenException('No se pudieron consultar las solicitudes.');
  const companyIds=[...new Set((requests??[]).map(r=>r.company_id))];
  const {data:companies}=companyIds.length?await db.from('companies').select('id,name,slug').in('id',companyIds):{data:[]};
  const names=new Map((companies??[]).map(c=>[c.id,{name:c.name,slug:c.slug}]));
  return {ok:true,requests:(requests??[]).map(r=>({...r,company:names.get(r.company_id)??null})),
   processingMode:'manual_review',billingConnected:false};
 }
}
