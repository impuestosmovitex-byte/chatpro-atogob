'use strict';
/**
 * Boots the exact production lab entrypoint as a subprocess, using only a
 * synthetic configuration and loopback network. Never uses Railway tokens.
 */
const { spawn, spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const port = String(32000 + (process.pid % 10000));
const syntheticSecret = 'in-memory-lab-test-secret-32-chars-minimum';
const env = {
  PATH: process.env.PATH || '',
  HOME: process.env.HOME || '',
  NODE_ENV: 'test',
  MW1_MEDIA_LAB_MODE: 'true',
  MW1_MEDIA_LAB_ALLOW_START: 'true',
  MW1_MEDIA_LAB_DATASET_ID: 'synthetic-only',
  MW1_MEDIA_LAB_AUTH_SECRET: syntheticSecret,
  MW1_MEDIA_LAB_PORT: port,
};
const base = 'http://127.0.0.1:' + port;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const denied = spawnSync(process.execPath, ['media-lab-entry.cjs'], {
  env: { PATH: env.PATH, HOME: env.HOME }, encoding: 'utf8', timeout: 5000,
});
assert.equal(denied.status, 1, 'entrypoint must refuse startup without LAB switches');
assert.match(denied.stderr, /MEDIA_LAB_STARTUP_REFUSED/);
const app = spawn(process.execPath, ['media-lab-entry.cjs'], {
  env, stdio: ['ignore', 'pipe', 'pipe'],
});
let errors = '';
app.stderr.on('data', data => { errors += String(data).slice(0, 1000); });
(async () => {
  try {
    let health = null;
    for (let i = 0; i < 40; i++) {
      if (app.exitCode !== null) throw new Error('lab exited during startup: ' + errors);
      try { health = await fetch(base + '/health'); break; }
      catch { await delay(250); }
    }
    assert.ok(health, 'localhost health must respond');
    assert.equal(health.status, 200);
    assert.equal((await health.json()).syntheticOnly, true);
    const request = path => fetch(base + path, {
      headers: { authorization: 'Bearer ' + syntheticSecret,
        'x-mw1-lab-tenant': 'synthetic-only' },
    });
    const noAuth = await fetch(base + '/lab/media/synthetic-image');
    assert.equal(noAuth.status, 401);
    const img = await request('/lab/media/synthetic-image');
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('cache-control'), 'no-store');
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.ok((await img.arrayBuffer()).byteLength > 10);
    const missing = await request('/lab/media/no-fixture');
    assert.equal(missing.status, 404);
    const send = await fetch(base + '/inbox', { method: 'POST' });
    assert.equal(send.status, 404);
    const external = await request('/lab/media/https%3A%2F%2Flocalhost');
    assert.equal(external.status, 404);
    console.log('PASS: actual local-only lab entrypoint started with synthetic config; health 200, static bytes 200, unauthorized 401, absent 404, no operational POST');
  } finally {
    app.kill('SIGTERM');
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; app.kill('SIGTERM'); });
