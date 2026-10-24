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
import { createHash, timingSafeEqual } from 'crypto';
import { AccessAuthService } from './access-auth.service';
import { SupabaseService } from './supabase.service';
import {companyReadiness} from './platform-company-readiness';
import {emptyPlanDraft,PLAN_KEYS,validatePlanDraft} from './platform-plan-drafts';
import {estimateAiCostUsd} from './platform-ai-cost';
import {validateFinanceScenario,validateFinanceActual} from './platform-finance-scenario';
import {validateFinanceCompanyEntry} from './platform-company-finance';

type CreateCompanyBody = {
  name?: unknown;
  slug?: unknown;
  planKey?: unknown;
  aiEnabled?: unknown;
  whatsappEnabled?: unknown;
  instagramEnabled?: unknown;
  messengerEnabled?: unknown;
  automationsEnabled?: unknown;
  statisticsEnabled?: unknown;
  maxUsers?: unknown;
  maxWhatsappLines?: unknown;
  ownerFullName?: unknown;
  ownerIdentifier?: unknown;
  ownerPassword?: unknown;
};

type EntitlementRow = {
  company_id: string;
  plan_key: string;
  ai_enabled: boolean;
  whatsapp_enabled: boolean;
  instagram_enabled: boolean;
  messenger_enabled: boolean;
  automations_enabled: boolean;
  statistics_enabled: boolean;
  max_users: number;
  max_whatsapp_lines: number;
};

