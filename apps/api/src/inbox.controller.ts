import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, HttpCode, Param, Post, Query, UnauthorizedException } from '@nestjs/common';
import { ChatAgentService } from './chat-agent.service';
import { ConversationMemoryService, type ConversationSession, type InboxSessionSummary } from './conversation-memory.service';
import { SupabaseService } from './supabase.service';
import { WhatsappMessagingService } from './whatsapp-messaging.service';

type InboxBody = { message?: unknown; action?: unknown; sessionId?: unknown; targetUserId?: unknown };
const INTERNAL_TEST_PHONE = '000000000000000';
type Actor = { userId:string; fullName:string; permissions:Set<string>; isFullAccess:boolean };

@Controller('inbox')
export class InboxController {
  constructor(
    private readonly conversationMemoryService: ConversationMemoryService,
    private readonly supabaseService: SupabaseService,
    private readonly whatsappMessagingService: WhatsappMessagingService,
    private readonly chatAgentService: ChatAgentService,
  ) {}

  @Get()
  async list(@Headers('x-chatpro-inbox-key') key='', @Headers('x-chatpro-session-type') sessionType='', @Headers('x-chatpro-user-id') userId='', @Headers('x-chatpro-user-name') fullName='', @Headers('x-chatpro-company-id') headerCompanyId='', @Headers('x-chatpro-role-key') roleKey='', @Query('company') company='', @Query('status') status='all', @Query('limit') limit='60') {
    this.authorize(key);
    const payload=await this.conversationMemoryService.listInboxSessions(this.requiredCompany(company),status,Number(limit));
    const actor=await this.actor(sessionType,userId,fullName,headerCompanyId,roleKey,payload.company.id);
    return {ok:true,...payload,sessions:payload.sessions.filter(session=>!this.isInternalTestSession(session)&&this.canView(actor,session))};
  }

  @Get('transfer-targets')
  async transferTargets(
    @Headers('x-chatpro-inbox-key') key='',
    @Headers('x-chatpro-session-type') sessionType='',
    @Headers('x-chatpro-user-id') userId='',
    @Headers('x-chatpro-user-name') fullName='',
    @Headers('x-chatpro-company-id') headerCompanyId='',
    @Headers('x-chatpro-role-key') roleKey='',
    @Query('company') company='',
  ) {
    this.authorize(key);
    const profile = await this.conversationMemoryService.getCompanyProfile(
      this.requiredCompany(company),
    );
    const actor = await this.actor(
      sessionType,
      userId,
      fullName,
      headerCompanyId,
      roleKey,
      profile.id,
    );

    return {
      ok: true,
      targets: await this.listTransferTargets(profile.id, actor.userId),
    };
  }

  @Get(':sessionId')
  async getConversation(@Headers('x-chatpro-inbox-key') key='', @Headers('x-chatpro-session-type') sessionType='', @Headers('x-chatpro-user-id') userId='', @Headers('x-chatpro-user-name') fullName='', @Headers('x-chatpro-company-id') headerCompanyId='', @Headers('x-chatpro-role-key') roleKey='', @Query('company') company='', @Param('sessionId') sessionId='') {
    this.authorize(key);
    const conversation=await this.conversationMemoryService.getInboxConversation(this.requiredCompany(company),sessionId);
    const actor=await this.actor(sessionType,userId,fullName,headerCompanyId,roleKey,conversation.company.id);
    if(conversation.session.attentionStatus==='closed') throw new BadRequestException('La conversación está finalizada. Si el cliente vuelve a escribir, la IA la reabrirá automáticamente.');
    this.assertView(actor,conversation.session);
    return {ok:true,...conversation};
  }

