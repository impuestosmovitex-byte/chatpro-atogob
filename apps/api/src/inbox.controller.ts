import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, HttpCode, Param, Post, Query, UnauthorizedException } from '@nestjs/common';
import { ConversationMemoryService, type ConversationSession, type InboxSessionSummary } from './conversation-memory.service';
import { SupabaseService } from './supabase.service';

type InboxBody = { message?: unknown };
type Actor = { userId:string; fullName:string; permissions:Set<string>; isFullAccess:boolean };

@Controller('inbox')
export class InboxController {
  constructor(private readonly conversationMemoryService: ConversationMemoryService, private readonly supabaseService: SupabaseService) {}

  @Get()
  async list(@Headers('x-chatpro-inbox-key') key='', @Headers('x-chatpro-user-id') userId='', @Headers('x-chatpro-user-name') fullName='', @Headers('x-chatpro-company-id') headerCompanyId='', @Headers('x-chatpro-role-key') roleKey='', @Query('company') company='', @Query('status') status='all', @Query('limit') limit='60') {
    this.authorize(key);
    const payload=await this.conversationMemoryService.listInboxSessions(this.requiredCompany(company),status,Number(limit));
    const actor=await this.actor(userId,fullName,headerCompanyId,roleKey,payload.company.id);
    return {ok:true,...payload,sessions:payload.sessions.filter(session=>this.canView(actor,session))};
  }

  @Get(':sessionId')
  async getConversation(@Headers('x-chatpro-inbox-key') key='', @Headers('x-chatpro-user-id') userId='', @Headers('x-chatpro-user-name') fullName='', @Headers('x-chatpro-company-id') headerCompanyId='', @Headers('x-chatpro-role-key') roleKey='', @Query('company') company='', @Param('sessionId') sessionId='') {
    this.authorize(key);
    const conversation=await this.conversationMemoryService.getInboxConversation(this.requiredCompany(company),sessionId);
    const actor=await this.actor(userId,fullName,headerCompanyId,roleKey,conversation.company.id);
    this.assertView(actor,conversation.session);
    return {ok:true,...conversation};
  }

  @Post(':sessionId/take') @HttpCode(200)
  async takeConversation(@Headers('x-chatpro-inbox-key') key='', @Headers('x-chatpro-user-id') userId='', @Headers('x-chatpro-user-name') fullName='', @Headers('x-chatpro-company-id') headerCompanyId='', @Headers('x-chatpro-role-key') roleKey='', @Query('company') company='', @Param('sessionId') sessionId='') {
    this.authorize(key);
    const conversation=await this.conversationMemoryService.getInboxConversation(this.requiredCompany(company),sessionId);
    const actor=await this.actor(userId,fullName,headerCompanyId,roleKey,conversation.company.id);
    if(!actor.isFullAccess&&!actor.permissions.has('inbox.take')) throw new ForbiddenException('No tienes permiso para tomar conversaciones.');
    if(!actor.isFullAccess&&!this.canView(actor,conversation.session)) throw new ForbiddenException('No tienes permiso para tomar esta conversación.');
    return {ok:true,session:await this.conversationMemoryService.takeConversation(sessionId,{userId:actor.userId,fullName:actor.fullName})};
  }

  @Post(':sessionId/close') @HttpCode(200)
  async closeConversation(@Headers('x-chatpro-inbox-key') key='', @Headers('x-chatpro-user-id') userId='', @Headers('x-chatpro-user-name') fullName='', @Headers('x-chatpro-company-id') headerCompanyId='', @Headers('x-chatpro-role-key') roleKey='', @Query('company') company='', @Param('sessionId') sessionId='') {
    this.authorize(key);
    const conversation=await this.conversationMemoryService.getInboxConversation(this.requiredCompany(company),sessionId);
    const actor=await this.actor(userId,fullName,headerCompanyId,roleKey,conversation.company.id);
    this.assertManageOwn(actor,conversation.session,'inbox.close');
    return {ok:true,session:await this.conversationMemoryService.closeConversation(sessionId)};
  }

  @Post(':sessionId/resume-ai') @HttpCode(200)
  async resumeAiConversation(@Headers('x-chatpro-inbox-key') key='', @Headers('x-chatpro-user-id') userId='', @Headers('x-chatpro-user-name') fullName='', @Headers('x-chatpro-company-id') headerCompanyId='', @Headers('x-chatpro-role-key') roleKey='', @Query('company') company='', @Param('sessionId') sessionId='') {
    this.authorize(key);
    const conversation=await this.conversationMemoryService.getInboxConversation(this.requiredCompany(company),sessionId);
    const actor=await this.actor(userId,fullName,headerCompanyId,roleKey,conversation.company.id);
    this.assertManageOwn(actor,conversation.session,'inbox.return_to_ai');
    return {ok:true,session:await this.conversationMemoryService.resumeAiConversation(sessionId)};
  }

