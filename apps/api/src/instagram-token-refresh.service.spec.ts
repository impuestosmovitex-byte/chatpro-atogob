import {
  InstagramTokenRefreshService,
  instagramRefreshDue,
} from './instagram-token-refresh.service';

describe('Instagram OAuth renewal is scoped to each company', () => {
  const now = Date.parse('2026-11-27T12:00:00.000Z');

  it('refreshes only valid tokens within the final 14 days', () => {
    const days = (n: number) => new Date(now + n * 86400000).toISOString();
    expect(instagramRefreshDue(days(10), now)).toBe(true);
    expect(instagramRefreshDue(days(45), now)).toBe(false);
    expect(instagramRefreshDue(days(-1), now)).toBe(false);
    expect(instagramRefreshDue(null, now)).toBe(false);
    expect(instagramRefreshDue('bad-date', now)).toBe(false);
  });

  it('never calls Meta when the authorization has already expired', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const limit = jest.fn(async () => ({
      data: [{
        id: 'row-a', company_id: 'company-a', external_id: '123',
        credentials_encrypted: 'old-encrypted',
        config: {
          setup_source: 'instagram_login',
          token_expires_at: '2026-11-26T10:00:00Z',
        },
      }],
      error: null,
    }));
    const eq = jest.fn(() => ({ eq, limit }));
    const client = { from: jest.fn(() => ({ select: () => ({ eq }) })) };
    const credentials = { decrypt: jest.fn(), encrypt: jest.fn() };
    const service = new InstagramTokenRefreshService(
      { getClient: () => client } as any, credentials as any,
    );
    try {
      await service.refreshExpiringInstagramTokens();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(credentials.decrypt).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('persists a refreshed token only for its original company and old credential', async () => {
    const due = new Date(Date.now() + 7 * 86400000).toISOString();
    const rows = [{
      id: 'row-a', company_id: 'company-a', external_id: '123456',
      credentials_encrypted: 'old-encrypted',
      config: { setup_source: 'instagram_login', token_expires_at: due, api_version: 'v25.0' },
    }, {
      id: 'row-b', company_id: 'company-b', external_id: '987654',
      credentials_encrypted: 'other-encrypted',
      config: {
        setup_source: 'instagram_login',
        token_expires_at: new Date(Date.now() + 45 * 86400000).toISOString(),
      },
    }];

    const updateEq = jest.fn();
    const updateChain: any = {
      eq: (...args: unknown[]) => {
        updateEq(...args);
        return updateChain;
      },
      select: async () => ({ data: [{ id: 'row-a' }], error: null }),
    };
    const update = jest.fn(() => updateChain);
    const listChain: any = {
      eq: () => listChain,
      limit: async () => ({ data: rows, error: null }),
    };
    const client = { from: jest.fn(() => ({
      select: () => listChain,
      update,
    })) };
    const credentials = {
      decrypt: jest.fn(() => ({ access_token: 'old-credential' })),
      encrypt: jest.fn(() => 'new-encrypted'),
    };
    const service = new InstagramTokenRefreshService(
      { getClient: () => client } as any, credentials as any,
    );
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'new-credential', expires_in: 5184000 }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user_id: '123456' }),
      } as Response);
    try {
      await service.refreshExpiringInstagramTokens();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(credentials.decrypt).toHaveBeenCalledTimes(1);
      expect(updateEq).toHaveBeenCalledWith('company_id', 'company-a');
      expect(updateEq).toHaveBeenCalledWith('credentials_encrypted', 'old-encrypted');
      expect(updateEq).toHaveBeenCalledWith('status', 'active');
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ credentials_encrypted: 'new-encrypted' }),
      );
    } finally {
      fetchMock.mockRestore();
    }
  });
});
