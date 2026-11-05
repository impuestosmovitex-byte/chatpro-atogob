import { createHash, timingSafeEqual } from 'node:crypto';
import { SupabaseService } from './supabase.service';
import {
  issueWhatsappCoexistenceSignedState,
  verifyWhatsappCoexistenceSignedState,
  type CoexistencePilotActor,
} from './staging-whatsapp-coexistence-oauth-state';

/**
 * INTERNAL, UNREGISTERED: staging-only signed WhatsApp coexistence OAuth
 * preparation. Not wired to AppModule, public HTTP, Meta SDK or any production
 * channel. A future reviewed web route must authenticate an HttpOnly signed
 * MW1 session, derive company/user identities from it, and bind the returned
 * signed state to a Secure HttpOnly SameSite=Lax cookie on issuance.
 * On callback, read the cookie from the trusted request and clear it.
 *
 * This class does not exchange Meta OAuth codes, request Facebook Login,
 * write business ownership bindings, connect WhatsApp or use webhooks.
 */
export type WhatsappCoexistenceOAuthActorRequest = CoexistencePilotActor & {
  internalKey: string;
};
export type WhatsappCoexistenceOAuthIssued = {
  signedState: string;
  onboardingId: string;
};
export type WhatsappCoexistenceOAuthConsumed = {
  onboardingId: string;
};

const PILOT = 'piloto-mw1-prueba';
const STAGING_DB = 'https://zqfbxqszfnrbwpfukwak.supabase.co';
const TABLE = 'mw1_whatsapp_coexistence_oauth_nonces';
const CONSUME_RPC = 'mw1_consume_whatsapp_coexistence_oauth_nonce';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const TTL_MS = 7 * 60 * 1000;

function constantTimeKey(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash('sha256').update(a).digest(),
    createHash('sha256').update(b).digest(),
  );
}

export class StagingWhatsappCoexistenceOAuthHandshakeService {
  constructor(private readonly supabase: SupabaseService) {}

  private async authorizedActor(input: WhatsappCoexistenceOAuthActorRequest)
      : Promise<CoexistencePilotActor> {
    if (process.env.MW1_STAGING_MODE !== 'true' ||
        process.env.SUPABASE_URL?.trim().replace(/\/$/, '') !== STAGING_DB) {
      throw new Error('WhatsApp coexistencia solo se prepara en staging.');
    }
    const expected = process.env.CHATPRO_INBOX_KEY?.trim() || '';
    const supplied = typeof input?.internalKey === 'string' ? input.internalKey : '';
    if (!expected || !supplied || !constantTimeKey(expected, supplied)) {
      throw new Error('Autorización interna no válida.');
    }
    if (input.companySlug !== PILOT ||
        typeof input.companyId !== 'string' || !UUID.test(input.companyId) ||
        typeof input.userId !== 'string' || !UUID.test(input.userId)) {
      throw new Error('La autorización no corresponde al piloto.');
    }
    try {
      const db = this.supabase.getClient();
      const { data: company, error: companyError } = await db.from('companies')
        .select('id,slug,status').eq('id',input.companyId)
        .eq('slug',PILOT).maybeSingle();
      if (companyError || !company || company.id !== input.companyId ||
          company.slug !== PILOT || company.status !== 'active') {
        throw new Error('Empresa no autorizada.');
      }
      const { data: membership, error: memberError } = await db
        .from('company_memberships').select('role_id,active')
        .eq('company_id',company.id).eq('user_id',input.userId)
        .eq('active',true).maybeSingle();
      if (memberError || !membership || membership.active !== true ||
          typeof membership.role_id !== 'string') {
        throw new Error('Usuario no autorizado.');
      }
      const { data: role, error: roleError } = await db.from('app_roles')
        .select('key,company_id').eq('id',membership.role_id).maybeSingle();
      if (roleError || !role ||
          (role.key !== 'owner' && role.key !== 'admin') ||
          (role.company_id && role.company_id !== company.id)) {
        throw new Error('Rol no autorizado.');
      }
    } catch {
      // No user information or underlying database details are returned.
      throw new Error('No se pudo verificar la autorización del piloto.');
    }
    return {
      companyId: input.companyId,
      userId: input.userId,
      companySlug: PILOT,
    };
  }

  async issue(input: WhatsappCoexistenceOAuthActorRequest)
      : Promise<WhatsappCoexistenceOAuthIssued> {
    const actor = await this.authorizedActor(input);
    const signed = issueWhatsappCoexistenceSignedState(actor);
    if (!signed || !HASH.test(signed.stateHash)) {
      throw new Error('Firma OAuth de WhatsApp no configurada para staging.');
    }
    try {
      const { error } = await this.supabase.getClient().from(TABLE).insert({
        state_hash: signed.stateHash,
        company_id: actor.companyId,
        user_id: actor.userId,
        onboarding_id: signed.onboardingId,
        signup_mode: 'coexistence',
        expires_at: new Date(Date.now() + TTL_MS).toISOString(),
      });
      if (error) throw new Error('refused');
    } catch {
      throw new Error('No se pudo registrar la autorización de WhatsApp.');
    }
    // State is returned only to the FUTURE trusted server-side route; it
    // must bind a separate HttpOnly cookie. Never persist raw state.
    return { signedState: signed.state, onboardingId: signed.onboardingId };
  }

  async consume(
    input: WhatsappCoexistenceOAuthActorRequest,
    signedState: string,
    trustedCookieState: string,
  ): Promise<WhatsappCoexistenceOAuthConsumed> {
    // Signature and cookie checks are performed before DB membership lookup.
    const parsed = verifyWhatsappCoexistenceSignedState(
      { companySlug: input?.companySlug, companyId: input?.companyId,
        userId: input?.userId },
      signedState, trustedCookieState,
    );
    if (!parsed) {
      throw new Error('Estado OAuth de WhatsApp inválido o vencido.');
    }
    const actor = await this.authorizedActor(input);
    try {
      // Atomic one-time consumption in staging Postgres; a replay, different
      // user, different company, onboarding ID or expired state returns false.
      const {data,error} = await this.supabase.getClient().rpc(CONSUME_RPC,{
        p_state_hash: parsed.stateHash,
        p_company_id: actor.companyId,
        p_user_id: actor.userId,
        p_onboarding_id: parsed.onboardingId,
      });
      if (error || data !== true) throw new Error('refused');
    } catch {
      throw new Error('La autorización de WhatsApp venció, ya fue utilizada o no corresponde a la sesión.');
    }
    // Consumption does NOT prove Meta ownership, grant permissions or consent.
    return { onboardingId: parsed.onboardingId };
  }
}