  @Post(':sessionId/messages') @HttpCode(200)
  async sendAdvisorMessage(@Headers('x-chatpro-inbox-key') key='', @Headers('x-chatpro-user-id') userId='', @Headers('x-chatpro-user-name') fullName='', @Headers('x-chatpro-company-id') headerCompanyId='', @Headers('x-chatpro-role-key') roleKey='', @Query('company') company='', @Param('sessionId') sessionId='', @Body() body:InboxBody={}) {
    this.authorize(key);
    const conversation=await this.conversationMemoryService.getInboxConversation(this.requiredCompany(company),sessionId);
    const actor=await this.actor(userId,fullName,headerCompanyId,roleKey,conversation.company.id);
    this.assertManageOwn(actor,conversation.session,'inbox.reply');
    if(conversation.session.attentionStatus!=='human') throw new BadRequestException('La conversación debe estar tomada por un asesor para responder.');
    const message=this.readText(body.message); if(!message) throw new BadRequestException('Escribe un mensaje antes de enviarlo.');
    await this.sendTextMessage(conversation.session.customerPhone,message);
    await this.conversationMemoryService.saveMessage({companyId:conversation.company.id,sessionId:conversation.session.id,customerPhone:conversation.session.customerPhone,message,sender:'assistant',authorType:'advisor',aiResponse:null});
    await this.conversationMemoryService.touchSession(conversation.session.id);
    return {ok:true,conversation:await this.conversationMemoryService.getInboxConversation(conversation.company.slug,conversation.session.id)};
  }

  private async actor(userId:string,fullName:string,headerCompanyId:string,roleKey:string,companyId:string):Promise<Actor>{
    const id=userId.trim(),name=fullName.trim(),role=roleKey.trim().toLowerCase();
    if(!id||!name||headerCompanyId.trim()!==companyId) throw new UnauthorizedException('Sesión de asesor no válida.');
    const c=this.supabaseService.getClient();
    const {data:membership,error:me}=await c.from('company_memberships').select('role_id,active').eq('company_id',companyId).eq('user_id',id).maybeSingle();
    if(me||!membership?.active||!membership.role_id) throw new UnauthorizedException('Tu acceso a esta empresa no está activo.');
    const {data:links,error:le}=await c.from('app_role_permissions').select('permission_id').eq('role_id',membership.role_id);
    if(le) throw new BadRequestException(`No se pudieron validar tus permisos: ${le.message}`);
    const ids=(links??[]).map((x:any)=>x.permission_id).filter((x:unknown):x is string=>typeof x==='string');
    const {data:rows,error:pe}=ids.length?await c.from('app_permissions').select('key').in('id',ids):{data:[],error:null};
    if(pe) throw new BadRequestException(`No se pudieron cargar tus permisos: ${pe.message}`);
    const permissions=new Set((rows??[]).map((x:any)=>x.key).filter((x:unknown):x is string=>typeof x==='string'));
    if(!permissions.has('inbox.view')) throw new ForbiddenException('No tienes permiso para ver la bandeja.');
    return {userId:id,fullName:name,permissions,isFullAccess:role==='owner'||role==='admin'};
  }
  private canView(actor:Actor,session:ConversationSession|InboxSessionSummary){
    if(actor.isFullAccess)return true;
    if(actor.permissions.has('inbox.view_own')&&session.assignedToUserId===actor.userId)return true;
    if(actor.permissions.has('inbox.view_ai')&&session.attentionStatus==='ai')return true;
    if(actor.permissions.has('inbox.view_waiting')&&session.attentionStatus==='waiting')return true;
    if(actor.permissions.has('inbox.view_team')&&session.attentionStatus==='human')return true;
    return false;
  }
  private assertView(actor:Actor,session:ConversationSession){if(!this.canView(actor,session))throw new ForbiddenException('No tienes permiso para ver esta conversación.');}
  private assertManageOwn(actor:Actor,session:ConversationSession,permission:string){
    if(!actor.isFullAccess&&!actor.permissions.has(permission))throw new ForbiddenException('No tienes permiso para realizar esta acción.');
    if(!actor.isFullAccess&&session.assignedToUserId!==actor.userId)throw new ForbiddenException('Solo puedes gestionar conversaciones asignadas a tu usuario.');
  }
  private authorize(value:string){const expected=process.env.CHATPRO_INBOX_KEY?.trim();if(!expected||value.trim()!==expected)throw new UnauthorizedException('No autorizado para usar la bandeja.');}
  private requiredCompany(value:string){const company=value.trim().toLowerCase();if(!company)throw new BadRequestException('Falta la empresa.');return company;}
  private readText(value:unknown){return typeof value==='string'?value.trim():'';}
  private async sendTextMessage(to:string,body:string){const token=process.env.META_WHATSAPP_ACCESS_TOKEN?.trim(),phoneId=process.env.META_PHONE_NUMBER_ID?.trim();if(!token||!phoneId)throw new Error('Faltan variables de Meta en Railway.');const response=await fetch(`https://graph.facebook.com/v25.0/${phoneId}/messages`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to,type:'text',text:{body}})});if(!response.ok)throw new Error(await response.text());}
}
