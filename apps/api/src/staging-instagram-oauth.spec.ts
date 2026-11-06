import { StagingIntegrationsController } from './staging-integrations.controller';
import { SupabaseService } from './supabase.service';
import { IntegrationCredentialsService } from './integration-credentials.service';

describe('Instagram Unified Login pilot is fail-closed by default', () => {
  const pilotCompany = 'pilot-company-id';
  const pilotOwner = 'pilot-owner-id';
  const internalKey = 'mock-internal-staging-inbox-key';
  const variables = [
    'CHATPRO_INBOX_KEY',
    'MW1_STAGING_INSTAGRAM_ONBOARDING_ENABLED',
    'MW1_STAGING_INSTAGRAM_OAUTH_ENABLED',
    'MW1_STAGING_INSTAGRAM_LOGIN_UI_ENABLED',
    'MW1_STAGING_INSTAGRAM_TOKEN_EXCHANGE_ENABLED',
  ] as const;
  const originals = new Map<string, string | undefined>();
  let controller: StagingIntegrationsController;
  let writes = 0;
  let calls: string[];
  let originalFetch: typeof fetch;

  beforeAll(() => {
    for (const name of variables) originals.set(name, process.env[name]);
  });

  beforeEach(() => {
    process.env.CHATPRO_INBOX_KEY = internalKey;
    for (const name of variables.slice(1)) delete process.env[name];
    originalFetch = global.fetch;
    calls = [];
    writes = 0;
    global.fetch = (async () => {
      throw new Error('The disabled Instagram pilot must not contact Meta');
    }) as typeof fetch;

    const rows: Record<string, Record<string, unknown>> = {
      companies: {
        id: pilotCompany,
        name: 'MW1 piloto',
        slug: 'piloto-mw1-prueba',
        status: 'active',
      },
      company_memberships: {
        company_id: pilotCompany,
        user_id: pilotOwner,
        role_id: 'owner-role',
        active: true,
      },
      app_roles: { id: 'owner-role', key: 'owner', company_id: null },
    };
    const db = {
      from: (table: string) => {
        calls.push(table);
        const filters: Record<string, unknown> = {};
        const query = {
          select: (_fields: string) => query,
          eq: (field: string, value: unknown) => {
            filters[field] = value;
            return query;
          },
          order: (_field: string, _opts: { ascending: boolean }) => query,
          maybeSingle: async () => {
            const row = rows[table];
            return {
              data: row && Object.entries(filters).every(([k, v]) => row[k] === v)
                ? row : null,
              error: null,
            };
          },
          limit: async () => ({
            data: rows[table] && Object.entries(filters).every(([k, v]) => rows[table][k] === v)
              ? [rows[table]] : [],
            error: null,
          }),
          insert: async () => {
            writes++;
            return { error: null };
          },
        };
        return query;
      },
    };
    const encryption = {
      encrypt: () => {
        writes++;
        return 'encrypted-only';
      },
    };
    controller = new StagingIntegrationsController(
      { getClient: () => db } as unknown as SupabaseService,
      encryption as unknown as IntegrationCredentialsService,
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  afterAll(() => {
    for (const [name, value] of originals) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('never advertises active Instagram connection or webhooks', async () => {
    const result = await controller.instagramConfig(
      internalKey, pilotOwner, pilotCompany, 'piloto-mw1-prueba',
    );
    expect(result.ok).toBe(true);
    expect(result.ready).toBe(false);
    expect(result.authorizationEnabled).toBe(false);
    expect(result.connectionEnabled).toBe(false);
    expect(result.webhookEnabled).toBe(false);
    expect(result.appId).toBeNull();
    expect(result.configurationId).toBeNull();
    expect(writes).toBe(0);
  });

  it('rejects an OAuth nonce registration when onboarding is disabled', async () => {
    await expect(controller.registerInstagramOAuth(
      internalKey, pilotOwner, pilotCompany, 'piloto-mw1-prueba',
      { nonceHash: 'a'.repeat(64), expiresAt: new Date(Date.now() + 300000).toISOString() },
    )).rejects.toThrow(/Instagram no habilitado/);
    expect(calls).not.toContain('mw1_instagram_oauth_nonces');
    expect(writes).toBe(0);
  });

  it('rejects code exchange before nonce consumption or any Meta request', async () => {
    await expect(controller.exchangeInstagramCode(
      internalKey, pilotOwner, pilotCompany, 'piloto-mw1-prueba',
      {
        code: 'fixture-authorization-code-only',
        nonceHash: 'a'.repeat(64),
        redirectUri:
          'https://mw1-web-staging-staging.up.railway.app/api/integrations/instagram/callback',
      },
    )).rejects.toThrow(/no está habilitado/);
    expect(calls).not.toContain('mw1_instagram_oauth_nonces');
    expect(writes).toBe(0);
  });

  it('does not disclose pilot configuration to an unauthorized tenant', async () => {
    await expect(controller.instagramConfig(
      internalKey, pilotOwner, 'other-company-id', 'piloto-mw1-prueba',
    )).rejects.toThrow();
    expect(calls).toEqual(['companies']);
    expect(writes).toBe(0);
  });
});
