import assert from 'node:assert/strict';
import { getInstagramDisplayStatus } from '../app/lib/instagram-display-status.ts';

// Pure UI-state regression test. No Meta credentials, requests or live flags.
function show(status, isStaging, connectionEnabled, authorizationEnabled) {
  return getInstagramDisplayStatus({
    status, isStaging, connectionEnabled, authorizationEnabled,
  });
}

const disabled = show('disconnected', true, false, undefined);
assert.equal(disabled.connected, false);
assert.equal(disabled.pending, false);
assert.equal(disabled.authorizationBlocked, true,
  'Staging must remain disabled when authorization is missing');

assert.equal(show('disconnected', true, false, false).authorizationBlocked, true);
assert.equal(show('disconnected', true, false, true).authorizationBlocked, false,
  'UI may advertise readiness only after explicit authorization');

const pending = show('pending', true, false, false);
assert.equal(pending.pending, true);
assert.equal(pending.connected, false);

const staleActive = show('active', true, false, false);
assert.equal(staleActive.connected, false,
  'An active database record cannot imply a live staging message connection');
assert.equal(staleActive.pending, true,
  'A stale active row must be displayed as inactive in staging');

const actuallyLive = show('active', true, true, true);
assert.equal(actuallyLive.connected, true);

const prodActive = show('active', false, undefined, undefined);
assert.equal(prodActive.connected, true,
  'Do not change non-staging behavior');

assert.equal(show('active', false, undefined, false).authorizationBlocked, true,
  'Preserve explicit non-staging authorization disablement');
assert.equal(show('disconnected', false, undefined, undefined).authorizationBlocked, false,
  'Preserve legacy non-staging fallback');
assert.equal(show('error', true, false, false).requiresReconnect, true);

console.log('Instagram display-status offline checks passed: staging fail-closed, pending, inactive messaging and non-staging compatibility.');
