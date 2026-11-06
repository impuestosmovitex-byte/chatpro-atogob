import { SupabaseService } from './supabase.service';
import {
  StagingWhatsappCoexistenceSyncReservationService,
  type WhatsappCoexistenceSyncReservationRequest,
} from './staging-whatsapp-coexistence-sync-reservation.service';

describe('MW1 pilot WhatsApp coexistence sync reservation adapter (offline)', () => {
  const request: WhatsappCoexistenceSyncReservationRequest = {
    internalKey: 'synthetic-staging-internal-secret',
    companySlug: 'piloto-mw1-prueba',
    companyId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    onboardingId: '33333333-3333-4333-8333-333333333333',
    phoneNumberId: '123456789012345',
    syncKind: 'history',
    onboardedAt: '2026-11-05T12:00:00.000Z',
    consentGranted: true,
  };
  const env = ['MW1_STAGING_MODE', 'SUPABASE_URL', 'CHATPRO_INBOX_KEY'] as const;
  const original = new Map<string, string | undefined>();
  const rpc = jest.fn();
  const getClient = jest.fn();
  let service: StagingWhatsappCoexistenceSyncReservationService;

  beforeAll(() => {
    for (const k of env) original.set(k, process.env[k]);
  });

  beforeEach(() => {
    process.env.MW1_STAGING_MODE = 'true';
    process.env.SUPABASE_URL = 'https://zqfbxqszfnrbwpfukwak.supabase.co';
    process.env.CHATPRO_INBOX_KEY = request.internalKey;
    rpc.mockReset().mockResolvedValue({ data: true, error: null });
    getClient.mockReset().mockReturnValue({ rpc });
    service = new StagingWhatsappCoexistenceSyncReservationService({
      getClient,
    } as unknown as SupabaseService);
  });

  afterAll(() => {
    for (const [key, val] of original) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it('sends only validated pilot identifiers and a server-generated consent timestamp', async () => {
    await service.reserve(request);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('mw1_reserve_whatsapp_coexistence_sync',
      expect.objectContaining({
        p_company_id: request.companyId,
        p_user_id: request.userId,
        p_onboarding_id: request.onboardingId,
        p_phone_number_id: request.phoneNumberId,
        p_sync_kind: 'history',
        p_onboarded_at: request.onboardedAt,
        p_consented_at: expect.any(String),
      }),
    );
    expect(Number.isFinite(Date.parse(rpc.mock.calls[0][1].p_consented_at))).toBe(true);
  });

  it('passes contacts sync as a distinct reservation type', async () => {
    await service.reserve({ ...request, syncKind: 'smb_app_state_sync' });
    expect(rpc.mock.calls[0][1].p_sync_kind).toBe('smb_app_state_sync');
  });

  it.each([
    [{ consentGranted: false }, 'no consent'],
    [{ companySlug: 'atogob' }, 'different business'],
    [{ companyId: 'invalid' }, 'invalid tenant id'],
    [{ userId: 'invalid' }, 'invalid user id'],
    [{ onboardingId: 'invalid' }, 'invalid onboarding id'],
    [{ phoneNumberId: '+573005555555' }, 'unverified phone id'],
    [{ syncKind: 'other' as 'history' }, 'unapproved sync type'],
    [{ onboardedAt: 'yesterday' }, 'unverified onboarding time'],
    [{ internalKey: 'wrong' }, 'bad internal key'],
  ])('rejects %s before contacting the database (%s)', async (change) => {
    await expect(service.reserve({ ...request, ...change })).rejects.toThrow();
    expect(getClient).not.toHaveBeenCalled();
  });

  it('never calls the DB if staging mode or target project is incorrect', async () => {
    process.env.MW1_STAGING_MODE = 'false';
    await expect(service.reserve(request)).rejects.toThrow(/staging/);
    process.env.MW1_STAGING_MODE = 'true';
    process.env.SUPABASE_URL = 'https://ynmwgerlfidwsihmzgkw.supabase.co';
    await expect(service.reserve(request)).rejects.toThrow(/staging/);
    expect(getClient).not.toHaveBeenCalled();
  });

  it('fails closed on duplicate reservation and database errors', async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(service.reserve(request)).rejects.toThrow(/ya solicitada/);
    rpc.mockResolvedValueOnce({ data: 'true', error: null });
    await expect(service.reserve(request)).rejects.toThrow(/ya solicitada/);
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'private-db-error' } });
    await expect(service.reserve(request)).rejects.toThrow(/ya solicitada/);
  });

  it('has no Meta calls or webhook / import actions', () => {
    expect(service).not.toHaveProperty('fetchHistory');
    expect(service).not.toHaveProperty('subscribeWebhook');
    expect(service).not.toHaveProperty('activateNumber');
  });
});
