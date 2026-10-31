/**
 * Offline staging catalog-source QA. No credentials, provider APIs, Supabase,
 * Railway, storefront writes, or network access.
 */
const assert=require('node:assert/strict');
const ts=require('typescript');
const fs=require('node:fs');
const source=fs.readFileSync('app/lib/staging-catalog-connections.ts','utf8');
const output=ts.transpileModule(source,{compilerOptions:{
  module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
},reportDiagnostics:true});
assert.equal((output.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
const mod={exports:{}};
new Function('module','exports',output.outputText)(mod,mod.exports);
const {sanitizeSources,sourceHealth,summarizeSources,CONNECTION_TYPES}=mod.exports;
const id='00000000-0000-4000-8000-000000000001';
const id2='00000000-0000-4000-8000-000000000002';
const id3='00000000-0000-4000-8000-000000000003';
const input=[
  {id,kind:'shopify',label:'Prueba Shopify',status:'ready',lastSyncedAt:null,
    managedBy:'mw1',secret:'DO_NOT_EXPOSE'},
  {id:id2,kind:'excel',label:'Prueba Excel',status:'ready',lastSyncedAt:null,
    managedBy:'external'},
  {id:id3,kind:'tiendanube',label:'Prueba TDN',status:'error',lastSyncedAt:null},
  {id,kind:'woocommerce',label:'duplicado',status:'ready'},
  {id:'not-a-uuid',kind:'pdf',label:'invalid',status:'ready'},
  {id:'00000000-0000-4000-8000-000000000004',kind:'unknown',status:'ready'},
];
const parsed=sanitizeSources(input);
assert.equal(parsed.length,3,'Solo fuentes autorizadas y no duplicadas');
assert.equal(parsed[0].managedBy,'external','No confiar en proveedor que declare propiedad local');
assert.equal(parsed[1].managedBy,'mw1','Excel es fuente local');
assert.ok(!JSON.stringify(parsed).includes('DO_NOT_EXPOSE'));
assert.equal(sourceHealth(parsed[0]).level,'attention',
  'Tienda externa registrada sin sincronización verificable requiere revisión');
assert.equal(sourceHealth(parsed[1]).level,'ok');
assert.equal(sourceHealth(parsed[2]).level,'attention');
assert.deepEqual(summarizeSources(parsed),{total:3,local:1,external:2,attention:2});
const recent=sanitizeSources([{...input[0],lastSyncedAt:'2026-10-21T16:00:00Z'}])[0];
assert.equal(sourceHealth(recent,Date.parse('2026-10-21T16:10:00Z')).level,'pending',
  'Un timestamp reciente no significa que una API haya sido probada');
assert.equal(sourceHealth(recent,Date.parse('2026-10-23T16:00:00Z')).level,'attention');
assert.equal(sourceHealth({...recent,status:'disabled'}).level,'disabled');
assert.equal(sourceHealth({...recent,status:'draft'}).level,'pending');
assert.equal(CONNECTION_TYPES.filter(x=>x.group==='external').length,4);
assert.equal(CONNECTION_TYPES.filter(x=>x.group==='external').every(x=>x.link===null),true,
  'No debe enlazar hacia conectores aún no construidos');
assert.equal(CONNECTION_TYPES.filter(x=>x.group==='local').every(x=>x.link!==null),true);
console.log('MW1 source health QA OK: multi-source, tenant-safe projection, disabled, expired, unverified remote APIs.');
