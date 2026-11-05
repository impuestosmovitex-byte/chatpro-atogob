import { createHmac } from 'node:crypto';
import { StagingMessengerOAuthVerifiedFlow } from './staging-messenger-oauth-verified-flow';
import { messengerStateHashIfValid } from './staging-messenger-oauth-signed-state';

describe('MW1 Messenger signed state + authorization + atomic nonce contract', () => {
  const companyId = '11111111-1111-4111-8111-111111111111';
  const userId = '22222222-2222-4222-8222-222222222222';
  const request = {
    internalKey: 'fake-internal-service-key',
    companyId, userId, companySlug: 'piloto-mw1-prueba',
  };
  const oldKey = process.env.MW1_MESSENGER_OAUTH_STATE_SECRET;
  const oldNow = Date.now;
  const now = 1800000000000;
  const secret = 'OFFLINE_MW1_MESSENGER_STATE_SECRET_SAFETY_TEST';
  const register = jest.fn();
  const consume = jest.fn();
  let flow: StagingMessengerOAuthVerifiedFlow;

  const makeState = (data: Record<string, unknown> = {}) => {
    const payload = {
      v: 1, provider: 'messenger', companyId, userId,
      nonce: 'x'.repeat(32), issuedAt: now, ...data,
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return encoded + '.' + createHmac('sha256', secret)
      .update(encoded).digest('base64url');
  };

  beforeEach(() => {
    Date.now = () => now;
    process.env.MW1_MESSENGER_OAUTH_STATE_SECRET = secret;
    register.mockReset().mockResolvedValue(undefined);
    consume.mockReset().mockResolvedValue(undefined);
    flow = new StagingMessengerOAuthVerifiedFlow({ register, consume });
  });

  afterAll(() => {
    Date.now = oldNow;
    if (oldKey === undefined) delete process.env.MW1_MESSENGER_OAUTH_STATE_SECRET;
    else process.env.MW1_MESSENGER_OAUTH_STATE_SECRET = oldKey;
  });

  it('validates signed state and sends only its SHA-256 hash to the authorized nonce barrier', async () => {
    const state = makeState();
    await flow.registerSignedState(request, state);
    const hash = messengerStateHashIfValid(state, request);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(register).toHaveBeenCalledWith(request, hash);
    expect(register.mock.calls[0][1]).not.toContain(state);
    expect(consume).not.toHaveBeenCalled();
  });

  it('requires matching trusted callback cookie before one-time consumption', async () => {
    const state = makeState();
    await flow.consumeSignedState(request, state, state);
    expect(consume).toHaveBeenCalledWith(request, messengerStateHashIfValid(state, request));
    await expect(flow.consumeSignedState(request, state, 'wrong-cookie'))
      .rejects.toThrow(/inválido/);
    expect(consume).toHaveBeenCalledTimes(1);
  });

  it('does not consume a replay when the authorized nonce barrier rejects it', async () => {
    const state = makeState();
    consume.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('already used'));
    await flow.consumeSignedState(request, state, state);
    await expect(flow.consumeSignedState(request, state, state))
      .rejects.toThrow(/already used/);
    expect(consume).toHaveBeenCalledTimes(2);
    // In production, the atomic PostgreSQL RPC enforces one-time consumption.
  });

  it.each([
    ['other company', { ...request, companyId: '33333333-3333-4333-8333-333333333333' }, makeState()],
    ['other user', { ...request, userId: '44444444-4444-4444-8444-444444444444' }, makeState()],
    ['other slug', { ...request, companySlug: 'atogob' }, makeState()],
    ['tampered state', request, makeState().replace(/.$/, 'a')],
    ['wrong provider', request, makeState({ provider: 'instagram' })],
    ['invalid nonce', request, makeState({ nonce: 'bad' })],
    ['future state', request, makeState({ issuedAt: now + 1 })],
    ['malformed state', request, 'bad.state'],
  ])('denies %s before touching the nonce barrier', async (_case, identity, state) => {
    await expect(flow.registerSignedState(identity, state)).rejects.toThrow();
    await expect(flow.consumeSignedState(identity, state, state)).rejects.toThrow();
    expect(register).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
  });

  it('denies expired state before touching the nonce barrier', async () => {
    const expired = makeState({ issuedAt: now - 10 * 60 * 1000 - 1 });
    await expect(flow.consumeSignedState(request, expired, expired)).rejects.toThrow();
    expect(consume).not.toHaveBeenCalled();
  });

  it('fails closed if the separate OAuth signing secret is absent', async () => {
    const state = makeState();
    delete process.env.MW1_MESSENGER_OAUTH_STATE_SECRET;
    await expect(flow.registerSignedState(request, state)).rejects.toThrow();
    expect(register).not.toHaveBeenCalled();
  });

  it('propagates tenant revocation or database refusal from the membership barrier', async () => {
    const state = makeState();
    register.mockRejectedValueOnce(new Error('inactive membership'));
    await expect(flow.registerSignedState(request, state)).rejects.toThrow('inactive membership');
    expect(register).toHaveBeenCalledTimes(1);
  });
});
