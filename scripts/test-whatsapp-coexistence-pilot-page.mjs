import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const page=read('../app/configuracion/integraciones/whatsapp-coexistencia-prueba/page.tsx');
const client=read('../app/configuracion/integraciones/whatsapp-coexistencia-prueba/WhatsappCoexistencePilotDiagnostics.tsx');
const integrations=read('../app/configuracion/integraciones/page.tsx');

assert.match(page,/getInboxSession\(/);
assert.match(page,/INBOX_SESSION_COOKIE/);
assert.match(page,/MW1_STAGING_MODE\s*!==\s*'true'/);
assert.match(page,/session\.type\s*!==\s*'user'/);
assert.match(page,/session\.companySlug\s*!==\s*'piloto-mw1-prueba'/);
assert.match(page,/\['owner', 'admin'\]\.includes/);
assert.match(page,/notFound\(\)/);
assert.match(client,/fetch\('\/api\/integrations\/whatsapp\/embedded\/config'/);
assert.match(client,/window\.open\('about:blank'/);
assert.match(client,/config\?\.ready\s*===\s*true/);
assert.match(client,/No verificada: requiere configuraci[oó]n y n[uú]mero piloto/);
assert.doesNotMatch(client,/FB\.login|sdk\.login|completeSignup|embedded\/complete|\.rpc\(|\/webhook\/|\/exchange-code/);
assert.doesNotMatch(page,/FB\.login|sdk\.login|completeSignup|embedded\/complete|\.rpc\(|\/webhook\/|\/exchange-code/);
assert.match(integrations,/isCoexistencePilot\s*\?/);
assert.match(integrations,/data\.stagingReadOnly\s*===\s*true/);
assert.match(integrations,/data\.company\?\.slug\s*===\s*'piloto-mw1-prueba'/);
assert.match(integrations,/whatsapp-coexistencia-prueba/);

console.log('MW1 isolated WhatsApp coexistence diagnostic: signed pilot owner session, read-only API and no Meta connection operations verified.');
