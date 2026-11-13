const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const crypto = require('node:crypto');

async function main() {
  const source=fs.readFileSync('app/lib/internal-attestation.ts','utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{
    module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
  }}).outputText;
  const module={exports:{}};
  new Function('require','module','exports',compiled)(require,module,module.exports);
  const { signInternalAttestation }=module.exports;
  const pair=crypto.generateKeyPairSync('ed25519');
  process.env.MW1_INTERNAL_ATTESTATION_PRIVATE_KEY=
    pair.privateKey.export({format:'pem',type:'pkcs8'}).toString();
  const action={kind:'platform',userId:'fake-platform-operator',companyId:'',
    companySlug:'',method:'POST',path:'/platform-admin/companies',
    body:{name:'Synthetic',slug:'synthetic',ownerIdentifier:'test',maxUsers:3}};
  const first=signInternalAttestation(action,1763060400000);
  const [raw,signature]=first.split('.');
  assert.equal(first.split('.').length,2);
  assert(crypto.verify(null,Buffer.from(raw),pair.publicKey,
    Buffer.from(signature,'base64url')),'Signature must verify with public key');
  const claim=JSON.parse(Buffer.from(raw,'base64url').toString());
  assert.equal(claim.userId,'fake-platform-operator');
  assert.equal(claim.method,'POST');
  assert.equal(claim.path,'/platform-admin/companies');
  assert.equal(claim.exp-claim.iat,20);
  assert.equal(claim.nonce.length,32);
  const expectedHash=crypto.createHash('sha256').update(
    '{"maxUsers":3,"name":"Synthetic","ownerIdentifier":"test","slug":"synthetic"}').digest('hex');
  assert.equal(claim.bodyHash,expectedHash);
  const second=signInternalAttestation(action,1763060400000);
  assert.notEqual(second,first,'Each assertion must use fresh nonce');
  delete process.env.MW1_INTERNAL_ATTESTATION_PRIVATE_KEY;
  assert.throws(()=>signInternalAttestation(action),/clave privada/);
  // Verify wiring: web identity comes only from signed user/platform session.
  const users=fs.readFileSync('app/api/users/route.ts','utf8');
  const roles=fs.readFileSync('app/api/roles/route.ts','utf8');
  const companies=fs.readFileSync('app/api/platform-admin/companies/route.ts','utf8');
  for(const s of [users,roles,companies])
    assert(s.includes('signInternalAttestation('));
  for(const s of [users,roles])
    assert(s.includes("session.userId || ''") && s.includes('session.companySlug'));
  assert(companies.includes("kind: 'platform'"));
  console.log('SEG-003C: 12 synthetic signing and proxy contract checks passed');
}
main().catch(e=>{console.error(e);process.exitCode=1});
