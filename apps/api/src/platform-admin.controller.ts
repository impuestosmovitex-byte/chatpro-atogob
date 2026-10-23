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
import { createHash } from 'crypto';
import { AccessAuthService } from './access-auth.service';
import { SupabaseService } from './supabase.service';
import {companyReadiness} from './platform-company-readiness';
import {emptyPlanDraft,PLAN_KEYS,validatePlanDraft} from './platform-plan-drafts';
import {estimateAiCostUsd} from './platform-ai-cost';

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

    return {
      ok: true,
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
      .select('id,company_name,contact_name,contact_email,plan_interest,status,created_at')
      .order('created_at',{ascending:false})
      .limit(50);
    if(error)throw new BadRequestException('No fue posible consultar las solicitudes.');
    return {ok:true,requests:(data??[]).map(record=>({
      id:record.id,
      companyName:record.company_name,
      contactName:record.contact_name,
      contactEmail:record.contact_email,
      planInterest:record.plan_interest,
      status:record.status,
      createdAt:record.created_at,
    }))};
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