  @Post('internal-test') @HttpCode(200)
  async internalTest(
    @Headers('x-chatpro-inbox-key') key='',
    @Headers('x-chatpro-session-type') sessionType='',
    @Headers('x-chatpro-user-id') userId='',
    @Headers('x-chatpro-user-name') fullName='',
    @Headers('x-chatpro-company-id') headerCompanyId='',
    @Headers('x-chatpro-role-key') roleKey='',
    @Query('company') company='',
    @Body() body: InboxBody={},
  ) {
    this.authorize(key);

    const profile = await this.conversationMemoryService.getCompanyProfile(
      this.requiredCompany(company),
    );
    const actor = await this.actor(
      sessionType,
      userId,
      fullName,
      headerCompanyId,
      roleKey,
      profile.id,
    );

    if (!actor.isFullAccess) {
      throw new ForbiddenException(
        'Solo un propietario o administrador puede probar el agente.',
      );
    }

    const action = this.readText(body.action);

    if (action === 'start') {
      const created =
        await this.conversationMemoryService.getOrCreateSessionByCompanyId(
          profile.id,
          INTERNAL_TEST_PHONE,
        );

      const client = this.supabaseService.getClient();
      const { error: messagesError } = await client
        .from('conversations')
        .delete()
        .eq('session_id', created.id);

      if (messagesError) {
        throw new BadRequestException(
          `No se pudo reiniciar la prueba: ${messagesError.message}`,
        );
      }

      const { error: contactError } = await client
        .from('contacts')
        .delete()
        .eq('company_id', profile.id)
        .eq('phone', INTERNAL_TEST_PHONE);

      if (contactError) {
        throw new BadRequestException(
          `No se pudo preparar la prueba: ${contactError.message}`,
        );
      }

      await this.conversationMemoryService.resumeAiConversation(created.id);

      const session = await this.conversationMemoryService.updateSession(
        created.id,
        {
          stage: 'active',
          context: {
            internal_test: true,
            internal_test_started_at: new Date().toISOString(),
          },
        },
      );

      return {
        ok: true,
        internal_test: true,
        conversation:
          await this.conversationMemoryService.getInboxConversation(
            profile.slug,
            session.id,
          ),
      };
    }

    if (action !== 'message') {
      throw new BadRequestException('Acción de prueba no válida.');
    }

    const sessionId = this.readText(body.sessionId);
    const message = this.readText(body.message);

    if (!sessionId || !message) {
      throw new BadRequestException('Escribe un mensaje para probar el agente.');
    }

    const current =
      await this.conversationMemoryService.getInboxConversation(
        profile.slug,
        sessionId,
      );

    if (!this.isInternalTestSession(current.session)) {
      throw new ForbiddenException(
        'Esta no es una conversación interna de prueba.',
      );
    }

    let session = current.session;

    if (session.attentionStatus !== 'ai') {
      session = await this.conversationMemoryService.resumeAiConversation(
        session.id,
      );
    }

    await this.conversationMemoryService.saveMessage({
      companyId: profile.id,
      sessionId: session.id,
      customerPhone: INTERNAL_TEST_PHONE,
      message,
      sender: 'customer',
      authorType: 'customer',
    });

    session = await this.conversationMemoryService.updateSession(session.id, {
      context: session.context,
    });

    const reply = await this.chatAgentService.reply(profile, session, message);

    const afterAgent = await this.conversationMemoryService.getSessionById(
      session.id,
    );

    await this.conversationMemoryService.saveMessage({
      companyId: profile.id,
      sessionId: afterAgent.id,
      customerPhone: INTERNAL_TEST_PHONE,
      message: reply,
      sender: 'assistant',
      authorType: 'ai',
      aiResponse: reply,
    });

    await this.conversationMemoryService.updateSession(afterAgent.id, {
      context: afterAgent.context,
    });

    return {
      ok: true,
      internal_test: true,
      conversation:
        await this.conversationMemoryService.getInboxConversation(
          profile.slug,
          afterAgent.id,
        ),
    };
  }

  @Post(':sessionId/take') @HttpCode(200)
  async takeConversation(@Headers('x-chatpro-inbox-key') key='', @Headers('x-chatpro-session-type') sessionType='', @Headers('x-chatpro-user-id') userId='', @Headers('x-chatpro-user-name') fullName='', @Headers('x-chatpro-company-id') headerCompanyId='', @Headers('x-chatpro-role-key') roleKey='', @Query('company') company='', @Param('sessionId') sessionId='') {
    this.authorize(key);
    const conversation=await this.conversationMemoryService.getInboxConversation(this.requiredCompany(company),sessionId);
    const actor=await this.actor(sessionType,userId,fullName,headerCompanyId,roleKey,conversation.company.id);
    if(!actor.isFullAccess&&!actor.permissions.has('inbox.take')) throw new ForbiddenException('No tienes permiso para tomar conversaciones.');
    if(!actor.isFullAccess&&!this.canView(actor,conversation.session)) throw new ForbiddenException('No tienes permiso para tomar esta conversación.');

    const advisor = actor.userId
      ? { userId: actor.userId, fullName: actor.fullName }
      : await this.resolveBootstrapOwner(conversation.company.id);

    return {ok:true,session:await this.conversationMemoryService.takeConversation(sessionId,advisor)};
  }

