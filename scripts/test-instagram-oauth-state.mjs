import assert from 'node:assert/strict';
import {
  createInstagramOAuthState,
  verifyInstagramOAuthState,
} from '../app/lib/instagram-oauth-state.ts';

// This test uses synthetic identities and a synthetic key; it never calls Meta,
// Railway, Supabase or any live tenant and never enables the pilot.
const keyName = 'MW1_INSTAGRAM_OAUTH_STATE_SECRET';
const previousKey = process.env[keyName];
const originalNow = Date.now;
const companyId = 'offline-pilot-company';
const userId = 'offline-pilot-admin';

try {
  process.env[keyName] = 'OFFLINE_ONLY_INSTAGRAM_OAUTH_STATE_TEST_KEY_2026';

  const state = createInstagramOAuthState(companyId, userId);
  const secondState = createInstagramOAuthState(companyId, userId);
  assert.notEqual(secondState, state, 'Each request must contain a fresh nonce');

  const valid = verifyInstagramOAuthState(state, companyId, userId);
  assert.equal(valid?.companyId, companyId);
  assert.equal(valid?.userId, userId);
  assert.match(valid?.nonce ?? '', /^[A-Za-z0-9_-]{32}$/);

  assert.equal(verifyInstagramOAuthState(state, 'another-company', userId), null);
  assert.equal(verifyInstagramOAuthState(state, companyId, 'another-user'), null);

  const [encoded, signature] = state.split('.');
  const changed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  changed.companyId = 'another-company';
  const altered = Buffer.from(JSON.stringify(changed)).toString('base64url') + '.' + signature;
  assert.equal(verifyInstagramOAuthState(altered, companyId, userId), null,
    'Changing a signed field must invalidate the HMAC');
  assert.equal(verifyInstagramOAuthState(state + '.extra', companyId, userId), null);
  assert.equal(verifyInstagramOAuthState('not-a-signed-state', companyId, userId), null);
  assert.equal(verifyInstagramOAuthState('a'.repeat(2049), companyId, userId), null);

  const initialTime = 1800000000000;
  Date.now = () => initialTime;
  const datedState = createInstagramOAuthState(companyId, userId);
  Date.now = () => initialTime + 9 * 60 * 1000;
  assert.ok(verifyInstagramOAuthState(datedState, companyId, userId),
    'An unexpired state should remain valid');
  Date.now = () => initialTime + 10 * 60 * 1000 + 1;
  assert.equal(verifyInstagramOAuthState(datedState, companyId, userId), null,
    'A state older than 10 minutes must be rejected');

  Date.now = () => initialTime - 1;
  assert.equal(verifyInstagramOAuthState(datedState, companyId, userId), null,
    'Future-issued state must be rejected');

  Date.now = originalNow;
  process.env[keyName] = 'short';
  assert.throws(() => createInstagramOAuthState(companyId, userId), /clave segura/);
  assert.throws(() => verifyInstagramOAuthState(state, companyId, userId), /clave segura/);

  console.log('Instagram OAuth state offline checks passed: HMAC, tenant, user, nonce, expiry and secret.');
} finally {
  Date.now = originalNow;
  if (previousKey === undefined) delete process.env[keyName];
  else process.env[keyName] = previousKey;
}
