import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SupabaseService } from './supabase.service';

/**
 * Server-only staging storage adapter for Messenger OAuth nonces.
 *
 * Deliberately NOT registered in AppModule and NOT exposed from a controller.
 * The legacy Messenger routes must remain disabled. A future staging-only
 * orchestration endpoint must independently verify membership, user role and
 * signed OAuth state BEFORE calling this adapter.
 *
 * Only a SHA-256 hash reaches the database; never the raw signed state,
 * Meta authorization code or a Meta access token.
 */
export type VerifiedMessengerPilotActor = {
  companyId: string;
  userId: string;
  companySlug: string;
  canManageIntegrations: boolean;
};

const TABLE = 'mw1_messenger_oauth_nonces';
const CONSUME_RPC = 'mw1_consume_messenger_oauth_nonce';
const PILOT_SLUG = 'piloto-mw1-prueba';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;

function validate(actor: VerifiedMessengerPilotActor, nonceHash: string): void {
  if (!actor || !actor.canManageIntegrations ||
      actor.companySlug !== PILOT_SLUG ||
      typeof actor.companyId !== 'string' || !UUID.test(actor.companyId) ||
      typeof actor.userId !== 'string' || !UUID.test(actor.userId)) {
    throw new ForbiddenException('No tienes autorización para el piloto de Messenger.');
  }
  if (typeof nonceHash !== 'string' || !HASH.test(nonceHash)) {
    throw new BadRequestException('Estado OAuth de Messenger no válido.');
  }
}

export class StagingMessengerOAuthNonceStore {
  constructor(private readonly supabase: SupabaseService) {}

  async register(
    actor: VerifiedMessengerPilotActor,
    nonceHash: string,
  ): Promise<void> {
    validate(actor, nonceHash);
    // Nine minutes leaves room for clock skew at the database while
    // respecting its ten-minute maximum. Expiry is never client-supplied.
    const expiresAt = new Date(Date.now() + 9 * 60 * 1000).toISOString();
    const { error } = await this.supabase.getClient()
      .from(TABLE)
      .insert({
        nonce_hash: nonceHash,
        company_id: actor.companyId,
        user_id: actor.userId,
        expires_at: expiresAt,
      });
    if (error) {
      // Do not expose DB error details or the nonce to API clients or logs.
      throw new ForbiddenException('No se pudo registrar la autorización de Messenger.');
    }
  }

  async consume(
    actor: VerifiedMessengerPilotActor,
    nonceHash: string,
  ): Promise<void> {
    validate(actor, nonceHash);
    // Atomic UPDATE ... WHERE consumed_at IS NULL AND expires_at > now().
    // Returns true only once, for the matching company and user.
    const { data, error } = await this.supabase.getClient()
      .rpc(CONSUME_RPC, {
        p_nonce_hash: nonceHash,
        p_company_id: actor.companyId,
        p_user_id: actor.userId,
      });
    if (error || data !== true) {
      throw new ForbiddenException(
        'La autorización de Messenger ya se utilizó, venció o no corresponde a la sesión.',
      );
    }
  }
}
