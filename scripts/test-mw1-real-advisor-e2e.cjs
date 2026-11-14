#!/usr/bin/env node
'use strict';

// REAL Railway staging E2E gate for the EXISTING synthetic advisor.
// No generated session, fake API, credentials in repository, or tenant mutation.
// Run only with a securely provided test password. No messaging or POST except login.
const assert = require('node:assert/strict');

const base = process.env.MW1_E2E_STAGING_URL || 'https://mw1-web-staging-staging.up.railway.app';
const password = process.env.MW1_E2E_ADVISOR_PASSWORD;
const identifier = 'SEG003QADEMO01';
const company = 'mw1-demo-mercado';
const expectedUserId = process.env.MW1_E2E_ADVISOR_USER_ID;

function stop(message) {
  throw new Error(message);
}

async function main() {
  if (!password || !expectedUserId) {
    console.log('NOT RUN: real advisor password and expected user UUID are both required.');
    process.exitCode = 2;
    return;
  }
  const origin = new URL(base);
  assert.equal(origin.protocol, 'https:', 'HTTPS required');
  assert.equal(origin.hostname, 'mw1-web-staging-staging.up.railway.app',
    'Only the isolated staging Web is allowed');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  async function request(path, options = {}) {
    const res = await fetch(new URL(path, origin), {
      redirect: 'manual',
      cache: 'no-store',
      signal: controller.signal,
      ...options,
    });
    return res;
  }
  try {
    const login = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier, company, password }),
    });
    assert.equal(login.status, 200, 'Real staging login did not succeed');
    const setCookies = typeof login.headers.getSetCookie === 'function'
      ? login.headers.getSetCookie() : [login.headers.get('set-cookie') || ''];
    const sessionSetCookie = setCookies.find((value) => /^chatpro_inbox_session=/.test(value));
    // The name can change; identify the session cookie from a known constant if necessary.
    const cookieHeader = sessionSetCookie?.split(';', 1)[0];
    assert.ok(cookieHeader, 'No session cookie from real login');
    const auth = { cookie: cookieHeader };

    const sessionResponse = await request('/api/auth/session', { headers: auth });
    assert.equal(sessionResponse.status, 200, 'Real session rejected');
    const sessionBody = await sessionResponse.json();
    assert.equal(sessionBody.session?.type, 'user');
    assert.equal(sessionBody.session?.userId, expectedUserId, 'Different user authenticated');
    assert.equal(sessionBody.session?.companySlug, company, 'Wrong company');
    assert.equal(sessionBody.session?.roleKey, 'seg003_qa_inbox', 'Wrong active role');

    const permsResponse = await request('/api/auth/capabilities', { headers: auth });
    assert.equal(permsResponse.status, 200, 'Capability lookup failed');
    const permsBody = await permsResponse.json();
    const perms = permsBody.capabilities || {};
    assert.equal(perms.inbox, true, 'Inbox must be granted');
    assert.equal(perms.clients, true, 'Clients must be granted');
    for (const denied of ['statistics', 'automations', 'configuration']) {
      assert.equal(perms[denied], false, denied + ' must not be granted');
    }

    const panel = await request('/panel', { headers: auth });
    assert.ok([200, 302, 303, 307, 308].includes(panel.status), 'Panel did not respond');
    const inbox = await request('/', { headers: auth });
    assert.equal(inbox.status, 200, 'Inbox route unavailable');
    const clients = await request('/clientes', { headers: auth });
    assert.equal(clients.status, 200, 'Clients route unavailable');

    for (const path of ['/api/statistics', '/api/automations', '/api/platform-admin']) {
      const res = await request(path, { headers: auth });
      assert.equal(res.status, 403, path + ' should refuse advisor');
    }
    for (const path of ['/usuarios', '/configuracion']) {
      const res = await request(path, { headers: auth });
      assert.ok([302, 303, 307, 308, 403].includes(res.status),
        path + ' should not render for advisor');
    }
    console.log('PASS: authenticated advisor E2E against Railway staging; identity, tenant, permissions and route restrictions checked.');
  } finally {
    clearTimeout(timer);
  }
}

main().catch((error) => {
  console.error('FAIL: ' + error.message);
  process.exitCode = 1;
});
