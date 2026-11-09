import { assertStagingIsolation } from './staging-safety';

const valid: NodeJS.ProcessEnv = {
  MW1_STAGING_MODE: 'true',
  SUPABASE_URL: 'https://zqfbxqszfnrbwpfukwak.supabase.co',
  SUPABASE_SECRET_KEY: 'STAGING_FIXTURE_NOT_A_REAL_SECRET_123456',
  CHATPRO_INBOX_KEY: 'STAGING_FIXTURE_INTERNAL_KEY_123456',
};

describe('assertStagingIsolation', () => {
  it('accepts test-only credentials for the dedicated staging project', () => {
    expect(() => assertStagingIsolation(valid)).not.toThrow();
  });
  it('blocks production or unknown Supabase references', () => {
    expect(() => assertStagingIsolation({
      ...valid, SUPABASE_URL: 'https://lttucfblydpaljfboxro.supabase.co',
    })).toThrow(/STAGING BLOCKED/);
  });
  it('permits only the three dedicated Meta Embedded Signup variables', () => {
    expect(() => assertStagingIsolation({
      ...valid,
      META_WHATSAPP_APP_ID: '123456789',
      META_WHATSAPP_EMBEDDED_CONFIG_ID: '987654321',
      META_WHATSAPP_APP_SECRET: 'STAGING_FIXTURE_META_NOT_REAL',
    })).not.toThrow();
    expect(() => assertStagingIsolation({
      ...valid,
      META_WHATSAPP_ACCESS_TOKEN: 'must-not-be-present',
    })).toThrow(/external messaging/);
  });
  it('accepts only the pinned public Instagram pilot identifiers', () => {
    expect(() => assertStagingIsolation({
      ...valid,
      META_INSTAGRAM_APP_ID: '1079916404666757',
      META_INSTAGRAM_UNIFIED_CONFIG_ID: '2371579683591784',
    })).not.toThrow();
    expect(() => assertStagingIsolation({
      ...valid,
      META_INSTAGRAM_APP_ID: 'unexpected-app',
      META_INSTAGRAM_UNIFIED_CONFIG_ID: '2371579683591784',
    })).toThrow(/unexpected Instagram pilot identifier/);
    expect(() => assertStagingIsolation({
      ...valid,
      META_INSTAGRAM_APP_ID: '1079916404666757',
      META_INSTAGRAM_UNIFIED_CONFIG_ID: 'unexpected-configuration',
    })).toThrow(/unexpected Instagram pilot identifier/);
  });
  it('allows only the specifically pinned public Instagram platform app ID', () => {
    expect(() => assertStagingIsolation({
      ...valid,
      META_INSTAGRAM_APP_ID:'1079916404666757',
      META_INSTAGRAM_UNIFIED_CONFIG_ID:'2371579683591784',
      META_INSTAGRAM_PLATFORM_APP_ID:'1674184274384954',
    })).not.toThrow();
    expect(() => assertStagingIsolation({
      ...valid,
      META_INSTAGRAM_PLATFORM_APP_ID:'wrong-app-identifier',
    })).toThrow(/unexpected Instagram pilot identifier/);
    expect(() => assertStagingIsolation({
      ...valid,
      META_INSTAGRAM_PLATFORM_APP_ID:'1674184274384954',
      META_INSTAGRAM_ACCESS_TOKEN:'never-allowed',
    })).toThrow(/external messaging/);
  });

  it('rejects an Instagram secret without explicit pilot safety prerequisites', () => {
    const instagram = {
      ...valid,
      META_INSTAGRAM_APP_ID: '1079916404666757',
      META_INSTAGRAM_UNIFIED_CONFIG_ID: '2371579683591784',
      META_INSTAGRAM_APP_SECRET: 'STAGING_FIXTURE_NOT_A_REAL_META_SECRET',
      CHATPRO_INTEGRATIONS_ENCRYPTION_KEY: 'STAGING_FIXTURE_ENCRYPTION_KEY',
    };
    expect(() => assertStagingIsolation(instagram)).toThrow(/external messaging/);
    expect(() => assertStagingIsolation({
      ...instagram,
      MW1_STAGING_INSTAGRAM_SECRET_ALLOWED: 'true',
      CHATPRO_INTEGRATIONS_ENCRYPTION_KEY: '',
    })).toThrow(/external messaging/);
    expect(() => assertStagingIsolation({
      ...instagram, MW1_STAGING_INSTAGRAM_SECRET_ALLOWED: 'true',
    })).not.toThrow();
  });
  it('still rejects Instagram and other provider tokens with the pilot secret allowed', () => {
    const permitted = {
      ...valid,
      META_INSTAGRAM_APP_ID: '1079916404666757',
      META_INSTAGRAM_UNIFIED_CONFIG_ID: '2371579683591784',
      META_INSTAGRAM_APP_SECRET: 'STAGING_FIXTURE_NOT_A_REAL_META_SECRET',
      CHATPRO_INTEGRATIONS_ENCRYPTION_KEY: 'STAGING_FIXTURE_ENCRYPTION_KEY',
      MW1_STAGING_INSTAGRAM_SECRET_ALLOWED: 'true',
    };
    expect(() => assertStagingIsolation({
      ...permitted,
      META_INSTAGRAM_ACCESS_TOKEN: 'not-a-real-token',
    })).toThrow(/external messaging/);
    expect(() => assertStagingIsolation({
      ...permitted,
      OPENAI_API_KEY: 'not-a-real-openai-key',
    })).toThrow(/external messaging/);
  });
  it('blocks external channel credentials', () => {
    expect(() => assertStagingIsolation({
      ...valid, SHOPIFY_ACCESS_TOKEN: 'do-not-connect',
    })).toThrow(/external messaging/);
  });
  it('blocks missing isolated server keys', () => {
    expect(() => assertStagingIsolation({
      ...valid, SUPABASE_SECRET_KEY: '',
    })).toThrow(/SUPABASE_SECRET_KEY/);
  });
  it('does not alter production startup when staging mode is disabled', () => {
    expect(() => assertStagingIsolation({ MW1_STAGING_MODE: 'false' })).not.toThrow();
  });
});