@Controller('platform-admin')
export class PlatformAdminController {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly accessAuthService: AccessAuthService,
  ) {}

  // Bootstrap exactly one staging platform administrator with an expiring,
  // single-use invitation issued by the staging operator. No shared/default password.
  @Post('staging-admin-activate')
  async activateStagingSuperadmin(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Body() payload:unknown,
  ) {
    this.assertInternalKey(providedKey);
    if(process.env.MW1_STAGING_MODE!=='true')
      throw new UnauthorizedException('Disponible únicamente en staging.');
    if(!payload||typeof payload!=='object'||Array.isArray(payload))
      throw new BadRequestException('Solicitud inválida.');
    const body=payload as Record<string,unknown>;
    if(Object.keys(body).some(k=>!['token','password'].includes(k))||
      typeof body.token!=='string'||!/^[0-9a-f]{64}$/.test(body.token)||
      typeof body.password!=='string'||body.password.length<14||body.password.length>128)
      throw new BadRequestException('Enlace o contraseña inválida.');
    const client=this.supabaseService.getClient();
    const {count:admins,error:adminError}=await client.from('platform_admins')
      .select('user_id',{head:true,count:'exact'}).eq('active',true);
    if(adminError||admins===null)
      throw new BadRequestException('No se pudo comprobar el estado de administración.');
    if(admins>0)throw new UnauthorizedException('El alta inicial ya fue completada.');
    // Operators can also place an independent random code directly in the
    // staging API environment. This avoids ever transmitting it through chat.
    // Remove MW1_STAGING_ADMIN_SETUP_TOKEN after successful activation.
    const configuredCode=process.env.MW1_STAGING_ADMIN_SETUP_TOKEN?.trim()||'';
    const codeMatch=/^[0-9a-f]{64}$/.test(configuredCode)&&
      timingSafeEqual(Buffer.from(body.token,'hex'),Buffer.from(configuredCode,'hex'));
    let invite:{login_identifier:string;company_slug:string}|null=null;
    if(codeMatch){
      invite={login_identifier:'1018453680',company_slug:'mw1-demo-mercado'};
    }else{
      // Single-use DB invitation when issued by a trusted staging operator.
      const digest=createHash('sha256').update(body.token).digest('hex');
      const {data:claimed,error:inviteError}=await client.from('platform_staging_admin_invites')
        .update({used_at:new Date().toISOString()})
        .eq('token_sha256',digest).is('used_at',null)
        .gt('expires_at',new Date().toISOString())
        .select('id,login_identifier,company_slug').maybeSingle();
      if(inviteError||!claimed)throw new UnauthorizedException('Código de activación inválido.');
      invite=claimed;
    }
    const identifier=invite.login_identifier;
    const password=body.password;
    if(password.includes(identifier))
      throw new BadRequestException('La contraseña no puede incluir la identificación.');
    const {data:existing,error:existingError}=await client.from('app_profiles')
      .select('user_id').eq('login_identifier',identifier).maybeSingle();
    if(existingError||existing)
      throw new BadRequestException('Este identificador ya está registrado.');
    let userId='';
    try {
      const {data:created,error:createError}=await client.auth.admin.createUser({
        email:this.technicalEmail('platform',identifier),
        password,email_confirm:true,
        user_metadata:{full_name:'Administrador MW1',login_identifier:identifier},
      });
      if(createError||!created.user?.id)throw new Error('No se pudo crear la identidad.');
      userId=created.user.id;
      const {error:profileError}=await client.from('app_profiles').insert({
        user_id:userId,full_name:'Administrador MW1',login_identifier:identifier,
        email:this.technicalEmail('platform',identifier),
        password_hash:this.accessAuthService.hash(password),active:true,
      });
      if(profileError)throw new Error('No se pudo preparar el acceso.');
      const {error:grantError}=await client.from('platform_admins').insert({user_id:userId,active:true});
      if(grantError)throw new Error('No se pudo activar el superadministrador.');
      return {ok:true,loginIdentifier:identifier,
        message:'Usuario activado en MW1 staging. Ya puedes iniciar sesión.'};
    } catch(err) {
      if(userId){
        await client.from('platform_admins').delete().eq('user_id',userId);
        await client.from('app_profiles').delete().eq('user_id',userId);
        await client.auth.admin.deleteUser(userId);
      }
      throw new BadRequestException(err instanceof Error?err.message:'No se pudo activar la cuenta.');
    }
  }

  @Get('me')
  async me(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('user') userId = '',
  ) {
    this.assertInternalKey(providedKey);
    const normalizedUserId = this.requiredText(userId, 'Falta el usuario.');

    return {
      ok: true,
      platformAdmin: await this.isPlatformAdmin(normalizedUserId),
    };
  }

  @Get('companies')
  async listCompanies(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('user') userId = '',
  ) {
    this.assertInternalKey(providedKey);
    await this.assertPlatformAdmin(userId);

    const client = this.supabaseService.getClient();
    const { data: companies, error: companiesError } = await client
      .from('companies')
      .select('id,slug,name,status')
      .order('name', { ascending: true });

    if (companiesError) {
      throw new BadRequestException(
        `No se pudieron consultar las empresas: ${companiesError.message}`,
      );
    }

    const companyIds = (companies ?? []).map((company) => company.id);

    const entitlements = companyIds.length
      ? await client
          .from('company_entitlements')
          .select(
            'company_id,plan_key,ai_enabled,whatsapp_enabled,instagram_enabled,messenger_enabled,automations_enabled,statistics_enabled,max_users,max_whatsapp_lines',
          )
          .in('company_id', companyIds)
      : { data: [], error: null };

    if (entitlements.error) {
      throw new BadRequestException(
        `No se pudieron consultar los planes: ${entitlements.error.message}`,
      );
    }

    const memberships = companyIds.length
      ? await client
          .from('company_memberships')
          .select('company_id')
          .in('company_id', companyIds)
          .eq('active', true)
      : { data: [], error: null };

    if (memberships.error) {
      throw new BadRequestException(
        `No se pudieron consultar los usuarios: ${memberships.error.message}`,
      );
    }

    // Configured integration records only. Never read credential/config columns.
    // A provider status of active is NOT evidence of a successful live exchange.
    const integrationLookup = companyIds.length
      ? await client.from('company_integrations')
          .select('company_id,provider,integration_type,status')
          .in('company_id',companyIds)
      : {data:[],error:null};
    if(integrationLookup.error) {
      throw new BadRequestException('No se pudieron consultar los estados de integración.');
    }
    const integrationsByCompany=new Map<string,Array<{
      provider:string;integration_type:string;status:string
    }>>();
    for(const row of integrationLookup.data ?? []) {
      const existing=integrationsByCompany.get(row.company_id) ?? [];
      existing.push({provider:row.provider,integration_type:row.integration_type,
        status:row.status});
      integrationsByCompany.set(row.company_id,existing);
    }

    const entitlementsByCompany = new Map<string, EntitlementRow>(
      ((entitlements.data ?? []) as EntitlementRow[]).map((row) => [
        row.company_id,
        row,
      ]),
    );

    const activeUsersByCompany = new Map<string, number>();
    for (const membership of memberships.data ?? []) {
      activeUsersByCompany.set(
        membership.company_id,
        (activeUsersByCompany.get(membership.company_id) ?? 0) + 1,
      );
    }

    // Operational clients are registered as read-only directory references.
    // They live in separate Supabase databases: do not merge memberships,
    // entitlements, message records, secrets or billing into staging.
    let linkedCompanies:Array<{
      name:string;slug:string;billingStatus:string;source:string;verifiedAt:string;
      recommendedPlan:string|null;commercialMode:string;activeUsers:number|null;
      activeIntegrations:number|null;messages30d:number|null;aiResponses30d:number|null;
      lastMessageAt:string|null;activityObservedAt:string|null;aiCostStatus:string;recommendationReason:string;
    }>=[];
    if(process.env.MW1_STAGING_MODE==='true'){
      const {data:directory,error:directoryError}=await client
        .from('platform_external_tenant_registry')
        .select('company_name,company_slug,billing_status,environment_label,verified_at,commercial_plan_suggestion,commercial_mode,active_users_count,active_integration_records,messages_30d,ai_response_records_30d,last_message_at,activity_observed_at,ai_cost_status,recommended_plan_reason')
        .order('company_name',{ascending:true}).limit(100);
      if(directoryError)
        throw new BadRequestException('No se pudo consultar el directorio de empresas operativas.');
      linkedCompanies=(directory??[]).map(item=>({
        name:item.company_name,
        slug:item.company_slug,
        billingStatus:item.billing_status,
        source:item.environment_label,
        verifiedAt:item.verified_at,
        recommendedPlan:item.commercial_plan_suggestion,
        commercialMode:item.commercial_mode,
        activeUsers:item.active_users_count,
        activeIntegrations:item.active_integration_records,
        messages30d:item.messages_30d,
        aiResponses30d:item.ai_response_records_30d,
        lastMessageAt:item.last_message_at,
        activityObservedAt:item.activity_observed_at,
        aiCostStatus:item.ai_cost_status,
        recommendationReason:item.recommended_plan_reason,
      }));
    }
    return {
      ok: true,
      linkedCompanies,
      companies: (companies ?? []).map((company) => {
        const entitlement = entitlementsByCompany.get(company.id);

        const activeUsers=activeUsersByCompany.get(company.id) ?? 0;
        const safeEntitlements=entitlement
          ? this.toEntitlementResponse(entitlement)
          : {
              planKey: 'legacy',
              aiEnabled: true, whatsappEnabled: true,
              instagramEnabled: true,messengerEnabled: true,
              automationsEnabled: true,statisticsEnabled: true,
              maxUsers: null,maxWhatsappLines: null,
            };
        const readiness=companyReadiness({
          activeUsers,companyStatus:company.status,
          planKey:safeEntitlements.planKey,
          whatsappEnabled:safeEntitlements.whatsappEnabled,
          instagramEnabled:safeEntitlements.instagramEnabled,
          messengerEnabled:safeEntitlements.messengerEnabled,
          aiEnabled:safeEntitlements.aiEnabled,
          connections:integrationsByCompany.get(company.id)??[],
        });
        return {
          id: company.id,
          slug: company.slug,
          name: company.name,
          status: company.status,
          activeUsers,
          readiness,
          entitlements: entitlement
            ? this.toEntitlementResponse(entitlement)
            : {
                planKey: 'legacy',
                aiEnabled: true,
                whatsappEnabled: true,
                instagramEnabled: true,
                messengerEnabled: true,
                automationsEnabled: true,
                statisticsEnabled: true,
                maxUsers: null,
                maxWhatsappLines: null,
              },
        };
      }),
    };
  }

  @Get('demo-requests')
  async listDemoRequests(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('user') userId = '',
  ) {
    this.assertInternalKey(providedKey);
    await this.assertPlatformAdmin(userId);
    if(process.env.MW1_STAGING_MODE!=='true'){
      throw new UnauthorizedException('Solicitudes disponibles únicamente en el entorno de pruebas.');
    }
    const {data,error}=await this.supabaseService.getClient()
      .from('platform_demo_requests')
      .select('id,company_name,contact_name,contact_email,contact_phone,whatsapp_setup,trial_requested_days,trial_activated_at,requested_users,requested_connections,source,plan_interest,status,internal_note,next_followup_on,created_at')
      .order('created_at',{ascending:false})
      .limit(50);
    if(error)throw new BadRequestException('No fue posible consultar las solicitudes.');
    return {ok:true,requests:(data??[]).map(record=>({
      id:record.id,
      companyName:record.company_name,
      contactName:record.contact_name,
      contactEmail:record.contact_email,
      planInterest:record.plan_interest,
      requestType:record.source==='web_trial'?'trial':'demo',
      contactPhone:record.contact_phone??null,
      whatsappSetup:record.whatsapp_setup??null,
      trialDays:record.trial_requested_days??null,
      requestedUsers:record.requested_users??null,
      requestedConnections:record.requested_connections??null,
      trialActivatedAt:record.trial_activated_at??null,
      internalNote:record.internal_note??'',
      followUpOn:record.next_followup_on??null,
      status:record.status,
      createdAt:record.created_at,
    }))};
  }

  @Post('demo-requests/follow-up')
  async updateDemoRequestFollowUp(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('user') userId = '',
    @Body() body:unknown,
  ){
    this.assertInternalKey(providedKey);
    await this.assertPlatformAdmin(userId);
    if(process.env.MW1_STAGING_MODE!=='true')
      throw new UnauthorizedException('El seguimiento comercial solo está disponible en staging.');
    if(!body||typeof body!=='object'||Array.isArray(body))
      throw new BadRequestException('Datos de seguimiento inválidos.');
    const value=body as Record<string,unknown>;
    const keys=['id','status','internalNote','followUpOn'];
    if(Object.keys(value).some(k=>!keys.includes(k)))
      throw new BadRequestException('Campo de seguimiento no permitido.');
    if(typeof value.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value.id))
      throw new BadRequestException('Identificador de solicitud inválido.');
    if(typeof value.status!=='string'||!['new','contacted','qualified','closed'].includes(value.status))
      throw new BadRequestException('Estado comercial inválido.');
    if(typeof value.internalNote!=='string'||value.internalNote.length>1000)
      throw new BadRequestException('Nota interna inválida.');
    const followUpOn=value.followUpOn;
    if(followUpOn!==null){
      if(typeof followUpOn!=='string'||!/^20[2-9][0-9]-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.test(followUpOn)||
        Number.isNaN(Date.parse(followUpOn))||
        new Date(followUpOn).toISOString().slice(0,10)!==followUpOn)
        throw new BadRequestException('Fecha de seguimiento inválida.');
    }
    const {data,error}=await this.supabaseService.getClient()
      .from('platform_demo_requests')
      .update({
        status:value.status,internal_note:value.internalNote.trim(),
        next_followup_on:followUpOn,
        updated_at:new Date().toISOString(),
      })
      .eq('id',value.id)
      .select('id,status,internal_note,next_followup_on,updated_at')
      .maybeSingle();
    if(error||!data)throw new BadRequestException('No se pudo actualizar la solicitud indicada.');
    return {ok:true,id:data.id,status:data.status,internalNote:data.internal_note,
      followUpOn:data.next_followup_on,updatedAt:data.updated_at,
      message:'Seguimiento comercial guardado. No se activó ninguna prueba, usuario, plan ni cobro.'};
  }

  @Get('plans/drafts')
  async getPlanDrafts(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('user') userId = '',
  ) {
    this.assertInternalKey(providedKey);
    await this.assertPlatformAdmin(userId);
    if(process.env.MW1_STAGING_MODE!=='true')
      throw new UnauthorizedException('Edición de planes disponible solo en pruebas.');
    const {data,error}=await this.supabaseService.getClient()
      .from('platform_commercial_plan_drafts')
      .select('plan_key,price_cop,max_users,max_whatsapp_lines,extra_user_cop,extra_connection_cop,ai_monthly_budget_cop,public_summary,public_features,ai_enabled,whatsapp_enabled,instagram_enabled,messenger_enabled,automations_enabled,statistics_enabled,notes,review_status')
      .limit(3);
    if(error)throw new BadRequestException('No se pudieron consultar los borradores comerciales.');
    const drafts=new Map((data??[]).map(p=>[p.plan_key,p]));
    return {ok:true,plans:PLAN_KEYS.map(key=>{
      const row=drafts.get(key);
      if(!row)return emptyPlanDraft(key);
      return {
        planKey:key,priceCop:row.price_cop,
        maxUsers:row.max_users,maxWhatsappLines:row.max_whatsapp_lines,
        extraUserCop:row.extra_user_cop,extraConnectionCop:row.extra_connection_cop,
        aiMonthlyBudgetCop:row.ai_monthly_budget_cop,publicSummary:row.public_summary??'',publicFeatures:row.public_features??[],
        aiEnabled:row.ai_enabled,whatsappEnabled:row.whatsapp_enabled,
        instagramEnabled:row.instagram_enabled,
        messengerEnabled:row.messenger_enabled,
        automationsEnabled:row.automations_enabled,
        statisticsEnabled:row.statistics_enabled,
        notes:row.notes,reviewStatus:row.review_status,
      };
    })};
  }

  @Post('plans/drafts')
  async savePlanDraft(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('user') userId = '',
    @Body() body:unknown,
  ) {
    this.assertInternalKey(providedKey);
    await this.assertPlatformAdmin(userId);
    if(process.env.MW1_STAGING_MODE!=='true')
      throw new UnauthorizedException('Edición de planes disponible solo en pruebas.');
    let draft;
    try{draft=validatePlanDraft(body);}
    catch(cause){throw new BadRequestException(
      cause instanceof Error?cause.message:'Plan inválido.',
    );}
    const {data,error}=await this.supabaseService.getClient()
      .from('platform_commercial_plan_drafts')
      .upsert({
        plan_key:draft.planKey,currency:'COP',
        price_cop:draft.priceCop,max_users:draft.maxUsers,
        max_whatsapp_lines:draft.maxWhatsappLines,
        extra_user_cop:draft.extraUserCop,extra_connection_cop:draft.extraConnectionCop,
        ai_monthly_budget_cop:draft.aiMonthlyBudgetCop,public_summary:draft.publicSummary,public_features:draft.publicFeatures,
        ai_enabled:draft.aiEnabled,whatsapp_enabled:draft.whatsappEnabled,
        instagram_enabled:draft.instagramEnabled,
        messenger_enabled:draft.messengerEnabled,
        automations_enabled:draft.automationsEnabled,
        statistics_enabled:draft.statisticsEnabled,
        notes:draft.notes,review_status:draft.reviewStatus,
        updated_by:userId,updated_at:new Date().toISOString(),
      },{onConflict:'plan_key'})
      .select('plan_key').single();
    if(error||!data)throw new BadRequestException('No se pudo guardar el borrador.');
    return {ok:true,planKey:draft.planKey,reviewStatus:draft.reviewStatus,
      message:'Borrador privado guardado. No se cobraron planes ni cambiaron permisos.'};
  }

  // The public website reads this non-sensitive snapshot through its own server.
  // This endpoint still requires the internal backend key and only runs in staging.
  // Staging-only AI usage report. Reads metered events; missing data means uninstrumented,
  // not zero cost across OpenAI. Never exposes tenant message content.
  // Private platform financial workbook. Staging only; this is not billing.
  @Get('finance')
  async getFinance(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('user') userId = '',
    @Query('month') month = '',
  ){
    this.assertInternalKey(providedKey);
    await this.assertPlatformAdmin(userId);
    if(process.env.MW1_STAGING_MODE!=='true')
      throw new UnauthorizedException('Finanzas de pruebas solamente.');
    if(!/^20[2-9][0-9]-(0[1-9]|1[0-2])-01$/.test(month))
      throw new BadRequestException('Mes inválido.');
    const client=this.supabaseService.getClient();
    const [scenario,actual]=await Promise.all([
      client.from('platform_finance_scenarios').select('assumptions,updated_at')
        .eq('scenario_key','current').maybeSingle(),
      client.from('platform_finance_monthly_actuals')
        .select('period_month,received_cop,railway_cop,supabase_cop,openai_cop,technical_support_cop,personnel_cop,marketing_cop,other_cop,evidence_note,updated_at')
        .eq('period_month',month).maybeSingle(),
    ]);
    if(scenario.error||actual.error)
      throw new BadRequestException('No se pudo cargar el control financiero.');
    return {ok:true,scenario:scenario.data?.assumptions??null,
      scenarioUpdatedAt:scenario.data?.updated_at??null,actual:actual.data??null};
  }

  @Post('finance/scenario')
  async saveFinanceScenario(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('user') userId = '',
    @Body() body:unknown,
  ){
    this.assertInternalKey(providedKey);
    await this.assertPlatformAdmin(userId);
    if(process.env.MW1_STAGING_MODE!=='true')
      throw new UnauthorizedException('Finanzas de pruebas solamente.');
    let assumptions;
    try{assumptions=validateFinanceScenario(body);}
    catch(e){throw new BadRequestException(e instanceof Error?e.message:'Escenario inválido.');}
    const {error}=await this.supabaseService.getClient()
      .from('platform_finance_scenarios')
      .upsert({scenario_key:'current',assumptions,updated_by:userId,
        updated_at:new Date().toISOString()},{onConflict:'scenario_key'});
    if(error)throw new BadRequestException('No se pudo guardar el escenario.');
    return {ok:true,message:'Simulación privada guardada. No se han creado cargos ni modificado clientes.'};
  }

  @Post('finance/actual')
  async saveFinanceActual(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('user') userId = '',
    @Body() body:unknown,
  ){
    this.assertInternalKey(providedKey);
    await this.assertPlatformAdmin(userId);
    if(process.env.MW1_STAGING_MODE!=='true')
      throw new UnauthorizedException('Finanzas de pruebas solamente.');
    let input;
    try{input=validateFinanceActual(body);}
    catch(e){throw new BadRequestException(e instanceof Error?e.message:'Registro inválido.');}
    const {error}=await this.supabaseService.getClient()
      .from('platform_finance_monthly_actuals').upsert({
        period_month:input.periodMonth,received_cop:input.receivedCop,
        railway_cop:input.railwayCop,supabase_cop:input.supabaseCop,
        openai_cop:input.openaiCop,technical_support_cop:input.technicalSupportCop,
        personnel_cop:input.personnelCop,marketing_cop:input.marketingCop,
        other_cop:input.otherCop,evidence_note:input.evidenceNote,
        updated_by:userId,updated_at:new Date().toISOString(),
      },{onConflict:'period_month'});
    if(error)throw new BadRequestException('No se pudo guardar el registro mensual.');
    return {ok:true,message:'Registro manual del mes guardado en staging. No se generó una factura.'};
  }

  @Get('finance/companies')
  async getCompanyFinance(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('user') userId = '',
    @Query('month') month = '',
  ){
    this.assertInternalKey(providedKey);
    await this.assertPlatformAdmin(userId);
    if(process.env.MW1_STAGING_MODE!=='true')
      throw new UnauthorizedException('Rentabilidad por empresa solo en staging.');
    if(!/^20[2-9][0-9]-(0[1-9]|1[0-2])-01$/.test(month))
      throw new BadRequestException('Mes inválido.');
    const client=this.supabaseService.getClient();
    const [linked,local,records,actual]=await Promise.all([
      client.from('platform_external_tenant_registry')
        .select('company_name,company_slug,commercial_plan_suggestion,activity_observed_at,ai_cost_status')
        .order('company_name',{ascending:true}).limit(100),
      client.from('companies').select('name,slug,status')
        .order('name',{ascending:true}).limit(200),
      client.from('platform_finance_company_monthly')
        .select('period_month,company_source,company_slug,billed_cop,received_cop,openai_cop,support_cop,onboarding_cop,other_direct_cop,allocation_weight,include_in_allocation,evidence_note,updated_at')
        .eq('period_month',month).limit(1000),
      client.from('platform_finance_monthly_actuals')
        .select('railway_cop,supabase_cop,technical_support_cop,personnel_cop,marketing_cop,other_cop,openai_cop,updated_at')
        .eq('period_month',month).maybeSingle(),
    ]);
    if(linked.error||local.error||records.error||actual.error)
      throw new BadRequestException('No se pudo consultar el control financiero por empresa.');
    const options=[
      ...(linked.data??[]).map(c=>({
        companySource:'operational',companySlug:c.company_slug,
        companyName:c.company_name,suggestedPlan:c.commercial_plan_suggestion,
        aiCostStatus:c.ai_cost_status,activityObservedAt:c.activity_observed_at,
        status:'Registro operativo, no sincronizado',
      })),
      ...(local.data??[]).map(c=>({
        companySource:'staging',companySlug:c.slug,
        companyName:c.name,suggestedPlan:null,aiCostStatus:'not_measured',
        activityObservedAt:null,status:c.status,
      })),
    ];
    return {ok:true,periodMonth:month,companies:options,records:records.data??[],
      sharedActual:actual.data??null,informationType:'manual_not_reconciled',
      note:'Los importes son manuales; no son facturas ni lecturas directas de OpenAI/Railway.'};
  }

  @Post('finance/company')
  async saveCompanyFinance(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('user') userId = '',
    @Body() body:unknown,
  ){
    this.assertInternalKey(providedKey);
    await this.assertPlatformAdmin(userId);
    if(process.env.MW1_STAGING_MODE!=='true')
      throw new UnauthorizedException('Rentabilidad por empresa solo en staging.');
    let entry;
    try{entry=validateFinanceCompanyEntry(body);}
    catch(e){throw new BadRequestException(e instanceof Error?e.message:'Registro inválido.');}
    const client=this.supabaseService.getClient();
    const sourceTable=entry.companySource==='operational'?
      'platform_external_tenant_registry':'companies';
    const field=entry.companySource==='operational'?'company_slug':'slug';
    const {data:exists,error:existsError}=await client.from(sourceTable)
      .select(field).eq(field,entry.companySlug).maybeSingle();
    if(existsError||!exists)
      throw new BadRequestException('Empresa no registrada en el directorio permitido.');
    const {error}=await client.from('platform_finance_company_monthly').upsert({
      period_month:entry.periodMonth,company_source:entry.companySource,
      company_slug:entry.companySlug,billed_cop:entry.billedCop,
      received_cop:entry.receivedCop,openai_cop:entry.openaiCop,
      support_cop:entry.supportCop,onboarding_cop:entry.onboardingCop,
      other_direct_cop:entry.otherDirectCop,
      allocation_weight:entry.allocationWeight,
      include_in_allocation:entry.includeInAllocation,
      evidence_note:entry.evidenceNote,updated_by:userId,
      updated_at:new Date().toISOString(),
    },{onConflict:'period_month,company_source,company_slug'});
    if(error)throw new BadRequestException('No se pudo guardar el registro por empresa.');
    return {ok:true,message:'Registro financiero privado guardado. No se han creado facturas, cobros ni límites.'};
  }

  @Get('ai-model-rates')
  async listAiModelRates(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('user') userId = '',
  ) {
    this.assertInternalKey(providedKey);
    await this.assertPlatformAdmin(userId);
    if(process.env.MW1_STAGING_MODE!=='true')
      throw new UnauthorizedException('Tarifas disponibles solo en pruebas.');
    const {data,error}=await this.supabaseService.getClient()
      .from('platform_ai_model_rates')
      .select('model,input_usd_per_million,cached_input_usd_per_million,output_usd_per_million,effective_from')
      .order('model',{ascending:true}).limit(200);
    if(error)throw new BadRequestException('No se pudieron consultar las tarifas.');
    return {ok:true,rates:data??[]};
  }

  @Post('ai-model-rates')
  async saveAiModelRate(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('user') userId = '',
    @Body() body:unknown,
  ) {
    this.assertInternalKey(providedKey);
    await this.assertPlatformAdmin(userId);
    if(process.env.MW1_STAGING_MODE!=='true')
      throw new UnauthorizedException('Tarifas disponibles solo en pruebas.');
    if(!body||typeof body!=='object'||Array.isArray(body))
      throw new BadRequestException('Tarifa inválida.');
    const b=body as Record<string,unknown>;
    if(Object.keys(b).some(k=>!['model','input','cached','output'].includes(k))||
       typeof b.model!=='string'||!/^[a-zA-Z0-9._:-]{1,120}$/.test(b.model))
      throw new BadRequestException('Modelo inválido.');
    for(const field of ['input','cached','output']){
      const n=b[field];
      if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>999999)
        throw new BadRequestException('Tarifa inválida: '+field);
    }
    const {error}=await this.supabaseService.getClient()
      .from('platform_ai_model_rates').upsert({
        model:b.model,input_usd_per_million:b.input,
        cached_input_usd_per_million:b.cached,output_usd_per_million:b.output,
        effective_from:new Date().toISOString(),updated_at:new Date().toISOString(),
      },{onConflict:'model'});
    if(error)throw new BadRequestException('No se pudo guardar la tarifa.');
    return {ok:true,message:'Tarifa interna guardada en staging. No se actualizaron facturas.'};
  }

  @Get('ai-usage')
  async getAiUsage(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('user') userId = '',
    @Query('companyId') companyId = '',
  ) {
    this.assertInternalKey(providedKey);
    await this.assertPlatformAdmin(userId);
    if(process.env.MW1_STAGING_MODE!=='true')
      throw new UnauthorizedException('Reporte disponible solo en pruebas.');
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(companyId))
      throw new BadRequestException('Empresa inválida.');
    const monthStart=new Date();
    monthStart.setUTCDate(1);monthStart.setUTCHours(0,0,0,0);
    const {data,error}=await this.supabaseService.getClient()
      .from('platform_ai_usage_events')
      .select('input_tokens,output_tokens,cached_input_tokens,estimated_cost_usd,model,recorded_at')
      .eq('company_id',companyId)
      .gte('recorded_at',monthStart.toISOString()).limit(10000);
    if(error)throw new BadRequestException('No se pudo consultar el consumo de IA.');
    const events=data??[];
    const {data:rateRows,error:rateError}=await this.supabaseService.getClient()
      .from('platform_ai_model_rates')
      .select('model,input_usd_per_million,cached_input_usd_per_million,output_usd_per_million')
      .limit(200);
    // Missing/invalid pricing must not be misreported as zero cost.
    const rates=new Map((rateError?[]:rateRows??[]).map(rate=>[rate.model,rate]));
    let calculatedCostUsd=0;
    let recordsMissingRates=0;
    for(const event of events){
      if(event.estimated_cost_usd!==null)continue;
      const rate=rates.get(event.model);
      if(!rate){recordsMissingRates++;continue;}
      try{
        calculatedCostUsd+=estimateAiCostUsd({
          inputTokens:Number(event.input_tokens),cachedInputTokens:Number(event.cached_input_tokens),
          outputTokens:Number(event.output_tokens),
        },{
          inputUsdPerMillion:Number(rate.input_usd_per_million),
          cachedInputUsdPerMillion:Number(rate.cached_input_usd_per_million),
          outputUsdPerMillion:Number(rate.output_usd_per_million),
        });
      }catch{recordsMissingRates++;}
    }
    return {ok:true,companyId,periodStart:monthStart.toISOString(),
      pricedFromConfiguredRatesUsd:calculatedCostUsd,
      recordsMissingRates:rateError?events.filter(e=>e.estimated_cost_usd===null).length:recordsMissingRates,
      rateConfigurationAvailable:!rateError,
      records:events.length,truncated:events.length===10000,
      inputTokens:events.reduce((n,e)=>n+Number(e.input_tokens||0),0),
      outputTokens:events.reduce((n,e)=>n+Number(e.output_tokens||0),0),
      cachedInputTokens:events.reduce((n,e)=>n+Number(e.cached_input_tokens||0),0),
      knownEstimatedCostUsd:events.reduce((n,e)=>n+Number(e.estimated_cost_usd||0),0),
      recordsWithoutCost:events.filter(e=>e.estimated_cost_usd===null).length,
      coverage:'staging_instrumented_events_only'};
  }

  @Get('plans/public')
  async getPublicPlanPrices(@Headers('x-chatpro-inbox-key') providedKey = '') {
    this.assertInternalKey(providedKey);
    if(process.env.MW1_STAGING_MODE!=='true')
      throw new UnauthorizedException('Precios de prueba no disponibles.');
    const {data,error}=await this.supabaseService.getClient()
      .from('platform_published_plan_prices')
      .select('plan_key,price_cop,max_users,max_whatsapp_lines,extra_user_cop,extra_connection_cop,ai_monthly_budget_cop,public_summary,public_features,published_at')
      .limit(3);
    if(error)throw new BadRequestException('No se pudo cargar la lista de precios.');
    return {ok:true,plans:data??[]};
  }

  @Post('plans/publish')
  async publishPlanPrice(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('user') userId = '',
    @Body() body:unknown,
  ) {
    this.assertInternalKey(providedKey);
    await this.assertPlatformAdmin(userId);
    if(process.env.MW1_STAGING_MODE!=='true')
      throw new UnauthorizedException('Publicación disponible solo en pruebas.');
    if(!body||typeof body!=='object'||Array.isArray(body))
      throw new BadRequestException('Plan inválido.');
    const key=(body as Record<string,unknown>).planKey;
    if(typeof key!=='string'||!PLAN_KEYS.includes(key as typeof PLAN_KEYS[number]))
      throw new BadRequestException('Plan no reconocido.');
    const client=this.supabaseService.getClient();
    const {data:draft,error:draftError}=await client
      .from('platform_commercial_plan_drafts')
      .select('plan_key,price_cop,max_users,max_whatsapp_lines,extra_user_cop,extra_connection_cop,ai_monthly_budget_cop,public_summary,public_features,whatsapp_enabled,review_status')
      .eq('plan_key',key).maybeSingle();
    if(draftError||!draft)throw new BadRequestException('Guarda un borrador antes de publicarlo.');
    if(draft.review_status!=='ready_for_review'||!draft.whatsapp_enabled||
       !Number.isSafeInteger(draft.price_cop)||draft.price_cop<=0||
       !Number.isSafeInteger(draft.max_users)||draft.max_users<=0||
       !Number.isSafeInteger(draft.max_whatsapp_lines)||draft.max_whatsapp_lines<=0)
      throw new BadRequestException('El plan debe estar completo y listo para revisión.');
    const {error}=await client.from('platform_published_plan_prices').upsert({
      plan_key:key,price_cop:draft.price_cop,max_users:draft.max_users,
      max_whatsapp_lines:draft.max_whatsapp_lines,
      extra_user_cop:draft.extra_user_cop,extra_connection_cop:draft.extra_connection_cop,
      ai_monthly_budget_cop:draft.ai_monthly_budget_cop,public_summary:draft.public_summary,public_features:draft.public_features,
      published_at:new Date().toISOString(),published_by:userId,
    },{onConflict:'plan_key'});
    if(error)throw new BadRequestException('No se pudo publicar el precio.');
    return {ok:true,message:'Precio y cupos publicados en staging. No se activaron suscripciones ni se modificaron clientes.'};
  }

  // Private staging owner credential management. This does not change tenant entitlements.
  @Get('companies/owners')
  async listCompanyOwners(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('user') userId = '',
  ) {
    this.assertInternalKey(providedKey);
    await this.assertPlatformAdmin(userId);
    if (process.env.MW1_STAGING_MODE !== 'true')
      throw new UnauthorizedException('Disponible únicamente en MW1 staging.');
    const db = this.supabaseService.getClient();
    const { data: companies, error: ce } = await db.from('companies')
      .select('id,slug,name').order('name', { ascending: true });
    if (ce) throw new BadRequestException('No se pudieron consultar las empresas.');
    const ids = (companies ?? []).map(item => item.id);
    if (!ids.length) return { ok: true, owners: [] };
    const { data: members, error: me } = await db.from('company_memberships')
      .select('company_id,user_id,role_id,active').in('company_id', ids).eq('active', true);
    if (me) throw new BadRequestException('No se pudieron consultar los propietarios.');
    const roleIds = [...new Set((members ?? []).map(m=>m.role_id))];
    const { data: roles, error: re } = roleIds.length
      ? await db.from('app_roles').select('id,key,company_id').in('id', roleIds)
      : { data: [], error: null };
    if (re) throw new BadRequestException('No se pudieron consultar los roles.');
    const roleRows=(roles ?? []) as Array<{id:string;key:string;company_id:string|null}>;
    const ownerRoles = new Map<string,string|null>(roleRows
      .filter(r=>r.key==='owner').map(r=>[r.id,r.company_id] as const));
    const owners = (members ?? []).filter(m=>ownerRoles.has(m.role_id)
      && (!ownerRoles.get(m.role_id) || ownerRoles.get(m.role_id)===m.company_id));
    const userIds=[...new Set(owners.map(m=>m.user_id))];
    const { data: profiles, error: pe } = userIds.length
      ? await db.from('app_profiles').select(
          'user_id,full_name,login_identifier,contact_email,recovery_phone,recovery_email_verified_at,active'
        ).in('user_id',userIds)
      : { data: [], error: null };
    if (pe) throw new BadRequestException('No se pudieron consultar los perfiles.');
    const profileRows=(profiles ?? []) as Array<{
      user_id:string;full_name:string;login_identifier:string|null;contact_email:string|null;
      recovery_phone:string|null;recovery_email_verified_at:string|null;active:boolean;
    }>;
    const byUser = new Map(profileRows.map(p=>[p.user_id,p] as const));
    const byCompany = new Map((companies ?? []).map(p=>[p.id,p] as const));
    return { ok: true, owners: owners.map(m=>{
      const p=byUser.get(m.user_id);
      const company=byCompany.get(m.company_id);
      return {companyId:m.company_id,companyName:company?.name??'',companySlug:company?.slug??'',
        userId:m.user_id,name:p?.full_name??'Propietario',
        identifier:p?.login_identifier??'',contactEmail:p?.contact_email??'',
        contactPhone:p?.recovery_phone??'',emailVerified:Boolean(p?.recovery_email_verified_at),
        active:Boolean(p?.active)};
    }).filter(item=>item.active) };
  }

  @Post('companies/owner-access')
  async manageCompanyOwnerAccess(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('user') actorId = '',
    @Body() body: unknown,
  ) {
    this.assertInternalKey(providedKey);
    await this.assertPlatformAdmin(actorId);
    if (process.env.MW1_STAGING_MODE !== 'true')
      throw new UnauthorizedException('Disponible únicamente en MW1 staging.');
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new BadRequestException('Solicitud inválida.');
    const value=body as Record<string,unknown>;
    const allowed=['companyId','userId','identifier','password','contactEmail','contactPhone'];
    if(Object.keys(value).some(k=>!allowed.includes(k)))
      throw new BadRequestException('Campo no permitido.');
    const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if(typeof value.companyId!=='string'||!uuid.test(value.companyId)||
      typeof value.userId!=='string'||!uuid.test(value.userId))
      throw new BadRequestException('Empresa o propietario inválido.');
    const changeId=Object.prototype.hasOwnProperty.call(value,'identifier');
    const changePassword=Object.prototype.hasOwnProperty.call(value,'password');
    const changeEmail=Object.prototype.hasOwnProperty.call(value,'contactEmail');
    const changePhone=Object.prototype.hasOwnProperty.call(value,'contactPhone');
    if(!changeId&&!changePassword&&!changeEmail&&!changePhone)
      throw new BadRequestException('No hay cambios para guardar.');
    const identifier=changeId?this.normalizeIdentifier(value.identifier):null;
    const password=changePassword?value.password:null;
    if(changePassword && (typeof password!=='string'||password.length<12||password.length>128||
      !/[a-z]/i.test(password)||!/[0-9]/.test(password)))
      throw new BadRequestException('La nueva contraseña debe tener 12 a 128 caracteres, letras y números.');
    const email=changeEmail
      ?(typeof value.contactEmail==='string'?value.contactEmail.trim().toLowerCase():''):null;
    if(changeEmail && (typeof value.contactEmail!=='string'||(email!==''&&
      (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email!)||email!.length>254))))
      throw new BadRequestException('Correo de recuperación inválido.');
    const phone=changePhone
      ?(typeof value.contactPhone==='string'?value.contactPhone.replace(/[\s()-]/g,'').trim():''):null;
    if(changePhone && (typeof value.contactPhone!=='string'||(phone!==''&&
      !/^[+]?[0-9]{7,19}$/.test(phone!))))
      throw new BadRequestException('Celular de recuperación inválido.');
    const db=this.supabaseService.getClient();
    const {data:company,error:ce}=await db.from('companies').select('id')
      .eq('id',value.companyId).maybeSingle();
    if(ce||!company)throw new BadRequestException('Empresa de staging no encontrada.');
    const {data:membership,error:me}=await db.from('company_memberships')
      .select('role_id,active').eq('company_id',company.id).eq('user_id',value.userId).maybeSingle();
    if(me||!membership?.active)throw new UnauthorizedException('Propietario no autorizado para esta empresa.');
    const {data:role,error:re}=await db.from('app_roles').select('key,company_id')
      .eq('id',membership.role_id).maybeSingle();
    if(re||role?.key!=='owner'||(role.company_id&&role.company_id!==company.id))
      throw new UnauthorizedException('Este usuario no es propietario de esa empresa.');
    const {data:platformAdmin,error:ae}=await db.from('platform_admins')
      .select('active').eq('user_id',value.userId).maybeSingle();
    if(ae||platformAdmin?.active)
      throw new UnauthorizedException('No se administran credenciales de la plataforma aquí.');
    const {data:profile,error:pe}=await db.from('app_profiles')
      .select('user_id,login_identifier,contact_email,recovery_phone,recovery_email_verified_at,active')
      .eq('user_id',value.userId).maybeSingle();
    if(pe||!profile?.active)throw new UnauthorizedException('Perfil de propietario inactivo.');
    if(identifier && identifier!==profile.login_identifier){
      const {data:duplicate,error:de}=await db.from('app_profiles')
        .select('user_id').eq('login_identifier',identifier).maybeSingle();
      if(de||duplicate)throw new BadRequestException('Ese código ya pertenece a otro usuario.');
    }
    const changedIdentifier=Boolean(identifier && identifier!==profile.login_identifier);
    const changedEmail=changeEmail&&email!==String(profile.contact_email??'');
    const changedPhone=changePhone&&phone!==String(profile.recovery_phone??'');
    if(!changedIdentifier&&!changePassword&&!changedEmail&&!changedPhone)
      throw new BadRequestException('No se detectaron cambios.');
    const updates:Record<string,unknown>={updated_at:new Date().toISOString()};
    if(changeId)updates.login_identifier=identifier;
    if(changePassword)updates.password_hash=this.accessAuthService.hash(password as string);
    if(changeEmail){
      updates.contact_email=email||null;
      if(changedEmail)updates.recovery_email_verified_at=null;
    }
    if(changePhone)updates.recovery_phone=phone||null;
    // Supabase Auth holds a secondary copy: update it before application login hash.
    // The signed MW1 login validates app_profiles.password_hash.
    if(changePassword){
      const {error:authError}=await db.auth.admin.updateUserById(value.userId,
        {password:password as string});
      if(authError)throw new BadRequestException('No se pudo actualizar la contraseña de acceso.');
    }
    const {error:ue}=await db.from('app_profiles').update(updates).eq('user_id',value.userId);
    if(ue)throw new BadRequestException('No se pudieron guardar los cambios del propietario. Verifica antes de reintentar.');
    const {error:logError}=await db.from('platform_access_audit').insert({
      company_id:company.id,target_user_id:value.userId,actor_user_id:actorId,
      changed_identifier:changedIdentifier,changed_password:changePassword,
      changed_contact_email:changedEmail,changed_contact_phone:changedPhone,
    });
    if(logError)throw new BadRequestException('Datos actualizados, pero el registro de auditoría falló. Comprueba el perfil.');
    return {ok:true,message:'Acceso del propietario actualizado. Comunica la nueva contraseña por un canal seguro.',
      identifier:identifier??profile.login_identifier,
      passwordChanged:changePassword,emailVerified:changedEmail?false:Boolean(profile.recovery_email_verified_at)};
  }

  // Public request endpoint called only by server-to-server internal key.
  // It NEVER changes a code, password, email verification or membership.
  @Post('recovery-requests')
  async requestAccountRecovery(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Body() value:unknown,
  ){
    this.assertInternalKey(providedKey);
    if(process.env.MW1_STAGING_MODE!=='true')
      throw new UnauthorizedException('Disponible únicamente en staging.');
    if(!value||typeof value!=='object'||Array.isArray(value))
      throw new BadRequestException('Datos inválidos.');
    const data=value as Record<string,unknown>;
    const company=typeof data.companySlug==='string'?data.companySlug.trim().toLowerCase():'';
    const identifier=typeof data.identifier==='string'?data.identifier.trim().toUpperCase():'';
    const method=data.method;
    const contact=typeof data.contact==='string'?data.contact.trim():'';
    const digest=typeof data.visitorDigest==='string'?data.visitorDigest:'';
    if(!/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(company)||
      !/^[A-Z0-9._-]{3,60}$/.test(identifier)||
      (method!=='email'&&method!=='phone')||
      !/^[a-f0-9]{64}$/.test(digest)||
      (method==='email'?(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)||contact.length>254)
        : !/^[+]?[0-9]{7,19}$/.test(contact.replace(/[\s()-]/g,''))))
      throw new BadRequestException('Revisa los datos de recuperación.');
    const db=this.supabaseService.getClient();
    const {count,error:rateError}=await db.from('platform_access_recovery_requests')
      .select('id',{count:'exact',head:true}).eq('visitor_digest',digest)
      .gte('created_at',new Date(Date.now()-3600000).toISOString());
    if(rateError)throw new BadRequestException('No fue posible procesar la solicitud.');
    const generic={ok:true,message:'Solicitud recibida. Un asesor deberá verificar tu identidad antes de restablecer el acceso. No se modificó la contraseña.'};
    if((count??0)>=3)return generic;
    const {data:companyRow}=await db.from('companies').select('id').eq('slug',company)
      .eq('status','active').maybeSingle();
    if(!companyRow?.id)return generic;
    const {data:profile}=await db.from('app_profiles').select('user_id,active')
      .eq('login_identifier',identifier).maybeSingle();
    if(!profile?.active)return generic;
    const {data:member}=await db.from('company_memberships').select('id,active')
      .eq('company_id',companyRow.id).eq('user_id',profile.user_id).maybeSingle();
    if(!member?.active)return generic;
    const {error}=await db.from('platform_access_recovery_requests').insert({
      company_slug:company,login_identifier:identifier,
      contact_method:method,contact_value:method==='email'?contact.toLowerCase():contact.replace(/[\s()-]/g,''),
      visitor_digest:digest,
    });
    if(error)throw new BadRequestException('No se pudo registrar la solicitud.');
    return generic;
  }

  @Get('recovery-requests')
  async listAccountRecoveryRequests(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('user') actorId = '',
  ){
    this.assertInternalKey(providedKey);
    await this.assertPlatformAdmin(actorId);
    if(process.env.MW1_STAGING_MODE!=='true')
      throw new UnauthorizedException('Disponible únicamente en staging.');
    const {data,error}=await this.supabaseService.getClient()
      .from('platform_access_recovery_requests')
      .select('id,company_slug,login_identifier,contact_method,contact_value,status,created_at')
      .order('created_at',{ascending:false}).limit(70);
    if(error)throw new BadRequestException('No se pudieron consultar las solicitudes de recuperación.');
    return {ok:true,requests:(data??[]).map(r=>({
      id:r.id,companySlug:r.company_slug,identifier:r.login_identifier,
      method:r.contact_method,contact:r.contact_value,status:r.status,
      createdAt:r.created_at,
    }))};
  }

  @Post('companies')
  async createCompany(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Query('user') userId = '',
    @Body() body: CreateCompanyBody,
  ) {
    this.assertInternalKey(providedKey);
    await this.assertPlatformAdmin(userId);

    const name = this.requiredText(body.name, 'Escribe el nombre de la empresa.');
    const slug = this.validSlug(body.slug);
    const planKey = this.optionalText(body.planKey).toLowerCase() || 'custom';
    const maxUsers = this.positiveInteger(body.maxUsers, 3, 'usuarios');
    const maxWhatsappLines = this.positiveInteger(
      body.maxWhatsappLines,
      1,
      'líneas de WhatsApp',
    );
    const ownerFullName = this.requiredText(
      body.ownerFullName,
      'Escribe el nombre del propietario.',
    );
    const ownerIdentifier = this.normalizeIdentifier(body.ownerIdentifier);
    const ownerPassword = this.validPassword(body.ownerPassword);

    const entitlement = {
      plan_key: planKey,
      ai_enabled: body.aiEnabled === true,
      whatsapp_enabled: body.whatsappEnabled !== false,
      instagram_enabled: body.instagramEnabled === true,
      messenger_enabled: body.messengerEnabled === true,
      automations_enabled: body.automationsEnabled !== false,
      statistics_enabled: body.statisticsEnabled !== false,
      max_users: maxUsers,
      max_whatsapp_lines: maxWhatsappLines,
    };

    const client = this.supabaseService.getClient();

    const { data: existingCompany, error: existingCompanyError } = await client
      .from('companies')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();

    if (existingCompanyError) {
      throw new BadRequestException(
        `No se pudo validar el identificador de empresa: ${existingCompanyError.message}`,
      );
    }

    if (existingCompany) {
      throw new BadRequestException('Ya existe una empresa con ese identificador.');
    }

    const { data: existingProfile, error: existingProfileError } = await client
      .from('app_profiles')
      .select('user_id')
      .eq('login_identifier', ownerIdentifier)
      .maybeSingle();

    if (existingProfileError) {
      throw new BadRequestException(
        `No se pudo validar el acceso del propietario: ${existingProfileError.message}`,
      );
    }

    if (existingProfile) {
      throw new BadRequestException(
        'La identificación o código del propietario ya está en uso.',
      );
    }

    const { data: ownerRole, error: ownerRoleError } = await client
      .from('app_roles')
      .select('id,key')
      .eq('key', 'owner')
      .is('company_id', null)
      .maybeSingle();

    if (ownerRoleError || !ownerRole?.id) {
      throw new BadRequestException(
        ownerRoleError?.message || 'No existe el rol base Propietario.',
      );
    }

    let createdCompanyId = '';
    let createdUserId = '';

    try {
      const { data: company, error: companyError } = await client
        .from('companies')
        .insert({ name, slug, status: 'active' })
        .select('id,slug,name,status')
        .single();

      if (companyError || !company?.id) {
        throw new Error(companyError?.message || 'No se pudo crear la empresa.');
      }

      createdCompanyId = company.id;

      const { error: entitlementError } = await client
        .from('company_entitlements')
        .insert({
          company_id: createdCompanyId,
          ...entitlement,
        });

      if (entitlementError) {
        throw new Error(entitlementError.message);
      }

      const technicalEmail = this.technicalEmail(slug, ownerIdentifier);
      const { data: authUser, error: authError } =
        await client.auth.admin.createUser({
          email: technicalEmail,
          password: ownerPassword,
          email_confirm: true,
          user_metadata: {
            full_name: ownerFullName,
            login_identifier: ownerIdentifier,
          },
        });

      if (authError || !authUser.user) {
        throw new Error(authError?.message || 'No se pudo crear el propietario.');
      }

      createdUserId = authUser.user.id;

      const { error: profileError } = await client.from('app_profiles').upsert(
        {
          user_id: createdUserId,
          full_name: ownerFullName,
          email: technicalEmail,
          contact_email: null,
          login_identifier: ownerIdentifier,
          password_hash: this.accessAuthService.hash(ownerPassword),
          active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );

      if (profileError) {
        throw new Error(profileError.message);
      }

      const { error: membershipError } = await client
        .from('company_memberships')
        .insert({
          company_id: createdCompanyId,
          user_id: createdUserId,
          role_id: ownerRole.id,
          active: true,
        });

      if (membershipError) {
        throw new Error(membershipError.message);
      }

      const { error: settingsError } = await client
        .from('company_settings')
        .upsert(
          {
            company_id: createdCompanyId,
            settings: {},
          },
          { onConflict: 'company_id' },
        );

      if (settingsError) {
        throw new Error(settingsError.message);
      }

      return {
        ok: true,
        message: 'Empresa y propietario creados correctamente.',
        company: {
          id: company.id,
          slug: company.slug,
          name: company.name,
          status: company.status,
        },
        entitlements: this.toEntitlementResponse({
          company_id: createdCompanyId,
          ...entitlement,
        } as EntitlementRow),
        owner: {
          userId: createdUserId,
          fullName: ownerFullName,
          identifier: ownerIdentifier,
        },
      };
    } catch (error) {
      if (createdUserId) {
        await client.auth.admin.deleteUser(createdUserId);
      }

      if (createdCompanyId) {
        await client.from('company_memberships').delete().eq('company_id', createdCompanyId);
        await client.from('company_settings').delete().eq('company_id', createdCompanyId);
        await client.from('company_entitlements').delete().eq('company_id', createdCompanyId);
        await client.from('companies').delete().eq('id', createdCompanyId);
      }

      throw new BadRequestException(
        `No se pudo crear la empresa: ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
    }
  }

  private async assertPlatformAdmin(userId: string): Promise<void> {
    const normalizedUserId = this.requiredText(userId, 'Falta el usuario.');

    if (!(await this.isPlatformAdmin(normalizedUserId))) {
      throw new UnauthorizedException(
        'No tienes permiso de Super Admin de MW1.',
      );
    }
  }

  private async isPlatformAdmin(userId: string): Promise<boolean> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('platform_admins')
      .select('user_id,active')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(
        `No se pudo validar el Super Admin: ${error.message}`,
      );
    }

    return data?.active === true;
  }

  private assertInternalKey(providedKey: string): void {
    const expectedKey = process.env.CHATPRO_INBOX_KEY?.trim();

    if (!expectedKey || providedKey !== expectedKey) {
      throw new UnauthorizedException('No autorizado.');
    }
  }

  private toEntitlementResponse(row: EntitlementRow) {
    return {
      planKey: row.plan_key,
      aiEnabled: row.ai_enabled,
      whatsappEnabled: row.whatsapp_enabled,
      instagramEnabled: row.instagram_enabled,
      messengerEnabled: row.messenger_enabled,
      automationsEnabled: row.automations_enabled,
      statisticsEnabled: row.statistics_enabled,
      maxUsers: row.max_users,
      maxWhatsappLines: row.max_whatsapp_lines,
    };
  }

  private validSlug(value: unknown): string {
    const slug = this.requiredText(
      value,
      'Escribe el identificador de la empresa.',
    )
      .toLowerCase()
      .replace(/\s+/g, '-');

    if (!/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(slug)) {
      throw new BadRequestException(
        'El identificador solo puede usar letras minúsculas, números y guiones.',
      );
    }

    return slug;
  }

  private normalizeIdentifier(value: unknown): string {
    const identifier = this.requiredText(
      value,
      'Escribe la identificación o código de acceso del propietario.',
    )
      .toUpperCase()
      .replace(/\s+/g, '');

    if (!/^[A-Z0-9._-]{3,60}$/.test(identifier)) {
      throw new BadRequestException(
        'El código de acceso solo puede usar letras, números, punto, guion o guion bajo.',
      );
    }

    return identifier;
  }

  private validPassword(value: unknown): string {
    const password = this.requiredText(
      value,
      'Escribe una contraseña inicial para el propietario.',
    );

    if (password.length < 8) {
      throw new BadRequestException(
        'La contraseña debe tener mínimo 8 caracteres.',
      );
    }

    return password;
  }

  private positiveInteger(
    value: unknown,
    fallback: number,
    label: string,
  ): number {
    if (value === undefined || value === null || value === '') return fallback;

    const number = Number(value);
    if (!Number.isInteger(number) || number < 1 || number > 1000) {
      throw new BadRequestException(`El límite de ${label} no es válido.`);
    }

    return number;
  }

  private technicalEmail(companySlug: string, identifier: string): string {
    const hash = createHash('sha256')
      .update(`${companySlug}:${identifier}`)
      .digest('hex')
      .slice(0, 28);

    return `access-${hash}@chatpro.invalid`;
  }

  private optionalText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private requiredText(value: unknown, message: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(message);
    }

    return value.trim();
  }
}
