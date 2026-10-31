const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const source=fs.readFileSync('app/lib/staging-visual-refinement.ts','utf8');
const js=ts.transpileModule(source,{compilerOptions:{
  module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
}});
const mod={exports:{}};
new Function('module','exports',js.outputText)(mod,mod.exports);
const {refineVisualChoices}=mod.exports;
const options=[
  {variantId:'black6',label:'Vestido negro talla 6'},
  {variantId:'black8',label:'Vestido negro talla 8'},
  {variantId:'red8',label:'Vestido rojo talla 8'},
];
function result(text,choices=options){return refineVisualChoices(text,choices);}
assert.deepEqual(result('quiero el negro talla 8').choices.map(x=>x.variantId),['black8']);
assert.deepEqual(result('el rojo talla 8').choices.map(x=>x.variantId),['red8']);
assert.deepEqual(result('la opción 2').choices.map(x=>x.variantId),['black8']);
assert.deepEqual(result('el segundo').choices.map(x=>x.variantId),['black8']);
assert.deepEqual(result('quiero el negro').choices.map(x=>x.variantId),['black6','black8']);
assert.deepEqual(result('quiero este').choices,options);
assert.equal(result('el de la izquierda').handled,true);
assert.equal(result('el de la izquierda').choices.length,3);
assert.equal(result('talla 10').choices.length,3);
assert.match(result('talla 10').reply,/No encontré/);
assert.equal(result('quiero 2 panes').handled,false);
assert.equal(result('¿cuánto cuestan estos vestidos?').handled,false);
assert.equal(result('necesito una talla 8').choices.length,2);
assert.deepEqual(result('quiero este',[options[1]]).choices,[options[1]]);
assert.deepEqual(options.map(x=>x.variantId),['black6','black8','red8']);
assert.equal(typeof result('quiero el negro talla 8').cart,'undefined');
console.log('MW1 photo follow-ups QA OK: color, size, ordinal, ambiguous options and no automatic cart mutation.');
