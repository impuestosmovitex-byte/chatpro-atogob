import { SupabaseService } from './supabase.service';
import {
  StagingMessengerOAuthNonceStore,
  type VerifiedMessengerPilotActor,
} from './staging-messenger-oauth-nonce-store';

describe('MW1 Messenger nonce adapter (isolated staging, mocked Supabase)', () => {
  const actor: VerifiedMessengerPilotActor = {
    companyId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    companySlug: 'piloto-mw1-prueba',
    canManageIntegrations: true,
  };
  const hash = 'a'.repeat(64);
  const tableInsert = jest.fn();
  const from = jest.fn();
  const rpc = jest.fn();
  const getClient = jest.fn();
  const oldNow = Date.now;
  const now = 1800000000000;
  let store: StagingMessengerOAuthNonceStore;

  beforeEach(() => {
    Date.now = () => now;
    tableInsert.mockReset().mockResolvedValue({ error: null });
    from.mockReset().mockReturnValue({ insert: tableInsert });
    rpc.mockReset().mockResolvedValue({ data: true, error: null });
    getClient.mockReset().mockReturnValue({ from, rpc });
    store = new StagingMessengerOAuthNonceStore({
      getClient,
    } as unknown as SupabaseService);
  });

  afterAll(() => {
    Date.now = oldNow;
  });

  it('registers only hashed state with a server-calculated nine-minute expiry', async () => {
    await store.register(actor, hash);
    expect(from).toHaveBeenCalledWith('mw1_messenger_oauth_nonces');
    expect(tableInsert).toHaveBeenCalledTimes(1);
    expect(tableInsert).toHaveBeenCalledWith({
      nonce_hash: hash,
      company_id: actor.companyId,
      user_id: actor.userId,
      expires_at: new Date(now + 9 * 60 * 1000).toISOString(),
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('atomically consumes only the matching hash, company and user', async () => {
    await store.consume(actor, hash);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('mw1_consume_messenger_oauth_nonce', {
      p_nonce_hash: hash,
      p_company_id: actor.companyId,
      p_user_id: actor.userId,
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('rejects replay and expired nonces when the SQL function returns false', async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(store.consume(actor, hash)).rejects.toThrow(/ya se utilizó, venció/);
  });

  it('fails closed on RPC errors and unexpected return values', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'internal fake error' } });
    await expect(store.consume(actor, hash)).rejects.toThrow(/ya se utilizó, venció/);
    rpc.mockResolvedValueOnce({ data: 'true', error: null });
    await expect(store.consume(actor, hash)).rejects.toThrow(/ya se utilizó, venció/);
  });

  it('fails closed when Supabase refuses registration', async () => {
    tableInsert.mockResolvedValueOnce({ error: { message: 'synthetic db failure' } });
    await expect(store.register(actor, hash)).rejects.toThrow(/No se pudo registrar/);
  });

  it.each([
    ['unauthorized role', { canManageIntegrations: false }, hash],
    ['wrong tenant', { companySlug: 'atogob' }, hash],
    ['missing company', { companyId: '' }, hash],
    ['bad company ID', { companyId: 'not-a-uuid' }, hash],
    ['missing user', { userId: '' }, hash],
    ['bad user ID', { userId: 'user' }, hash],
    ['uppercase hash', {}, 'A'.repeat(64)],
    ['short nonce hash', {}, 'short'],
    ['raw OAuth state', {}, 'signed.state'],
  ])('rejects %s before accessing the database', async (_label, overrides, supplied) => {
    const invalid = { ...actor, ...overrides };
    await expect(store.register(invalid, supplied)).rejects.toThrow();
    await expect(store.consume(invalid, supplied)).rejects.toThrow();
    expect(getClient).not.toHaveBeenCalled();
  });

  it('does not contain Meta token-exchange or messaging operations', () => {
    expect(store).not.toHaveProperty('exchangeMetaCode');
    expect(store).not.toHaveProperty('enableMessaging');
    expect(store).not.toHaveProperty('subscribeWebhooks');
  });
});
