import { Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { SupabaseService } from './supabase.service';
import { StagingWhatsappCoexistenceMetaGraphService } from
  './staging-whatsapp-coexistence-meta-graph.service';
import { StagingWhatsappCoexistenceMetaTokenReviewService } from
  './staging-whatsapp-coexistence-meta-token-review.service';
import { StagingWhatsappCoexistenceBusinessOwnerService } from
  './staging-whatsapp-coexistence-business-owner.service';

/**
 * STAGING-ONLY, unregistered internal onboarding prerequisite.
 * A future authorized controller MUST derive companyId + userId from a
 * verified signed server session (not browser body or arbitrary headers),
 * complete Meta OAuth and verify the Meta business grant BEFORE passing
 * its short-lived token here. This class DOES NOT establish that grant.
 *
 * No registration, webhook, token persistence, contact/history import or
 * message send. Not exposed in AppModule, routes, jobs or the UI.
 */
export type PilotCoexistenceVerificationInput = {
  internalKey: string;
  companySlug: string;
  companyId: string;
  userId: string;
  onboardingId: string;
  wabaId: string;
  phoneNumberId: string;
  accessToken: string;
};
export type PilotCoexistenceVerificationOutcome =
  | { readyForLaterProvisioningReview: true; wabaId: string; phoneNumberId: string }
  | { readyForLaterProvisioningReview: false;
      reason: 'staging_only' | 'unauthorized' | 'invalid_input'
      | 'tenant_not_authorized' | 'phone_already_registered'
      | 'database_unavailable' | 'meta_token_unconfirmed'
      | 'business_binding_missing' | 'business_binding_expired'
      | 'meta_business_owner_unconfirmed' | 'meta_verification_failed' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const META_ID = /^[0-9]{6,30}$/;
const STAGING_DB = 'https://zqfbxqszfnrbwpfukwak.supabase.co';
const PILOT = 'piloto-mw1-prueba';
function safeSecretEqual(a: string, b: string): boolean {
  const aa = createHash('sha256').update(a).digest();
  const bb = createHash('sha256').update(b).digest();
  return timingSafeEqual(aa, bb);
}

@Injectable()
export class StagingWhatsappCoexistenceTenantVerificationService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly graph: StagingWhatsappCoexistenceMetaGraphService,
    private readonly tokenReview: StagingWhatsappCoexistenceMetaTokenReviewService,
    private readonly businessOwner: StagingWhatsappCoexistenceBusinessOwnerService,
  ) {}

  async verify(input: PilotCoexistenceVerificationInput): Promise<PilotCoexistenceVerificationOutcome> {
    if (process.env.MW1_STAGING_MODE !== 'true' ||
        process.env.SUPABASE_URL?.trim().replace(/\/$/, '') !== STAGING_DB) {
      return { readyForLaterProvisioningReview: false, reason: 'staging_only' };
    }
    const expected = process.env.CHATPRO_INBOX_KEY?.trim() || '';
    const provided = typeof input?.internalKey === 'string' ? input.internalKey : '';
    if (!expected || !provided || !safeSecretEqual(expected, provided)) {
      return { readyForLaterProvisioningReview: false, reason: 'unauthorized' };
    }
    if (input.companySlug !== PILOT ||
        typeof input.companyId !== 'string' || !UUID.test(input.companyId) ||
        typeof input.userId !== 'string' || !UUID.test(input.userId) ||
        typeof input.onboardingId !== 'string' || !UUID.test(input.onboardingId) ||
        typeof input.wabaId !== 'string' || !META_ID.test(input.wabaId) ||
        typeof input.phoneNumberId !== 'string' || !META_ID.test(input.phoneNumberId) ||
        typeof input.accessToken !== 'string' ||
        input.accessToken.length < 20 || input.accessToken.length > 4096 ||
        /[\r\n\u0000]/.test(input.accessToken)) {
      return { readyForLaterProvisioningReview: false, reason: 'invalid_input' };
    }
    let approvedBusinessId = '';
    try {
      const db = this.supabase.getClient();
      const { data: company, error: companyError } = await db.from('companies')
        .select('id,slug,status').eq('id', input.companyId)
        .eq('slug', PILOT).maybeSingle();
      if (companyError || !company ||
          company.id !== input.companyId || company.slug !== PILOT ||
          company.status !== 'active') {
        return { readyForLaterProvisioningReview: false, reason: 'tenant_not_authorized' };
      }
      const { data: membership, error: memberError } = await db.from('company_memberships')
        .select('role_id,active').eq('company_id', input.companyId)
        .eq('user_id', input.userId).eq('active', true).maybeSingle();
      if (memberError || !membership || membership.active !== true ||
          typeof membership.role_id !== 'string') {
        return { readyForLaterProvisioningReview: false, reason: 'tenant_not_authorized' };
      }
      const { data: role, error: roleError } = await db.from('app_roles')
        .select('key,company_id').eq('id', membership.role_id).maybeSingle();
      if (roleError || !role || !['owner', 'admin'].includes(role.key) ||
          (role.company_id && role.company_id !== input.companyId)) {
        return { readyForLaterProvisioningReview: false, reason: 'tenant_not_authorized' };
      }

      // A phone owned by ANY company, including this pilot, must never have
      // its existing credentials overwritten. The later insert MUST also be
      // unique/atomic; this read-only check cannot prevent a race by itself.
      const { data: assigned, error: assignedError } = await db.from('company_integrations')
        .select('company_id').eq('provider', 'meta')
        .eq('integration_type', 'whatsapp')
        .eq('external_id', input.phoneNumberId).limit(2);
      if (assignedError || !Array.isArray(assigned)) {
        return { readyForLaterProvisioningReview: false, reason: 'database_unavailable' };
      }
      if (assigned.length !== 0) {
        return { readyForLaterProvisioningReview: false, reason: 'phone_already_registered' };
      }

      // The owner ID may NEVER come from an untrusted request. Read a
      // temporary authorization record stored after future signed OAuth.
      // This staging table starts EMPTY and has no public write path.
      const { data: binding, error: bindingError } = await db
        .from('mw1_whatsapp_coexistence_business_bindings')
        .select('company_id,waba_id,meta_business_id,verified_by_user_id,onboarding_id,verification_state,verified_at,expires_at')
        .eq('company_id', input.companyId)
        .eq('waba_id', input.wabaId).maybeSingle();
      if (bindingError) {
        return { readyForLaterProvisioningReview: false, reason: 'database_unavailable' };
      }
      if (!binding || binding.company_id !== input.companyId ||
          binding.waba_id !== input.wabaId ||
          binding.verified_by_user_id !== input.userId ||
          binding.onboarding_id !== input.onboardingId ||
          binding.verification_state !== 'verified' ||
          typeof binding.meta_business_id !== 'string' ||
          !META_ID.test(binding.meta_business_id)) {
        return { readyForLaterProvisioningReview: false, reason: 'business_binding_missing' };
      }
      const verifiedAt = typeof binding.verified_at === 'string'
        ? Date.parse(binding.verified_at) : NaN;
      const expiresAt = typeof binding.expires_at === 'string'
        ? Date.parse(binding.expires_at) : NaN;
      const now = Date.now();
      if (!Number.isFinite(verifiedAt) || !Number.isFinite(expiresAt) ||
          verifiedAt > now || now >= expiresAt || expiresAt <= verifiedAt ||
          expiresAt > verifiedAt + 30 * 60 * 1000) {
        return { readyForLaterProvisioningReview: false, reason: 'business_binding_expired' };
      }
      approvedBusinessId = binding.meta_business_id;
    } catch {
      // No internal database, credential or company data is returned or logged.
      return { readyForLaterProvisioningReview: false, reason: 'database_unavailable' };
    }

    // IMPORTANT: a future trusted caller must exchange a one-time OAuth code
    // and derive the tenant from the signed session. The token review proves
    // the Meta app and selected WABA grant, NOT the tenant's business
    // portfolio ownership. Until that ownership is independently bound to
    // the pilot, do not expose or activate this unregistered service.
    try {
      const reviewed = await this.tokenReview.review(input.accessToken, input.wabaId);
      if (!reviewed.reviewed || reviewed.wabaId !== input.wabaId) {
        return { readyForLaterProvisioningReview: false, reason: 'meta_token_unconfirmed' };
      }
    } catch {
      return { readyForLaterProvisioningReview: false, reason: 'meta_token_unconfirmed' };
    }
    try {
      const owner = await this.businessOwner.verify({
        wabaId: input.wabaId,
        expectedBusinessId: approvedBusinessId,
        accessToken: input.accessToken,
      });
      if (!owner.verified || owner.wabaId !== input.wabaId ||
          owner.ownerBusinessId !== approvedBusinessId) {
        return { readyForLaterProvisioningReview: false,
          reason: 'meta_business_owner_unconfirmed' };
      }
    } catch {
      return { readyForLaterProvisioningReview: false,
        reason: 'meta_business_owner_unconfirmed' };
    }
    try {
      const meta = await this.graph.verify({
        wabaId: input.wabaId,
        phoneNumberId: input.phoneNumberId,
        accessToken: input.accessToken,
      });
      if (!meta.verified || meta.wabaId !== input.wabaId ||
          meta.phoneNumberId !== input.phoneNumberId) {
        return { readyForLaterProvisioningReview: false, reason: 'meta_verification_failed' };
      }
      return {
        readyForLaterProvisioningReview: true,
        wabaId: meta.wabaId,
        phoneNumberId: meta.phoneNumberId,
      };
    } catch {
      return { readyForLaterProvisioningReview: false, reason: 'meta_verification_failed' };
    }
  }
}
