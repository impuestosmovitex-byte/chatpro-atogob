import { MetaSocialMessagingService } from './meta-social-messaging.service';

function fixture(options: { saveError?: string; updateError?: string; metaOk?: boolean; expired?: boolean } = {}) {
  const row = (table: string) => {
    if (table === 'social_conversation_sessions') {
      return { id: 'session-a', company_id: 'company-a', channel: 'instagram',
        external_customer_id: 'ig-customer', attention_status: 'human' };
    }
    return { external_id: 'ig-business', credentials_encrypted: 'encrypted',
      config: { setup_source: 'instagram_login', api_version: 'v25.0' } };
  };
  const filtered = (table: string): any => ({
    eq: () => filtered(table),
    maybeSingle: async () => ({ data: row(table), error: null }),
  });
  const client = {
    from: jest.fn((table: string) => ({
      select: () => filtered(table),
      insert: async () => ({ error: options.saveError ? { message: options.saveError } : null }),
      update: () => ({
        eq: () => ({
          eq: async () => ({
            error: options.updateError ? { message: options.updateError } : null,
          }),
        }),
      }),
    })),
  };
  const service = Object.create(MetaSocialMessagingService.prototype) as any;
  service.supabaseService = { getClient: () => client };
  service.credentialsService = { decrypt: () => ({ access_token: 'fake-token' }) };
  const fetchMock = jest.fn(async () => ({
    ok: options.metaOk !== false,
    status: options.metaOk === false ? 403 : 200,
    text: async () => options.metaOk === false
      ? JSON.stringify({ error: { message: options.expired ? 'Error validating access token: Session has expired' : 'permission denied', code: options.expired ? 190 : 10 } })
      : JSON.stringify({ message_id: 'ig-mid-123' }),
  }));
  const oldFetch = global.fetch;
  global.fetch = fetchMock as unknown as typeof fetch;
  return {
    service,
    client,
    fetchMock,
    restore: () => { global.fetch = oldFetch; },
    send: () => service.sendAdvisorText({
      companyId: 'company-a', sessionId: 'session-a',
      message: 'Hola, ¿qué talla necesitas?', advisorName: 'Asesor',
    }),
  };
}

describe('Instagram outbound: provider acknowledgement vs local persistence', () => {
  it('records successful Meta delivery and returns provider ID', async () => {
    const t = fixture();
    try {
      await expect(t.send()).resolves.toEqual({ messageId: 'ig-mid-123' });
      expect(t.fetchMock).toHaveBeenCalledTimes(1);
    } finally { t.restore(); }
  });

  it('does not ask user to retry after Meta accepted but database insert failed', async () => {
    const t = fixture({ saveError: 'database unavailable' });
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const result = await t.send();
      expect(result.messageId).toBe('ig-mid-123');
      expect(result.persistenceWarning).toContain('Meta aceptó');
      expect(t.fetchMock).toHaveBeenCalledTimes(1);
    } finally { log.mockRestore(); t.restore(); }
  });

  it('returns a warning rather than a failed send if session refresh write fails', async () => {
    const t = fixture({ updateError: 'write failed' });
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const result = await t.send();
      expect(result.messageId).toBe('ig-mid-123');
      expect(result.persistenceWarning).toContain('Meta aceptó');
    } finally { log.mockRestore(); t.restore(); }
  });

  it('explains expired Instagram authorization without attempting a resend', async () => {
    const t = fixture({ metaOk: false, expired: true });
    try {
      await expect(t.send()).rejects.toThrow('Reconectar Instagram');
      expect(t.fetchMock).toHaveBeenCalledTimes(1);
    } finally { t.restore(); }
  });

  it('still rejects when Meta itself rejects the send', async () => {
    const t = fixture({ metaOk: false });
    try {
      await expect(t.send()).rejects.toThrow('Meta Instagram rechazó el mensaje');
    } finally { t.restore(); }
  });
});
