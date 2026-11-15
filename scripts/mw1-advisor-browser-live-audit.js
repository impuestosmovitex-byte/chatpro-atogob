/* MW1 — asesor staging: auditoría SOLO LECTURA en la sesión actual.
 * Ejecutar en la consola de mw1-web-staging-staging.up.railway.app
 * No lee/expone contraseñas, cookies ni contenido de clientes.
 * No envía resultados fuera del navegador. No modifica datos.
 */
(async function mw1AdvisorLiveAccessAudit() {
  'use strict';
  const allowedHost = 'mw1-web-staging-staging.up.railway.app';
  if (location.hostname !== allowedHost || location.protocol !== 'https:') {
    throw new Error('Ejecutar únicamente dentro de MW1 staging HTTPS.');
  }
  const get = async (path) => {
    const response = await fetch(path, {
      method: 'GET',
      credentials: 'same-origin',
      redirect: 'manual',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    return response;
  };
  const sessionResponse = await get('/api/auth/session');
  if (sessionResponse.status !== 200) {
    throw new Error('La sesión de staging no está autenticada.');
  }
  const session = (await sessionResponse.json()).session;
  if (session?.type !== 'user' ||
      session?.roleKey !== 'seg003_qa_inbox' ||
      session?.companySlug !== 'mw1-demo-mercado' ||
      !session?.userId) {
    throw new Error('No es el asesor ficticio SEG003 de MW1 Demo Supermercado. Se canceló sin probar otros módulos.');
  }
  const permissionsResponse = await get('/api/auth/capabilities');
  const permissions = permissionsResponse.status === 200
    ? (await permissionsResponse.json()).capabilities || {} : {};
  const expected = [
    ['/api/statistics', 403],
    ['/api/automations', 403],
    ['/api/users', 403],
    ['/api/platform-admin/me', 403],
  ];
  const results = [];
  for (const [path, status] of expected) {
    try {
      const response = await get(path);
      results.push({ path, expected: status, actual: response.status,
        verdict: response.status === status ? 'OK' : 'REVISAR' });
    } catch {
      results.push({ path, expected: status, actual: 'Error de red', verdict: 'REVISAR' });
    }
  }
  const deniedCapabilities = [
    'statistics', 'automations', 'configuration',
  ];
  const validPermissions = permissionsResponse.status === 200 &&
    permissions.inbox === true && permissions.clients === true &&
    deniedCapabilities.every((key) => permissions[key] === false);
  const passed = validPermissions && results.every(r => r.verdict === 'OK');
  // Output is intentionally free from user IDs, token values, cookies and response bodies.
  const summary = {
    environment: 'MW1 staging',
    role: 'seg003_qa_inbox',
    tenant: 'mw1-demo-mercado',
    permissions: validPermissions ? 'OK' : 'REVISAR',
    checks: results,
    final: passed ? 'APROBADO: restricciones API' : 'PENDIENTE: revisar bloqueos',
  };
  console.table(results);
  console.log('MW1 auditoría del asesor:', summary);
  const existing = document.getElementById('mw1-advisor-live-audit-results');
  existing?.remove();
  const dialog = document.createElement('pre');
  dialog.id = 'mw1-advisor-live-audit-results';
  dialog.setAttribute('role', 'status');
  dialog.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:min(560px,calc(100vw - 32px));max-height:70vh;overflow:auto;padding:18px;background:#0e2034;color:white;border:2px solid #f1ba3a;border-radius:12px;font:12px/1.5 monospace;white-space:pre-wrap;box-shadow:0 8px 28px #0006';
  dialog.textContent = 'MW1 — Prueba real del asesor\\n' +
    'Permisos: ' + summary.permissions + '\n' +
    results.map(r => r.path + ': ' + r.actual + ' (esperado 403) ' + r.verdict).join('\n') +
    '\n\n' + summary.final + '\\n(Recarga la página para cerrar)';
  document.body.append(dialog);
  return summary;
})();
