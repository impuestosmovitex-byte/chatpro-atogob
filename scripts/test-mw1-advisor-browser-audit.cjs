#!/usr/bin/env node
'use strict';

// These are isolated MOCK tests for the browser audit harness, NOT a real
// authenticated Railway test. No cookies, tokens or secrets are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'mw1-advisor-browser-live-audit.js'), 'utf8');
const denied = ['/api/statistics', '/api/automations', '/api/users', '/api/platform-admin/me'];
const session = { type: 'user', userId: 'synthetic-uuid', roleKey: 'seg003_qa_inbox', companySlug: 'mw1-demo-mercado' };
const capabilities = { inbox: true, clients: true, statistics: false, automations: false, configuration: false };

async function simulate({ roleKey = session.roleKey, statuses = {}, permissions = capabilities, host = 'mw1-web-staging-staging.up.railway.app' } = {}) {
  const calls = [];
  let rendered = null;
  const document = {
    getElementById() { return null; },
    createElement() {
      return { style: {}, setAttribute() {}, set textContent(v) { this.message = v; }, get textContent() { return this.message; } };
    },
    body: { append(el) { rendered = el; } },
  };
  const fetch = async (url, opts) => {
    assert.equal(opts.credentials, 'same-origin');
    assert.equal(opts.method, 'GET');
    calls.push(url);
    if (url === '/api/auth/session') return { status: 200, json: async () => ({ session: { ...session, roleKey } }) };
    if (url === '/api/auth/capabilities') return { status: 200, json: async () => ({ capabilities: permissions }) };
    assert.ok(denied.includes(url), 'No unexpected requests allowed: ' + url);
    return { status: statuses[url] ?? 403 };
  };
  const ctx = { location: { hostname: host, protocol: 'https:' }, document, fetch, console: { table() {}, log() {} } };
  const result = vm.runInNewContext(source, ctx, { timeout: 2000 });
  try {
    const value = await result;
    return { value, calls, rendered };
  } catch (error) {
    return { error: String(error.message), calls, rendered };
  }
}

async function main() {
  const good = await simulate();
  assert.match(good.value.final, /^APROBADO/);
  assert.equal(good.calls.length, 6);
  assert.ok(good.rendered.textContent.includes('restricciones API'));
  assert.ok(good.rendered.textContent.includes('\nPermisos: OK\n'));

  const unexpected200 = await simulate({ statuses: { '/api/users': 200 } });
  assert.match(unexpected200.value.final, /^PENDIENTE/);
  assert.equal(unexpected200.value.checks.find(x => x.path === '/api/users').verdict, 'REVISAR');

  const badPermissions = await simulate({ permissions: { ...capabilities, statistics: true } });
  assert.match(badPermissions.value.final, /^PENDIENTE/);

  const otherRole = await simulate({ roleKey: 'owner' });
  assert.match(otherRole.error, /No es el asesor ficticio/);
  assert.equal(otherRole.calls.length, 1, 'Wrong identity must not query restricted resources');

  const otherHost = await simulate({ host: 'example.com' });
  assert.match(otherHost.error, /únicamente dentro de MW1 staging/);
  assert.equal(otherHost.calls.length, 0);
  console.log('PASS: isolated harness checks (mock only); real staging authenticated access still NOT RUN.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
