'use strict';
const assert = require('node:assert/strict');
const { validateMediaLabEnv } = require('./mw1-media-lab-preflight.cjs');
const fixture = {
  MW1_MEDIA_LAB_MODE: 'true',
  MW1_MEDIA_LAB_ALLOW_START: 'true',
  MW1_MEDIA_LAB_DATASET_ID: 'synthetic-only',
  MW1_MEDIA_LAB_AUTH_SECRET: 'mock-not-a-secret',
  MW1_MEDIA_LAB_STORAGE_BUCKET: 'synthetic-private',
  SUPABASE_URL: 'https://syntheticproject00000.supabase.co',
};
assert.equal(validateMediaLabEnv(fixture).ok, true, 'fully isolated synthetic fixture allowed');
assert.equal(validateMediaLabEnv({ ...fixture, MW1_MEDIA_LAB_MODE: 'false' }).ok, false);
assert.equal(validateMediaLabEnv({ ...fixture, CHATPRO_INBOX_KEY: 'should-not-be-used' }).ok, false);
assert.equal(validateMediaLabEnv({ ...fixture, REDIS_URL: 'redis://local' }).ok, false);
assert.equal(validateMediaLabEnv({ ...fixture, MW1_STAGING_INSTAGRAM_RECEIVE_ENABLED: 'true' }).ok, false);
assert.equal(validateMediaLabEnv({ ...fixture, SUPABASE_URL: 'https://zqfbxqszfnrbwpfukwak.supabase.co' }).ok, false);
assert.equal(validateMediaLabEnv({ ...fixture, SUPABASE_URL: 'http://localhost:54321' }).ok, false);
assert.equal(validateMediaLabEnv({ ...fixture, MW1_MEDIA_LAB_STORAGE_BUCKET: '' }).ok, false);
console.log('PASS: isolated lab configuration rejects commercial/staging credentials and unsafe database targets');
console.log('NO DEPLOYMENT, no network access, no external credentials used');
