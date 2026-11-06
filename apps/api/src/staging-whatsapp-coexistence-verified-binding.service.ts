import { Injectable } from '@nestjs/common';
import { SupabaseService } from './supabase.service';
import { StagingWhatsappCoexistenceMetaTokenReviewService } from
  './staging-whatsapp-coexistence-meta-token-review.service';
import { StagingWhatsappCoexistenceMetaGraphService } from
  './staging-whatsapp-coexistence-meta-graph.service';
import type { WhatsappCoexistenceOAuthActorRequest } from
  './staging-whatsapp-coexistence-oauth-handshake.service';

/**
 * STAGING ONLY: creates a 15-minute evidence binding AFTER a one-time
 * signed pilot nonce has been consumed and Meta's code exchanged server-side.
 * This is NOT a WhatsApp connection, a provisioner, or an access-token store.
 * All Meta identifiers come from authenticated Graph responses, not from
 * browser-supplied claims. The callback must authenticate the pilot actor.
 */
@Injectable()
export class StagingWhatsappCoexistenceVerifiedBindingService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly tokens: StagingWhatsappCoexistenceMetaTokenReviewService,
    private readonly graph: StagingWhatsappCoexistenceMetaGraphService,
    private readonly request: typeof fetch = fetch,
  ) {}

  async bind(input: {
    actor: WhatsappCoexistenceOAuthActorRequest;
    onboardingId: string;
    wabaId: string;
    phoneNumberId: string;
    accessToken: string;
    metaBusinessIdHint: string | null;
  }): Promise<boolean> {
    const id=/^\d{6,30}$/;
    const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if(process.env.MW1_STAGING_MODE!=='true' ||
       process.env.SUPABASE_URL?.trim().replace(/\/$/,'')!==
         'https://zqfbxqszfnrbwpfukwak.supabase.co' ||
       process.env.MW1_STAGING_WHATSAPP_COEXISTENCE_META_REVIEW_ENABLED!=='true' ||
       process.env.MW1_STAGING_WHATSAPP_COEXISTENCE_META_LAUNCH_ENABLED!=='true' ||
       input?.actor?.companySlug!=='piloto-mw1-prueba' ||
       !uuid.test(input.actor.companyId||'') ||
       !uuid.test(input.actor.userId||'') ||
       !uuid.test(input.onboardingId||'') ||
       !id.test(input.wabaId||'') || !id.test(input.phoneNumberId||'') ||
       typeof input.accessToken!=='string' ||
       input.accessToken.length<20 || input.accessToken.length>4096 ||
       /[\r\n\u0000]/.test(input.accessToken) ||
       (input.metaBusinessIdHint!==null && !id.test(input.metaBusinessIdHint))) {
      return false;
    }
    // Confirm live membership and tenant before any Graph requests.
    const db=this.supabase.getClient();
    const {data:company,error:companyError}=await db.from('companies')
      .select('id,status').eq('id',input.actor.companyId)
      .eq('slug','piloto-mw1-prueba').maybeSingle();
    if(companyError||!company||company.status!=='active')return false;
    const {data:member,error:memberError}=await db.from('company_memberships')
      .select('role_id,active').eq('company_id',input.actor.companyId)
      .eq('user_id',input.actor.userId).eq('active',true).maybeSingle();
    if(memberError||!member||!member.active)return false;
    const {data:role,error:roleError}=await db.from('app_roles')
      .select('key,company_id').eq('id',member.role_id).maybeSingle();
    if(roleError||!role||!['owner','admin'].includes(role.key)||
       (role.company_id&&role.company_id!==input.actor.companyId))return false;

    // Fail closed if the phone is already assigned to ANY tenant.
    const {data:assigned,error:assignedError}=await db.from('company_integrations')
      .select('company_id').eq('provider','meta')
      .eq('integration_type','whatsapp').eq('external_id',input.phoneNumberId)
      .limit(1);
    if(assignedError||!Array.isArray(assigned)||assigned.length!==0)return false;
    const grant=await this.tokens.review(input.accessToken,input.wabaId);
    if(!grant.reviewed||grant.wabaId!==input.wabaId)return false;
    const phone=await this.graph.verify({
      wabaId:input.wabaId,phoneNumberId:input.phoneNumberId,
      accessToken:input.accessToken,
    });
    if(!phone.verified)return false;

    // WABA owner is independently obtained from Graph; a browser business
    // ID can only narrow acceptance, never become proof of ownership.
    let ownerId:string;
    try{
      const res=await this.request(
        'https://graph.facebook.com/v26.0/'+input.wabaId+
        '?fields=id%2Cowner_business',{
        method:'GET',headers:{Authorization:'Bearer '+input.accessToken,
          Accept:'application/json'},
        redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000),
      });
      if(!res.ok)return false;
      const length=res.headers.get('content-length');
      if(length!==null&&(!/^\d+$/.test(length)||Number(length)>100000))
        return false;
      const body=await res.text();
      if(body.length>100000)return false;
      const result=JSON.parse(body) as {
        id?:unknown;owner_business?:{id?:unknown};
      };
      if(result?.id!==input.wabaId||
         typeof result.owner_business?.id!=='string'||
         !id.test(result.owner_business.id))return false;
      ownerId=result.owner_business.id;
    }catch{return false;}
    if(input.metaBusinessIdHint!==null &&
       input.metaBusinessIdHint!==ownerId)return false;

    // No upsert: cross-tenant WABA uniqueness must fail instead of
    // overwriting evidence that could belong to a different actor.
    const now=Date.now();
    const {error}=await db.from('mw1_whatsapp_coexistence_business_bindings')
      .insert({
        company_id:input.actor.companyId,
        waba_id:input.wabaId,
        meta_business_id:ownerId,
        verified_by_user_id:input.actor.userId,
        onboarding_id:input.onboardingId,
        verification_state:'verified',
        verified_at:new Date(now).toISOString(),
        expires_at:new Date(now+15*60*1000).toISOString(),
      });
    return !error;
  }
}
