import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createMessengerPilotOAuthState,
  getMessengerPilotIdentity,
} from '../app/lib/staging-messenger-oauth-protocol.ts';
import {
  messengerStateHashIfValid,
} from '../apps/api/src/staging-messenger-oauth-signed-state.ts';

// Cross-package compatibility, offline only: never call Meta, Supabase or OAuth routes.
const name = 'MW1_MESSENGER_OAUTH_STATE_SECRET';
const original = process.env[name];
const companyId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
try {
  process.env[name] = 'SYNTHETIC_MESSENGER_OAUTH_STATE_SECRET_2026_TEST_ONLY';
  const session = {
    type: 'user', roleKey: 'owner', companyId, userId,
    companySlug: 'piloto-mw1-prueba',
    expiresAt: Date.now() + 100000,
  };
  const identity = getMessengerPilotIdentity(session);
  assert.ok(identity);
  const state = createMessengerPilotOAuthState(identity);
  const hash = messengerStateHashIfValid(state, identity);
  assert.equal(hash, createHash('sha256').update(state).digest('hex'));
  assert.equal(messengerStateHashIfValid(state, identity, state), hash);
  assert.equal(messengerStateHashIfValid(state, identity, 'not-the-cookie'), null);
  assert.equal(messengerStateHashIfValid(state, { ...identity, userId: '33333333-3333-4333-8333-333333333333' }), null);
  assert.equal(messengerStateHashIfValid(state, { ...identity, companyId: '44444444-4444-4444-8444-444444444444' }), null);
  console.log('MW1 Messenger web/API state parity checks passed: HMAC, tenant, user, cookie and SHA-256 nonce hash.');
} finally {
  if (original === undefined) delete process.env[name];
  else process.env[name] = original;
}