  @Post(':sessionId/transfer') @HttpCode(200)
  async transferConversation(
    @Headers('x-chatpro-inbox-key') key='',
    @Headers('x-chatpro-session-type') sessionType='',
    @Headers('x-chatpro-user-id') userId='',
    @Headers('x-chatpro-user-name') fullName='',
    @Headers('x-chatpro-company-id') headerCompanyId='',
    @Headers('x-chatpro-role-key') roleKey='',
    @Query('company') company='',
    @Param('sessionId') sessionId='',
    @Body() body:InboxBody={},
  ) {
    this.authorize(key);
    const conversation =
      await this.conversationMemoryService.getInboxConversation(
        this.requiredCompany(company),
        sessionId,
      );
    const actor = await this.actor(
      sessionType,
      userId,
      fullName,
      headerCompanyId,
      roleKey,
      conversation.company.id,
    );

    if (conversation.session.attentionStatus !== 'human') {
      throw new BadRequestException(
        'Solo se puede transferir una conversación tomada por un asesor.',
      );
    }

    if (!actor.isFullAccess) {
      if (!actor.permissions.has('inbox.reply')) {
        throw new ForbiddenException(
          'No tienes permiso para transferir conversaciones.',
        );
      }

      if (conversation.session.assignedToUserId !== actor.userId) {
        throw new ForbiddenException(
          'Solo puedes transferir conversaciones asignadas a tu usuario.',
        );
      }
    }

    const targetUserId = this.readText(body.targetUserId);

    if (!targetUserId) {
      throw new BadRequestException('Selecciona el nuevo asesor.');
    }

    if (targetUserId === conversation.session.assignedToUserId) {
      throw new BadRequestException(
        'La conversación ya está asignada a este asesor.',
      );
    }

    const target = await this.resolveTransferTarget(
      conversation.company.id,
      targetUserId,
    );
    const session = await this.conversationMemoryService.takeConversation(
      sessionId,
      {
        userId: target.userId,
        fullName: target.fullName,
      },
    );

    return {
      ok: true,
      session,
      transferredTo: target,
    };
  }

  @Post(':sessionId/close') @HttpCode(200)
  async closeConversation(@Headers('x-chatpro-inbox-key') key='', @Headers('x-chatpro-session-type') sessionType='', @Headers('x-chatpro-user-id') userId='', @Headers('x-chatpro-user-name') fullName='', @Headers('x-chatpro-company-id') headerCompanyId='', @Headers('x-chatpro-role-key') roleKey='', @Query('company') company='', @Param('sessionId') sessionId='') {
    this.authorize(key);
    const conversation=await this.conversationMemoryService.getInboxConversation(this.requiredCompany(company),sessionId);
    const actor=await this.actor(sessionType,userId,fullName,headerCompanyId,roleKey,conversation.company.id);
    this.assertManageOwn(actor,conversation.session,'inbox.close');
    return {ok:true,session:await this.conversationMemoryService.closeConversation(sessionId)};
  }

  @Post(':sessionId/resume-ai') @HttpCode(200)
  async resumeAiConversation(@Headers('x-chatpro-inbox-key') key='', @Headers('x-chatpro-session-type') sessionType='', @Headers('x-chatpro-user-id') userId='', @Headers('x-chatpro-user-name') fullName='', @Headers('x-chatpro-company-id') headerCompanyId='', @Headers('x-chatpro-role-key') roleKey='', @Query('company') company='', @Param('sessionId') sessionId='') {
    this.authorize(key);
    const conversation=await this.conversationMemoryService.getInboxConversation(this.requiredCompany(company),sessionId);
    const actor=await this.actor(sessionType,userId,fullName,headerCompanyId,roleKey,conversation.company.id);
    this.assertManageOwn(actor,conversation.session,'inbox.return_to_ai');
    return {ok:true,session:await this.conversationMemoryService.resumeAiConversation(sessionId)};
  }

