/*
 * MW1 staging: negative cross-tenant read-only probe.
 * Paste only inside an authenticated SEG003QADEMO01 browser session at
 * https://mw1-web-staging-staging.up.railway.app .
 * The fixture IDs below are SYNTHETIC staging-only conversation UUIDs.
 * No POST, no login, no cookie access, no data bodies logged, no mutations.
 * IMPORTANT: this does NOT test a tenant-switch POST or cover all modules.
 */
(async function auditForeignTenantRead() {
  'use strict';
  if (location.protocol !== 'https:' ||
      location.hostname !== 'mw1-web-staging-staging.up.railway.app') {
    throw new Error('Solo puede ejecutarse en MW1 staging HTTPS.');
  }
  const headers = { accept: 'application/json' };
  const get = (uri) => fetch(uri, {
    method: 'GET', credentials: 'same-origin',
    cache: 'no-store', redirect: 'manual', headers,
  });
  const sessionResponse = await get('/api/auth/session');
  if (sessionResponse.status !== 200) throw new Error('Sesión no autenticada.');
  const data = await sessionResponse.json();
  const principal = data.session;
  if (principal?.type !== 'user' ||
      principal?.roleKey !== 'seg003_qa_inbox' ||
      principal?.companySlug !== 'mw1-demo-mercado' ||
      !principal?.userId) {
    throw new Error('Se requiere el asesor ficticio SEG003 de Demo Supermercado.');
  }
  const cases = [
    {
      name: 'Conversación propia (control positivo)',
      url: '/api/inbox?sessionId=5c92f73a-15c6-4353-a343-71c1ecc1a953',
      allowed: [200],
    },
    {
      name: 'Conversación ajena (Piloto MW1 Prueba)',
      url: '/api/inbox?sessionId=824d344e-499f-4683-8316-2723af130b81',
      allowed: [403,404],
    },
  ];
  const results = [];
  for (const c of cases) {
    try {
      const response = await get(c.url);
      results.push({
        check: c.name, expected: c.allowed.join('/'), actual: response.status,
        result: c.allowed.includes(response.status) ? 'OK' : 'REVISAR',
      });
      // Never inspect, print or persist conversation response bodies.
      await response.body?.cancel();
    } catch {
      results.push({
        check: c.name, expected: c.allowed.join('/'), actual: 'ERROR DE RED',
        result: 'REVISAR',
      });
    }
  }
  const verdict = results.every(x => x.result === 'OK')
    ? 'APROBADO (solo lectura de conversaciones ficticias)'
    : 'PENDIENTE: revisar controles de acceso';
  console.table(results);
  console.log('MW1 staging aislamiento:', verdict);
  return { verdict, results };
})();
