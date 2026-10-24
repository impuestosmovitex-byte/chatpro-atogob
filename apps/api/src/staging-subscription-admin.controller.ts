import {BadRequestException, Body, Controller, ForbiddenException, Get, Headers, Post, UnauthorizedException} from '@nestjs/common';
import {SupabaseService} from './supabase.service';

@Controller('staging-subscription-admin')
export class StagingSubscriptionAdminController {
 constructor(private readonly supabase:SupabaseService){}
 @Post('review')
 async review(
  @Headers('x-chatpro-inbox-key') key='',
  @Headers('x-chatpro-user-id') userId='',
  @Body() body:{requestId?:string;decision?:string;note?:string},
 ){
  if(process.env.MW1_STAGING_MODE!=='true')throw new ForbiddenException();
  if(!process.env.CHATPRO_INBOX_KEY||key!==process.env.CHATPRO_INBOX_KEY||!userId)throw new UnauthorizedException();
  const db=this.supabase.getClient();
  const {data:admin}=await db.from('platform_admins').select('user_id').eq('user_id',userId).eq('active',true).maybeSingle();
  if(!admin)throw new ForbiddenException();
  const decision=body?.decision;
  const note=String(body?.note??'').trim().slice(0,1000);
  if(!['approved','rejected'].includes(String(decision))||!note)
   throw new BadRequestException('Selecciona una decisión y escribe el motivo.');
  const {data:request,error:readError}=await db.from('mw1_subscription_requests')
   .select('id,status').eq('id',body?.requestId??'').maybeSingle();
  if(readError||!request||request.status!=='pending')
   throw new BadRequestException('La solicitud no existe o ya fue revisada.');
  const {data:updated,error:updateError}=await db.from('mw1_subscription_requests')
   .update({status:decision,reviewed_by:userId,reviewed_at:new Date().toISOString(),review_note:note})
   .eq('id',request.id).eq('status','pending').select('id,status').maybeSingle();
  if(updateError||!updated)throw new BadRequestException('La solicitud ya fue procesada. Actualiza la lista.');
  const {error:auditError}=await db.from('mw1_subscription_request_events')
   .insert({request_id:request.id,actor_id:userId,action:decision,note});
  if(auditError)throw new BadRequestException('Se guardó la decisión, pero falló la auditoría. Contacta soporte.');
  return {ok:true,request:updated,message:'Decisión registrada. El plan y la facturación no fueron modificados.'};
 }
 @Get()
 async list(@Headers('x-chatpro-inbox-key') key='',@Headers('x-chatpro-user-id') userId=''){
  if(process.env.MW1_STAGING_MODE!=='true')throw new ForbiddenException();
  if(!process.env.CHATPRO_INBOX_KEY||key!==process.env.CHATPRO_INBOX_KEY||!userId)throw new UnauthorizedException();
  const db=this.supabase.getClient();
  const {data:admin,error:adminError}=await db.from('platform_admins')
   .select('user_id').eq('user_id',userId).eq('active',true).maybeSingle();
  if(adminError||!admin)throw new ForbiddenException('Acceso reservado a superadministradores.');
  const {data:requests,error}=await db.from('mw1_subscription_requests')
   .select('id,company_id,requested_by,request_type,requested_plan_key,additional_users,note,status,created_at,reviewed_at')
   .order('created_at',{ascending:false}).limit(100);
  if(error)throw new ForbiddenException('No se pudieron consultar las solicitudes.');
  const companyIds=[...new Set((requests??[]).map(r=>r.company_id))];
  const {data:companies}=companyIds.length?await db.from('companies').select('id,name,slug').in('id',companyIds):{data:[]};
  const names=new Map((companies??[]).map(c=>[c.id,{name:c.name,slug:c.slug}]));
  return {ok:true,requests:(requests??[]).map(r=>({...r,company:names.get(r.company_id)??null})),
   processingMode:'manual_review',billingConnected:false};
 }
}