  @Post(':sessionId/messages') @HttpCode(200)
  async sendAdvisorMessage(@Headers('x-chatpro-inbox-key') key='', @Headers('x-chatpro-session-type') sessionType='', @Headers('x-chatpro-user-id') userId='', @Headers('x-chatpro-user-name') fullName='', @Headers('x-chatpro-company-id') headerCompanyId='', @Headers('x-chatpro-role-key') roleKey='', @Query('company') company='', @Param('sessionId') sessionId='', @Body() body:InboxBody={}) {
    this.authorize(key);
    const conversation=await this.conversationMemoryService.getInboxConversation(this.requiredCompany(company),sessionId);
    const actor=await this.actor(sessionType,userId,fullName,headerCompanyId,roleKey,conversation.company.id);
    this.assertManageOwn(actor,conversation.session,'inbox.reply');
    if(conversation.session.attentionStatus!=='human') throw new BadRequestException('La conversación debe estar tomada por un asesor para responder.');
    const message=this.readText(body.message); if(!message) throw new BadRequestException('Escribe un mensaje antes de enviarlo.');
    await this.whatsappMessagingService.sendText(conversation.company.id,conversation.session.customerPhone,message);
    await this.conversationMemoryService.saveMessage({companyId:conversation.company.id,sessionId:conversation.session.id,customerPhone:conversation.session.customerPhone,message,sender:'assistant',authorType:'advisor',aiResponse:null});
    await this.conversationMemoryService.touchSession(conversation.session.id);
    return {ok:true,conversation:await this.conversationMemoryService.getInboxConversation(conversation.company.slug,conversation.session.id)};
  }

