import {
  MESSENGER_PILOT_REQUIRED_SCOPES,
  MessengerPilotEvidence,
  preparePendingMessengerPilotRecord,
} from './staging-messenger-authorization-policy';

describe('MW1 server-only Messenger pilot record contract (offline, no routes enabled)', () => {
  const token = 'synthetic_page_access_token_never_sent_to_browser_12345';
  const encryption = jest.fn(() => 'v1.synthetic-iv.synthetic-tag.synthetic-ciphertext');
  const valid = (): MessengerPilotEvidence => ({
    companyId: 'isolated-company-id',
    sessionCompanyId: 'isolated-company-id',
    companySlug: 'piloto-mw1-prueba',
    isAuthorizedAdmin: true,
    selectedPageId: '123456789012345',
    verifiedPages: [
      { id: '123456789012345', name: 'Página piloto MW1' },
      { id: '123456789012346', name: 'Página secundaria' },
    ],
    verifiedGrantedScopes: [...MESSENGER_PILOT_REQUIRED_SCOPES],
    verifiedPageAccessToken: token,
    pageAlreadyAssigned: false,
  });

  beforeEach(() => encryption.mockClear());

  it('produces only an encrypted pending record, never a live messaging connection', () => {
    const row = preparePendingMessengerPilotRecord(valid(), encryption);
    expect(row).toMatchObject({
      company_id: 'isolated-company-id',
      provider: 'meta',
      integration_type: 'messenger',
      external_id: '123456789012345',
      status: 'pending',
      credential_mode: 'encrypted',
      config: {
        page_name: 'Página piloto MW1',
        webhooks_subscribed: false,
        messaging_enabled: false,
      },
    });
    expect(encryption).toHaveBeenCalledWith({ access_token: token });
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row).not.toHaveProperty('access_token');
    expect(row).not.toHaveProperty('connectionEnabled');
  });

  it.each([
    ['missing scopes', { verifiedGrantedScopes: ['pages_show_list'] }],
    ['mismatched tenant', { sessionCompanyId: 'another-company' }],
    ['not admin', { isAuthorizedAdmin: false }],
    ['wrong pilot slug', { companySlug: 'atogob' }],
    ['unknown Page', { selectedPageId: '123456789000000' }],
    ['invalid Page identifier', { selectedPageId: 'not-a-page' }],
    ['Page already assigned', { pageAlreadyAssigned: true }],
    ['invalid Page token', { verifiedPageAccessToken: 'short' }],
    ['duplicate Pages', { verifiedPages: [
      { id: '123456789012345', name: 'Uno' },
      { id: '123456789012345', name: 'Dos' },
    ] }],
    ['empty Page name', { verifiedPages: [{ id: '123456789012345', name: '' }] }],
  ])('rejects %s before encryption', (_label, override) => {
    expect(() => preparePendingMessengerPilotRecord({
      ...valid(), ...override,
    } as MessengerPilotEvidence, encryption)).toThrow();
    expect(encryption).not.toHaveBeenCalled();
  });

  it('rejects a fake encryption result that exposes the plaintext token', () => {
    expect(() => preparePendingMessengerPilotRecord(valid(), () => token))
      .toThrow(/proteger/);
  });

  it('does not perform any network or database writes during policy checks', () => {
    const row = preparePendingMessengerPilotRecord(valid(), encryption);
    expect(row.status).toBe('pending');
    expect(row.config.webhooks_subscribed).toBe(false);
    // This helper is pure: no fetch, RPC, DB client or webhook subscription.
  });
});
