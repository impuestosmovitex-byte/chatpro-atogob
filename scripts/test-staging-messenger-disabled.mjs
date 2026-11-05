import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isMessengerDisabledInStaging } from '../app/lib/staging-messenger-gate.ts';

// Offline fail-closed regression: no API requests, Meta tokens or tenant data.
assert.equal(isMessengerDisabledInStaging('mw1-web-staging-staging.up.railway.app'), true);
assert.equal(isMessengerDisabledInStaging('MW1-WEB-STAGING-STAGING.UP.RAILWAY.APP'), true);
assert.equal(isMessengerDisabledInStaging('chatpro-web-production.up.railway.app'), false);
assert.equal(isMessengerDisabledInStaging('example.org'), false);

const routes = ['config', 'callback', 'exchange-code', 'discover', 'complete'];
for (const route of routes) {
  const source = readFileSync(
    `app/api/integrations/messenger/${route}/route.ts`, 'utf8',
  );
  const check = source.indexOf('isMessengerDisabledInStaging(request.nextUrl.hostname)');
  assert.ok(check >= 0, `${route} must reject Messenger authorization in staging`);
  const apiCall = source.indexOf('await fetch(');
  if (apiCall >= 0) {
    assert.ok(check < apiCall, `${route} must deny before any backend call`);
  }
  if (route === 'callback') {
    assert.ok(check < source.indexOf('x-forwarded-host'),
      'Do not trust a forwarded host for staging OAuth redirects');
    assert.ok(source.includes("'Referrer-Policy', 'no-referrer'"),
      'Do not leak staging OAuth metadata in referrers');
  }
}

const ui = readFileSync('app/configuracion/integraciones/MessengerConnectButton.tsx', 'utf8');
assert.ok(ui.includes("window.sessionStorage.removeItem('chatpro_messenger_oauth_state');"));
assert.ok(ui.includes("if (!config.ready) {"),
  'Discard returned OAuth codes when Messenger is disabled');
console.log('MW1 Messenger staging checks passed: OAuth and token routes denied, no client token retention on disabled callback.');
