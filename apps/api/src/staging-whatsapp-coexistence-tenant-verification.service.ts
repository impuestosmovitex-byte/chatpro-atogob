import { createHash, timingSafeEqual } from 'node:crypto';
import { SupabaseService } from './supabase.service';
import { StagingWhatsappCoexistenceMetaGraphService } from
  './staging-whatsapp-coexistence-meta-graph.service';

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
  wabaId: string;
  phoneNumberId: string;
  accessToken: string;
};
export type PilotCoexistenceVerificationOutcome =
  | { readyForLaterProvisioningReview: true; wabaId: string; phoneNumberId: string }
  | { readyForLaterProvisioningReview: false;
      reason: 'staging_only' | 'unauthorized' | 'invalid_input'
      | 'tenant_not_authorized' | 'phone_already_registered'
      | 'database_unavailable' | 'meta_verification_failed' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const META_ID = /^[0-9]{6,30}$/;
const STAGING_DB = 'https://zqfbxqszfnrbwpfukwak.supabase.co';
const PILOT = 'piloto-mw1-prueba';
function safeSecretEqual(a: string, b: string): boolean {
  const aa = createHash('sha256').update(a).digest();
  const bb = createHash('sha256').update(b).digest();
  return timingSafeEqual(aa, bb);
}

export class StagingWhatsappCoexistenceTenantVerificationService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly graph: StagingWhatsappCoexistenceMetaGraphService,
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
        typeof input.wabaId !== 'string' || !META_ID.test(input.wabaId) ||
        typeof input.phoneNumberId !== 'string' || !META_ID.test(input.phoneNumberId) ||
        typeof input.accessToken !== 'string' ||
        input.accessToken.length < 20 || input.accessToken.length > 4096 ||
        /[\r\n\u0000]/.test(input.accessToken)) {
      return { readyForLaterProvisioningReview: false, reason: 'invalid_input' };
    }
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
    } catch {
      // No internal database, credential or company data is returned or logged.
      return { readyForLaterProvisioningReview: false, reason: 'database_unavailable' };
    }

    // IMPORTANT: input.accessToken must come only from a fresh verified Meta
    // authorization in a future trusted caller. We do not exchange OAuth,
    // validate token/app/business scopes or grant access here.
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
