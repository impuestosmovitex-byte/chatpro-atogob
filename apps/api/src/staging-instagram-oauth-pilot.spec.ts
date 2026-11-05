import { StagingIntegrationsController } from './staging-integrations.controller';
import { SupabaseService } from './supabase.service';
import { IntegrationCredentialsService } from './integration-credentials.service';

describe('Instagram Unified Login pilot: simulated authorization stays pending', () => {
  const companyId = 'synthetic-pilot-company';
  const userId = 'synthetic-owner-user';
  const internalKey = 'synthetic-private-inbox-key';
  const token = 'synthetic_business_integration_access_token_123456';
  const accountId = '17841400000123456';
  const redirectUri =
    'https://mw1-web-staging-staging.up.railway.app/api/integrations/instagram/callback';
  const nonceHash = 'a'.repeat(64);
  const configKeys = [
    'CHATPRO_INBOX_KEY',
    'MW1_STAGING_INSTAGRAM_ONBOARDING_ENABLED',
    'MW1_STAGING_INSTAGRAM_OAUTH_ENABLED',
    'MW1_STAGING_INSTAGRAM_LOGIN_UI_ENABLED',
    'MW1_STAGING_INSTAGRAM_TOKEN_EXCHANGE_ENABLED',
    'META_INSTAGRAM_APP_ID',
    'META_INSTAGRAM_APP_SECRET',
    'META_INSTAGRAM_UNIFIED_CONFIG_ID',
    'META_INSTAGRAM_API_VERSION',
    'CHATPRO_INTEGRATIONS_ENCRYPTION_KEY',
  ] as const;
  const original = new Map<string, string | undefined>();
  const originalFetch = global.fetch;
  let controller: StagingIntegrationsController;
  let fetches: string[];
  let saved: Array<{ table: string; row: Record<string, unknown> }>;
  let encryptionInputs: unknown[];
  let consumed: boolean;
  let scopes: string[];
  let selectedUsername: string;
  let selectedAccounts: Array<{ id: string; username: string }>;
  let role: string;

  beforeAll(() => {
    for (const key of configKeys) original.set(key, process.env[key]);
  });

  beforeEach(() => {
    process.env.CHATPRO_INBOX_KEY = internalKey;
    for (const key of [
      'MW1_STAGING_INSTAGRAM_ONBOARDING_ENABLED',
      'MW1_STAGING_INSTAGRAM_OAUTH_ENABLED',
      'MW1_STAGING_INSTAGRAM_LOGIN_UI_ENABLED',
      'MW1_STAGING_INSTAGRAM_TOKEN_EXCHANGE_ENABLED',
    ]) process.env[key] = 'true';
    process.env.META_INSTAGRAM_APP_ID = '1079916404666757';
    process.env.META_INSTAGRAM_APP_SECRET = 'SYNTHETIC_UNIT_TEST_SECRET';
    process.env.META_INSTAGRAM_UNIFIED_CONFIG_ID = '2371579683591784';
    process.env.META_INSTAGRAM_API_VERSION = 'v26.0';
    process.env.CHATPRO_INTEGRATIONS_ENCRYPTION_KEY = 'SYNTHETIC_UNIT_TEST_ENCRYPTION_KEY';

    fetches = [];
    saved = [];
    encryptionInputs = [];
    consumed = true;
    scopes = ['instagram_basic', 'instagram_manage_messages'];
    selectedUsername = 'chatpro_mw1';
    selectedAccounts = [{ id: accountId, username: selectedUsername }];
    role = 'owner';

    const rows: Record<string, Record<string, unknown>> = {
      companies: { id: companyId, slug: 'piloto-mw1-prueba', status: 'active', name: 'Piloto sintético' },
      company_memberships: {
        company_id: companyId, user_id: userId, active: true, role_id: 'owner-role',
      },
      app_roles: { id: 'owner-role', key: 'owner', company_id: null },
    };
    const db = {
      from: (table: string) => {
        const filters: Record<string, unknown> = {};
        const q = {
          select: (_fields: string) => q,
          eq: (field: string, value: unknown) => {
            filters[field] = value;
            return q;
          },
          order: (_field: string, _options: { ascending: boolean }) => q,
          limit: async (_n: number) => ({ data: [], error: null }),
          maybeSingle: async () => {
            const row = table === 'app_roles' ? { ...rows[table], key: role } : rows[table];
            return {
              data: row && Object.entries(filters).every(([key, val]) => row[key] === val)
                ? row : null,
              error: null,
            };
          },
          insert: async (row: Record<string, unknown>) => {
            saved.push({ table, row });
            return { error: null };
          },
        };
        return q;
      },
      rpc: async (_name: string, _params: unknown) => ({
        data: consumed, error: null,
      }),
    };
    const credentials = {
      encrypt: (data: unknown) => {
        encryptionInputs.push(data);
        return 'synthetic-encrypted-credential';
      },
    };
    controller = new StagingIntegrationsController(
      { getClient: () => db } as unknown as SupabaseService,
      credentials as unknown as IntegrationCredentialsService,
    );

    global.fetch = (async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      fetches.push(url.pathname);
      let response: Record<string, unknown>;
      if (url.pathname.endsWith('/oauth/access_token')) {
        response = { access_token: token };
      } else if (url.pathname.endsWith('/debug_token')) {
        response = {
          data: { app_id: '1079916404666757', type: 'SYSTEM_USER',
            is_valid: true, scopes },
        };
      } else if (url.pathname === '/v26.0/me') {
        response = { client_business_id: 'synthetic-business-id' };
      } else if (url.pathname.endsWith('/me/assigned_instagram_accounts')) {
        response = { data: selectedAccounts };
      } else if (url.pathname === `/v26.0/${accountId}`) {
        response = { id: accountId, username: selectedUsername };
      } else {
        throw new Error(`Unexpected Meta API call: ${url.pathname}`);
      }
      return new Response(JSON.stringify(response), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  afterAll(() => {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const authorize = () => controller.exchangeInstagramCode(
    internalKey, userId, companyId, 'piloto-mw1-prueba',
    { code: 'synthetic-meta-auth-code', redirectUri, nonceHash },
  );

  it('reports ready but never advertises a live webhook or messaging connection', async () => {
    const config = await controller.instagramConfig(
      internalKey, userId, companyId, 'piloto-mw1-prueba',
    );
    expect(config.ready).toBe(true);
    expect(config.authorizationEnabled).toBe(true);
    expect(config.connectionEnabled).toBe(false);
    expect(config.webhookEnabled).toBe(false);
    expect(saved).toEqual([]);
    expect(fetches).toEqual([]);
  });

  it('stores only an encrypted pending pilot authorization, never subscribes webhooks', async () => {
    const result = await authorize();
    expect(result).toMatchObject({
      ok: true, pending: true, connectionEnabled: false,
      instagram: { username: 'chatpro_mw1' },
    });
    expect(saved).toHaveLength(1);
    expect(saved[0].table).toBe('company_integrations');
    expect(saved[0].row).toMatchObject({
      company_id: companyId,
      status: 'pending',
      provider: 'meta',
      integration_type: 'instagram',
      external_id: accountId,
      credential_mode: 'encrypted',
      credentials_encrypted: 'synthetic-encrypted-credential',
      config: { username: 'chatpro_mw1', webhooks_subscribed: false },
    });
    expect(encryptionInputs).toEqual([{ access_token: token }]);
    expect(JSON.stringify(saved[0].row)).not.toContain(token);
    expect(fetches).toEqual([
      '/v26.0/oauth/access_token',
      '/v26.0/debug_token',
      '/v26.0/me',
      '/v26.0/me/assigned_instagram_accounts',
    ]);
  });

  it('rejects missing Instagram message permissions without saving credentials', async () => {
    scopes = ['instagram_basic'];
    await expect(authorize()).rejects.toThrow(/Meta no confirmó/);
    expect(saved).toEqual([]);
    expect(encryptionInputs).toEqual([]);
    expect(fetches).toEqual(['/v26.0/oauth/access_token', '/v26.0/debug_token']);
  });

  it('rejects a different Instagram username without saving credentials', async () => {
    selectedAccounts = [{ id: accountId, username: 'not_pilot_account' }];
    await expect(authorize()).rejects.toThrow(/chatpro_mw1/);
    expect(saved).toEqual([]);
    expect(encryptionInputs).toEqual([]);
  });

  it('rejects ambiguous multiple authorized accounts', async () => {
    selectedAccounts = [
      { id: accountId, username: 'chatpro_mw1' },
      { id: '17841400000999999', username: 'another_account' },
    ];
    await expect(authorize()).rejects.toThrow(/exactamente una cuenta/);
    expect(saved).toEqual([]);
    expect(encryptionInputs).toEqual([]);
  });

  it('does not call Meta when the one-time authorization was already consumed', async () => {
    consumed = false;
    await expect(authorize()).rejects.toThrow(/vencida o utilizada/);
    expect(fetches).toEqual([]);
    expect(saved).toEqual([]);
  });

  it('does not call Meta or change data for a user without integration permissions', async () => {
    role = 'viewer';
    await expect(authorize()).rejects.toThrow(/administrar integraciones/);
    expect(fetches).toEqual([]);
    expect(saved).toEqual([]);
  });
});
