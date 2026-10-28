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
