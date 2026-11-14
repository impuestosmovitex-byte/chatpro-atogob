'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const src=fs.readFileSync('app/lib/unified-panel-rollout.ts','utf8');
const transpiled=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
function enabled(value,slug) {
  const exports={};
  vm.runInNewContext(transpiled,{exports,process:{env:{MW1_UNIFIED_PANEL_COMPANIES:value}}});
  return exports.isUnifiedPanelEnabled(slug);
}
for(const slug of ['atogob','emprende-con-maogo','mw1-demo-mercado'])
  assert.equal(enabled('',slug),false,'Zero opt-in must preserve existing CRM for '+slug);
assert.equal(enabled('atogob','atogob'),true);
assert.equal(enabled('atogob','emprende-con-maogo'),false);
assert.equal(enabled('emprende-con-maogo','atogob'),false);
assert.equal(enabled('emprende-con-maogo','emprende-con-maogo'),true);
assert.equal(enabled('atogob,emprende-con-maogo','atogob'),true);
assert.equal(enabled('atogob,emprende-con-maogo','emprende-con-maogo'),true);
assert.equal(enabled('all','atogob'),false);
assert.equal(enabled('piloto-mw1-prueba','piloto-mw1-prueba'),false);
const gateway=fs.readFileSync('proxy.ts','utf8');
assert.ok(gateway.includes("pathname === '/panel'") &&
  gateway.includes('isUnifiedPanelEnabled(session.companySlug)'));
assert.ok(gateway.includes("'/panel',"));
const sidebar=fs.readFileSync('app/components/AppSidebar.tsx','utf8');
assert.ok(sidebar.includes("unifiedPanelEnabled ? [{ href: '/panel'"));
const login=fs.readFileSync('app/api/auth/login/route.ts','utf8');
assert.ok(login.includes('unifiedPanelEnabled: session.type'));
const companies=fs.readFileSync('app/api/auth/switch-company/route.ts','utf8');
assert.ok(companies.includes('unifiedPanelEnabled: data.session.type'));
for(const path of ['app/panel/page.tsx','app/panel/page.module.css'])
  assert.ok(fs.existsSync(path),'Prepared existing panel file '+path);
console.log('MW1 opt-in production prep: default off, ATOGOB/MAOGO independent, security gate and rollback paths OK');
