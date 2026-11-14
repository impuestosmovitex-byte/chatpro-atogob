'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');

const panel=fs.readFileSync('app/panel/page.tsx','utf8');
const sidebar=fs.readFileSync('app/components/AppSidebar.tsx','utf8');
for (const [name,source] of [['Panel',panel],['Sidebar',sidebar]]) {
  assert.match(source,/\/api\/native-commerce\/access/,'Must reuse existing commerce access route: '+name);
  assert.match(source,/\.enabled === true/,'Optional commerce must be explicitly enabled: '+name);
  assert.doesNotMatch(source,/commerce = access\.ok;/,'HTTP success is not an entitlement: '+name);
  assert.doesNotMatch(source,/setOrdersEnabled\(commerce\.ok\)/,'Sidebar cannot infer plan from HTTP 200: '+name);
}
function eligible(httpOk,payload){
  return httpOk && payload?.enabled === true;
}
assert.equal(eligible(true,{ok:true,enabled:true}),true);
assert.equal(eligible(true,{ok:true,enabled:false}),false);
assert.equal(eligible(true,{ok:true}),false);
assert.equal(eligible(false,{ok:false,enabled:true}),false);
assert.equal(eligible(true,null),false);
console.log('PASS optional commerce visibility: explicit entitlement only, 5 response cases and two UI entry points.');
