import { createHash, timingSafeEqual } from 'node:crypto';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from './supabase.service';
import { StagingMessengerOAuthNonceStore } from './staging-messenger-oauth-nonce-store';

/**
 * Unregistered, server-only pilot authorization barrier.
 *
 * It validates the internal service key, the STAGING database identity and a
 * fresh company membership/role lookup before using the nonce adapter.
 * This is NOT an OAuth endpoint and MUST NOT be wired to an unreviewed route.
 * In a future route, the web server must authenticate the user's session and
 * set company/user IDs from that trusted session, not browser payload fields.
 */
export type MessengerNonceRequest = {
  internalKey: string;
  companyId: string;
  companySlug: string;
  userId: string;
};

const STAGING_SUPABASE_URL = 'https://zqfbxqszfnrbwpfukwak.supabase.co';
const PILOT_SLUG = 'piloto-mw1-prueba';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class StagingMessengerOAuthAuthorizedNonceService {
  private readonly store: StagingMessengerOAuthNonceStore;

  constructor(private readonly supabase: SupabaseService) {
    this.store = new StagingMessengerOAuthNonceStore(supabase);
  }

  private async verify(request: MessengerNonceRequest) {
    // Never use the production Supabase project, even if an operator accidentally
    // points an isolated staging API at a different environment.
    if (process.env.SUPABASE_URL?.trim().replace(/\/$/, '') !== STAGING_SUPABASE_URL) {
      throw new ForbiddenException('El piloto de Messenger requiere Supabase staging.');
    }
    const expected = process.env.CHATPRO_INBOX_KEY?.trim();
    const supplied = typeof request?.internalKey === 'string'
      ? request.internalKey : '';
    if (!expected || !supplied) {
      throw new UnauthorizedException('Servicio interno de MW1 no autorizado.');
    }
    const expectedDigest = createHash('sha256').update(expected).digest();
    const suppliedDigest = createHash('sha256').update(supplied).digest();
    if (!timingSafeEqual(expectedDigest, suppliedDigest)) {
      throw new UnauthorizedException('Servicio interno de MW1 no autorizado.');
    }
    if (request.companySlug !== PILOT_SLUG ||
        typeof request.companyId !== 'string' || !UUID.test(request.companyId) ||
        typeof request.userId !== 'string' || !UUID.test(request.userId)) {
      throw new ForbiddenException('Identidad del piloto de Messenger no autorizada.');
    }

    const db = this.supabase.getClient();
    const { data: company, error: companyError } = await db.from('companies')
      .select('id,slug,status')
      .eq('id', request.companyId)
      .eq('slug', PILOT_SLUG)
      .maybeSingle();
    if (companyError || !company || company.id !== request.companyId ||
        company.slug !== PILOT_SLUG || company.status !== 'active') {
      throw new ForbiddenException('Empresa piloto de Messenger no autorizada.');
    }
    const { data: membership, error: membershipError } = await db
      .from('company_memberships')
      .select('role_id,active')
      .eq('company_id', company.id)
      .eq('user_id', request.userId)
      .eq('active', true)
      .maybeSingle();
    if (membershipError || !membership || membership.active !== true ||
        typeof membership.role_id !== 'string') {
      throw new ForbiddenException('El usuario no pertenece a la empresa piloto activa.');
    }
    const { data: role, error: roleError } = await db.from('app_roles')
      .select('key,company_id')
      .eq('id', membership.role_id)
      .maybeSingle();
    if (roleError || !role ||
        (role.key !== 'owner' && role.key !== 'admin') ||
        (role.company_id != null && role.company_id !== company.id)) {
      throw new ForbiddenException('No tienes permisos para integrar Messenger.');
    }
    return {
      companyId: company.id as string,
      userId: request.userId,
      companySlug: PILOT_SLUG,
      canManageIntegrations: true,
    } as const;
  }

  async register(request: MessengerNonceRequest, nonceHash: string): Promise<void> {
    const actor = await this.verify(request);
    await this.store.register(actor, nonceHash);
  }

  async consume(request: MessengerNonceRequest, nonceHash: string): Promise<void> {
    const actor = await this.verify(request);
    await this.store.consume(actor, nonceHash);
  }
}
