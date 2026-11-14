'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const ts = require('typescript');

const page = fs.readFileSync('app/panel/page.tsx', 'utf8');
const gateway = fs.readFileSync('proxy.ts', 'utf8');
const advisorPages = gateway.match(/const ADVISOR_ALLOWED_PAGES = \[([\s\S]*?)\];/);
assert.ok(advisorPages && advisorPages[1].includes("'/panel'"), 'Advisor must be allowed to open unified panel');
const advisorApis = gateway.match(/const ADVISOR_ALLOWED_APIS = \[([\s\S]*?)\];/);
assert.ok(advisorApis && !advisorApis[1].includes("'/api/platform-admin'"), 'Unified panel must not grant platform APIs to advisors');
const extracted = page.match(/function buildModules\(workspace: WorkspaceState\): Module\[\] \{[\s\S]*?\n\}\n\nexport default function UnifiedWorkspacePage/);
assert.ok(extracted, 'Missing unified workspace role-aware module selector');
const source = extracted[0].replace(/\n\nexport default function UnifiedWorkspacePage$/, '');
const transpiled = ts.transpileModule(source, {compilerOptions: {target:ts.ScriptTarget.ES2020}}).outputText;
const buildModules = vm.runInNewContext(transpiled + '\n buildModules;', {});
function expectedModuleLabels(permissions, role, commerce, companySlug='mw1-demo-mercado') {
  return buildModules({session:{roleKey:role,companySlug,companyName:'Empresa ficticia'},capabilities:permissions,commerce})
    .map(module=>module.label);
}
const allowed={inbox:true,clients:true,statistics:true,automations:true,configuration:true};
const owner=expectedModuleLabels(allowed,'owner',true);
for(const label of ['Bandeja omnicanal','Clientes','Estadísticas','Automatizaciones','Asistente de IA','Equipo y roles','Integraciones','Mi plan','Pedidos','Catálogo'])
  assert.ok(owner.includes(label), 'Owner must see authorised module: '+label);
const advisor=expectedModuleLabels({inbox:true,clients:true},'seg003_qa_inbox',false);
assert.deepEqual(Array.from(advisor), ['Bandeja omnicanal','Clientes']);
const restricted=expectedModuleLabels({},'advisor',false,'piloto-mw1-prueba');
assert.equal(restricted.length,0,'Advisor without grants must see no business modules');
const advisorWithConfig=expectedModuleLabels({...allowed},'advisor',true);
for(const label of ['Equipo y roles','Integraciones','Mi plan','Pedidos','Catálogo'])
  assert.equal(advisorWithConfig.includes(label),false,'Non-manager must not see '+label);
const otherTenant=expectedModuleLabels({inbox:false,clients:true},'owner',false,'piloto-mw1-prueba');
assert.equal(otherTenant.includes('Bandeja omnicanal'),false,'A company slug cannot confer inbox permission');
assert.equal(otherTenant.includes('Clientes'),true,'Positive entitlement should remain available');
const inboxRoute=fs.readFileSync('app/api/inbox/route.ts','utf8');
const inboxUi=fs.readFileSync('app/page.tsx','utf8');
assert.ok(inboxRoute.includes("path:sessionId?'/inbox/:sessionId':'/inbox'"),
  'Synthetic detail route must sign the canonical API path');
assert.ok(inboxRoute.includes("request.nextUrl.searchParams.has('mode')"),
  'Transfer-targets must stay blocked in staging');
assert.ok(inboxRoute.includes("if (process.env.MW1_STAGING_MODE === 'true') {") &&
  inboxRoute.includes("El envío de mensajes aún no está habilitado"),
  'Staging write actions must remain disabled');
assert.ok(inboxUi.includes('stagingReadOnly: data.stagingReadOnly === true'),
  'Client must propagate read-only result from API');
assert.ok(inboxUi.includes('selected.stagingReadOnly ? (') &&
  inboxUi.includes('Los envíos, las transferencias y los cambios de estado permanecen desactivados.'),
  'A synthetic conversation must not display the normal reply composer');
console.log('MW1 unified workspace role checks: 11 checks passed (owner, advisor, denied, non-manager, tenant-neutral, middleware).');