  private async actor(sessionType:string,userId:string,fullName:string,headerCompanyId:string,roleKey:string,companyId:string):Promise<Actor>{
    const type=sessionType.trim().toLowerCase(),id=userId.trim(),name=fullName.trim(),role=roleKey.trim().toLowerCase();

    // La sesión bootstrap es el propietario durante la configuración inicial.
    // Solo se acepta como owner y para la empresa firmada por la web.
    if(type==='bootstrap'){
      if(role!=='owner'||headerCompanyId.trim()!==companyId) throw new UnauthorizedException('Sesión inicial no válida.');
      return {userId:'',fullName:name||'Configuración inicial',permissions:new Set<string>(),isFullAccess:true};
    }

    if(type!=='user'||!id||!name||headerCompanyId.trim()!==companyId) throw new UnauthorizedException('Sesión de asesor no válida.');
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
  private async resolveBootstrapOwner(companyId:string):Promise<{userId:string;fullName:string}>{
    const c=this.supabaseService.getClient();

    const {data:memberships,error:membershipError}=await c
      .from('company_memberships')
      .select('user_id,role_id')
      .eq('company_id',companyId)
      .eq('active',true);

    if(membershipError) throw new BadRequestException(`No se pudo resolver el propietario: ${membershipError.message}`);

    const rows=(memberships??[]).filter((row:any)=>typeof row.user_id==='string'&&typeof row.role_id==='string');
    const roleIds=rows.map((row:any)=>row.role_id);

    if(!roleIds.length) throw new ForbiddenException('No hay un propietario activo configurado para tomar conversaciones.');

    const {data:roles,error:rolesError}=await c
      .from('app_roles')
      .select('id,key')
      .in('id',roleIds);

    if(rolesError) throw new BadRequestException(`No se pudieron cargar los roles: ${rolesError.message}`);

    const ownerRoleIds=new Set(
      (roles??[])
        .filter((role:any)=>role?.key==='owner')
        .map((role:any)=>role.id)
        .filter((id:unknown):id is string=>typeof id==='string'),
    );

    const owner=rows.find((row:any)=>ownerRoleIds.has(row.role_id));

    if(!owner) throw new ForbiddenException('No hay un propietario activo configurado para tomar conversaciones.');

    const {data:profile,error:profileError}=await c
      .from('app_profiles')
      .select('full_name')
      .eq('user_id',owner.user_id)
      .maybeSingle();

    if(profileError) throw new BadRequestException(`No se pudo cargar el propietario: ${profileError.message}`);

    return {
      userId: owner.user_id,
      fullName: typeof profile?.full_name==='string'&&profile.full_name.trim()
        ? profile.full_name.trim()
        : 'Propietario',
    };
  }

  private async listTransferTargets(
    companyId:string,
    excludeUserId:string='',
  ):Promise<Array<{userId:string;fullName:string;roleName:string}>>{
    const client=this.supabaseService.getClient();
    const {data:memberships,error:membershipsError}=await client
      .from('company_memberships')
      .select('user_id,role_id')
      .eq('company_id',companyId)
      .eq('active',true);

    if(membershipsError){
      throw new BadRequestException(
        `No se pudieron consultar los asesores: ${membershipsError.message}`,
      );
    }

    const membershipRows=(memberships??[]).filter(
      (item:any)=>
        typeof item?.user_id==='string'&&
        typeof item?.role_id==='string'&&
        item.user_id!==excludeUserId,
    );

    if(!membershipRows.length)return [];

    const roleIds=Array.from(
      new Set(membershipRows.map((item:any)=>item.role_id)),
    );
    const userIds=membershipRows.map((item:any)=>item.user_id);

    const {data:roles,error:rolesError}=await client
      .from('app_roles')
      .select('id,key,name')
      .in('id',roleIds);

    if(rolesError){
      throw new BadRequestException(
        `No se pudieron consultar los roles: ${rolesError.message}`,
      );
    }

    const {data:links,error:linksError}=await client
      .from('app_role_permissions')
      .select('role_id,permission_id')
      .in('role_id',roleIds);

    if(linksError){
      throw new BadRequestException(
        `No se pudieron consultar los permisos: ${linksError.message}`,
      );
    }

    const permissionIds=Array.from(
      new Set(
        (links??[])
          .map((item:any)=>item.permission_id)
          .filter((value:unknown):value is string=>typeof value==='string'),
      ),
    );

    const permissionResult=permissionIds.length
      ? await client.from('app_permissions').select('id,key').in('id',permissionIds)
      : {data:[],error:null};

    if(permissionResult.error){
      throw new BadRequestException(
        `No se pudieron cargar los permisos: ${permissionResult.error.message}`,
      );
    }

    const permissionKeyById=new Map<string,string>(
      (permissionResult.data??[])
        .filter(
          (item:any)=>
            typeof item?.id==='string'&&typeof item?.key==='string',
        )
        .map((item:any)=>[item.id,item.key]),
    );
    const permissionKeysByRole=new Map<string,Set<string>>();

    for(const link of links??[]){
      const roleId=typeof (link as any).role_id==='string'
        ? (link as any).role_id
        : '';
      const permissionId=typeof (link as any).permission_id==='string'
        ? (link as any).permission_id
        : '';
      const permissionKey=permissionKeyById.get(permissionId);

      if(!roleId||!permissionKey)continue;

      const current=permissionKeysByRole.get(roleId)??new Set<string>();
      current.add(permissionKey);
      permissionKeysByRole.set(roleId,current);
    }

    const roleById=new Map<string,{key:string;name:string}>(
      (roles??[])
        .filter(
          (item:any)=>
            typeof item?.id==='string'&&
            typeof item?.key==='string'&&
            typeof item?.name==='string',
        )
        .map((item:any)=>[
          item.id,
          {key:item.key.trim().toLowerCase(),name:item.name.trim()},
        ]),
    );

    const {data:profiles,error:profilesError}=await client
      .from('app_profiles')
      .select('user_id,full_name')
      .in('user_id',userIds);

    if(profilesError){
      throw new BadRequestException(
        `No se pudieron consultar los perfiles: ${profilesError.message}`,
      );
    }

    const nameByUserId=new Map<string,string>(
      (profiles??[])
        .filter(
          (item:any)=>
            typeof item?.user_id==='string'&&
            typeof item?.full_name==='string'&&
            item.full_name.trim(),
        )
        .map((item:any)=>[item.user_id,item.full_name.trim()]),
    );

    return membershipRows
      .filter((membership:any)=>{
        const role=roleById.get(membership.role_id);
        if(!role)return false;
        if(role.key==='owner'||role.key==='admin')return true;
        const permissions=permissionKeysByRole.get(membership.role_id);
        return Boolean(
          permissions?.has('inbox.view')&&permissions.has('inbox.reply'),
        );
      })
      .map((membership:any)=>{
        const role=roleById.get(membership.role_id)!;
        return {
          userId:membership.user_id,
          fullName:nameByUserId.get(membership.user_id)??'Usuario sin nombre',
          roleName:role.name||'Asesor',
        };
      })
      .sort((left,right)=>
        left.fullName.localeCompare(right.fullName,'es-CO'),
      );
  }

  private async resolveTransferTarget(
    companyId:string,
    targetUserId:string,
  ):Promise<{userId:string;fullName:string;roleName:string}>{
    const targets=await this.listTransferTargets(companyId);
    const target=targets.find((item)=>item.userId===targetUserId);

    if(!target){
      throw new BadRequestException(
        'El asesor seleccionado no está activo o no tiene permisos para recibir conversaciones.',
      );
    }

    return target;
  }

  private isInternalTestSession(session:ConversationSession|InboxSessionSummary){return session.customerPhone===INTERNAL_TEST_PHONE;}
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
}
