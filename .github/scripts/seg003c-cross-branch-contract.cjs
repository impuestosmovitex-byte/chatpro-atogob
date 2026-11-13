const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { generateKeyPairSync, createPublicKey } = require('node:crypto');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
function load(file) {
  const absolute=path.resolve(file);
  const compiled=ts.transpileModule(fs.readFileSync(absolute,'utf8'),
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  new Function('require','module','exports',compiled)(createRequire(absolute),module,module.exports);
  return module.exports;
}
const webFile=path.resolve('../../web-compatible/app/lib/internal-attestation.ts');
if(!fs.existsSync(webFile))throw Error('Complementary SEG-003C web branch checkout missing');
const {signInternalAttestation}=load(webFile);
const {verifyInternalAttestation}=load('src/internal-attestation.ts');
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
process.env.MW1_INTERNAL_ATTESTATION_PRIVATE_KEY=
  privateKey.export({format:'pem',type:'pkcs8'}).toString();
process.env.MW1_INTERNAL_ATTESTATION_PUBLIC_KEY=
  publicKey.export({format:'pem',type:'spki'}).toString();
const now=Date.now();
const user={kind:'user',userId:'alfa-owner',companyId:'alfa',companySlug:'alfa',
  method:'PATCH',path:'/users',body:{active:false,userId:'alfa-advisor'}};
const platform={kind:'platform',userId:'platform-operator',companyId:'',
  companySlug:'',method:'POST',path:'/platform-admin/companies',
  body:{name:'Fictional Alfa',slug:'fictional-alfa',maxUsers:2,ownerIdentifier:'fake'}};
for(const action of [user,platform]){
  const attestation=signInternalAttestation(action,now);
  assert.doesNotThrow(()=>verifyInternalAttestation(attestation,action,now));
  assert.throws(()=>verifyInternalAttestation(attestation,
    {...action,body:{...action.body,invalid:true}},now));
  assert.throws(()=>verifyInternalAttestation(attestation,
    {...action,userId:'another-user'},now));
  assert.throws(()=>verifyInternalAttestation(attestation,
    {...action,method:'GET'},now));
  assert.throws(()=>verifyInternalAttestation(attestation,
    {...action,path:'/different'},now));
  assert.throws(()=>verifyInternalAttestation(attestation,
    {...action,companyId:'beta'},now));
}
console.log('SEG-003C cross-branch signature contract: 12 passed, synthetic keys only.');
