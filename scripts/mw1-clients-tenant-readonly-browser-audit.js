/*
 * Staging-only, credential-free read-only multi-company probe.
 * Run from Chrome Console as SEG003QADEMO01 in mw1-demo-mercado.
 * Fixture phones are fabricated 000000000... values in staging.
 * No POST, no cookies/tokens exposed, no message or contact bodies logged.
 */
(async function mw1ClientIsolationReadOnly() {
  if (location.hostname !== 'mw1-web-staging-staging.up.railway.app' || location.protocol !== 'https:') {
    throw Error('Se permite únicamente en MW1 staging HTTPS.');
  }
  const get = (path) => fetch(path, {
    method: 'GET', credentials: 'same-origin', redirect: 'manual',
    cache: 'no-store', headers: { accept: 'application/json' },
  });
  const who = await get('/api/auth/session');
  if (who.status !== 200) throw Error('Sesión no autenticada.');
  const { session } = await who.json();
  if (session?.type !== 'user' || session?.roleKey !== 'seg003_qa_inbox' ||
      session?.companySlug !== 'mw1-demo-mercado' || !session?.userId) {
    throw Error('No es SEG003QADEMO01 de mw1-demo-mercado: prueba cancelada.');
  }
  const results = [];
  const own = await get('/api/clients?phone=000000000102');
  results.push({ prueba: 'Contacto propio ficticio', http: own.status,
    esperado: '200', estado: own.status === 200 ? 'OK' : 'REVISAR' });
  await own.body?.cancel();
  const foreign = await get('/api/clients?phone=000000000202');
  results.push({ prueba: 'Contacto ajeno ficticio', http: foreign.status,
    esperado: '403/404', estado: [403, 404].includes(foreign.status) ? 'OK' : 'REVISAR' });
  // Explicitly refuse to read any response body, including erroneous 200.
  await foreign.body?.cancel();
  const companiesResponse = await get('/api/auth/companies');
  let companyCheck = 'REVISAR';
  if (companiesResponse.status === 200) {
    const companiesJson = await companiesResponse.json();
    const companies = Array.isArray(companiesJson.companies) ? companiesJson.companies : [];
    companyCheck = companies.some(c => c.slug === 'mw1-demo-mercado') &&
      !companies.some(c => c.slug === 'piloto-mw1-prueba') ? 'OK' : 'REVISAR';
  }
  results.push({ prueba: 'Lista de empresas permitidas', http: companiesResponse.status,
    esperado: '200, sin piloto-mw1-prueba', estado: companyCheck });
  console.table(results);
  console.log(results.every(r => r.estado === 'OK')
    ? 'APROBADO: pruebas de lectura de Clientes y selector'
    : 'PENDIENTE: revisar controles');
  console.log('No se ejecutó ningún cambio de empresa ni prueba POST.');
})();
