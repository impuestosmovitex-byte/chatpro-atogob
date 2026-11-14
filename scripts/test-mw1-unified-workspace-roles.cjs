'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const ts = require('typescript');

const page = fs.readFileSync('app/panel/page.tsx', 'utf8');
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
console.log('MW1 unified workspace role checks: 5 cases passed (owner, advisor, denied, non-manager, tenant-neutral).');
