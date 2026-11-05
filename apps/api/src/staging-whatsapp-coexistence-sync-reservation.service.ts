import { createHash, timingSafeEqual } from 'node:crypto';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from './supabase.service';

/**
 * SERVER-ONLY staging adapter for the atomic one-time coexistence sync
 * reservation. NOT registered with AppModule or any HTTP route.
 *
 * Prerequisites for a future caller:
 * - authenticate tenant membership and owner/admin authorization
 * - obtain onboarding ID/time from a verified, ACTIVE integration record
 * - collect explicit informed consent for EACH requested sync kind
 * - verify Meta ownership and webhook configuration for the selected phone.
 *
 * The staging-only database RPC independently validates those facts against
 * the company's records before atomically inserting the reservation.
 * This adapter does not invoke Meta, ingest history, or subscribe webhooks.
 */
export type WhatsappCoexistenceSyncReservationRequest = {
  internalKey: string;
  companySlug: string;
  companyId: string;
  userId: string;
  onboardingId: string;
  phoneNumberId: string;
  syncKind: 'history' | 'smb_app_state_sync';
  onboardedAt: string;
  consentGranted: boolean;
};

const RPC = 'mw1_reserve_whatsapp_coexistence_sync';
const STAGING_DB = 'https://zqfbxqszfnrbwpfukwak.supabase.co';
const PILOT = 'piloto-mw1-prueba';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHONE_ID = /^[0-9]{6,30}$/;

export class StagingWhatsappCoexistenceSyncReservationService {
  constructor(private readonly supabase: SupabaseService) {}

  async reserve(request: WhatsappCoexistenceSyncReservationRequest): Promise<void> {
    if (process.env.MW1_STAGING_MODE !== 'true' ||
        process.env.SUPABASE_URL?.trim().replace(/\/$/, '') !== STAGING_DB) {
      throw new ForbiddenException('La sincronización solo se prepara en MW1 staging.');
    }

    const expected = process.env.CHATPRO_INBOX_KEY?.trim();
    const received = typeof request?.internalKey === 'string' ? request.internalKey : '';
    if (!expected || !received ||
        !timingSafeEqual(
          createHash('sha256').update(expected).digest(),
          createHash('sha256').update(received).digest(),
        )) {
      throw new UnauthorizedException('Servicio interno no autorizado.');
    }

    if (request.companySlug !== PILOT ||
        typeof request.companyId !== 'string' || !UUID.test(request.companyId) ||
        typeof request.userId !== 'string' || !UUID.test(request.userId) ||
        typeof request.onboardingId !== 'string' || !UUID.test(request.onboardingId) ||
        typeof request.phoneNumberId !== 'string' || !PHONE_ID.test(request.phoneNumberId) ||
        (request.syncKind !== 'history' && request.syncKind !== 'smb_app_state_sync') ||
        request.consentGranted !== true ||
        typeof request.onboardedAt !== 'string' ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(request.onboardedAt) ||
        !Number.isFinite(Date.parse(request.onboardedAt))) {
      throw new ForbiddenException('Autorización y consentimiento de sincronización incompletos.');
    }

    // Consent timestamp comes from the trusted server at the time of this call,
    // never from a browser body. PostgreSQL rechecks its recency.
    const { data, error } = await this.supabase.getClient().rpc(RPC, {
      p_company_id: request.companyId,
      p_user_id: request.userId,
      p_onboarding_id: request.onboardingId,
      p_phone_number_id: request.phoneNumberId,
      p_sync_kind: request.syncKind,
      p_onboarded_at: request.onboardedAt,
      p_consented_at: new Date().toISOString(),
    });

    if (error || data !== true) {
      // Fail closed on duplicate, expired consent, mismatched tenant/phone,
      // missing active integration or storage errors. Never return DB details.
      throw new ForbiddenException(
        'No se pudo reservar la sincronización: no autorizada, vencida o ya solicitada.',
      );
    }
  }
}
