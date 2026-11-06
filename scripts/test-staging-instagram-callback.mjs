import assert from 'node:assert/strict';
import { parseStagingInstagramOAuthReturn } from '../app/lib/staging-instagram-oauth-return.ts';

// Pure, offline tests: no credentials, cookies, Meta requests, or real sign-in.
const parse = (query) => parseStagingInstagramOAuthReturn(new URLSearchParams(query));
const state = 'signed-oauth-state';

assert.deepEqual(parse({ code: 'meta-test-code', state }), {
  ok: true, code: 'meta-test-code', state,
}, 'One valid code and one state should pass the query check');

const cases = [
  ['missing code', { state }, 'missing_code'],
  ['empty code', { state, code: '' }, 'invalid_parameters'],
  ['whitespace code', { state, code: '   ' }, 'invalid_parameters'],
  ['oversized code', { state, code: 'x'.repeat(4097) }, 'invalid_parameters'],
  ['missing state', { code: 'abc' }, 'invalid_parameters'],
  ['oversized state', { code: 'abc', state: 's'.repeat(2049) }, 'invalid_parameters'],
  ['duplicated code', [['state', state], ['code', 'first'], ['code', 'second']], 'invalid_parameters'],
  ['duplicated state', [['code', 'abc'], ['state', state], ['state', 'another']], 'invalid_parameters'],
  ['provider denied', { state, error: 'access_denied' }, 'provider_error'],
  ['provider error with code', { state, error: 'denied', code: 'abc' }, 'invalid_parameters'],
  ['duplicated provider error', [['state', state], ['error', 'x'], ['error', 'y']], 'invalid_parameters'],
  ['orphan provider description', { state, error_description: 'sensitive text' }, 'invalid_parameters'],
  ['provider error and description', { state, error: 'denied', error_description: 'sensitive text' }, 'provider_error'],
];

for (const [description, parameters, reason] of cases) {
  assert.deepEqual(parse(parameters), { ok: false, reason }, description);
}

console.log('Instagram callback offline checks passed: one-time parameters, bounded code/state, provider errors.');
