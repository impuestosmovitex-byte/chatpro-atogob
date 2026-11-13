/**
 * SEG-003B: test the real signed session module without network, accounts or secrets.
 * The module is TypeScript-only and has no runtime imports.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
  const contents = fs.readFileSync(path.resolve('app/lib/inbox-auth.ts'), 'utf8');
  const js = ts.transpileModule(contents, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const auth = await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
  process.env.CHATPRO_INBOX_SESSION_SECRET='synthetic-ci-secret-one-for-test-only';
  const user = {
    type:'user',userId:'alfa-owner-id',companyId:'alfa-id',
    companySlug:'alfa',companyName:'Empresa Alfa ficticia',fullName:'Prueba Alfa',
    roleKey:'owner',roleName:'Propietario',
  };
  const valid=await auth.createInboxSessionToken(user);
  assert.equal((await auth.getInboxSession(valid)).companySlug, 'alfa');
  const altered=valid.split('.');
  const payload=JSON.parse(Buffer.from(altered[1],'base64url').toString('utf8'));
  payload.companyId='beta-id';
  altered[1]=Buffer.from(JSON.stringify(payload)).toString('base64url');
  assert.equal(await auth.getInboxSession(altered.join('.')),null, 'Tenant manipulation must invalidate signature');
  const forged=valid.split('.');
  const rolePayload=JSON.parse(Buffer.from(forged[1],'base64url').toString('utf8'));
  rolePayload.roleKey='platform_admin';
  forged[1]=Buffer.from(JSON.stringify(rolePayload)).toString('base64url');
  assert.equal(await auth.getInboxSession(forged.join('.')),null, 'Forged privileges must invalidate signature');
  process.env.CHATPRO_INBOX_SESSION_SECRET='different-synthetic-key-two';
  assert.equal(await auth.getInboxSession(valid),null,'Wrong signing key must fail');
  process.env.CHATPRO_INBOX_SESSION_SECRET='synthetic-ci-secret-one-for-test-only';
  const exp=valid.split('.');
  const expired=JSON.parse(Buffer.from(exp[1],'base64url').toString('utf8'));
  expired.exp=Date.now()-1000;
  const signed='v2.'+Buffer.from(JSON.stringify(expired)).toString('base64url');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(process.env.CHATPRO_INBOX_SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(signed));
  assert.equal(await auth.getInboxSession(signed+'.'+Buffer.from(signature).toString('base64url')),null,'Signed expired session must fail');
  assert.equal(await auth.getInboxSession('invalid'),null);
  assert.equal(await auth.getInboxSession(null),null);
  const users=fs.readFileSync('app/api/users/route.ts','utf8');
  const roles=fs.readFileSync('app/api/roles/route.ts','utf8');
  const login=fs.readFileSync('app/api/auth/login/route.ts','utf8');
  for(const [name,route] of [['users',users],['roles',roles]]) {
    assert.match(route,/MW1_STAGING_MODE === 'true' && session.type !== 'user'/);
    assert.match(route,/getInboxSession\(request.cookies.get\(INBOX_SESSION_COOKIE\)/);
    assert.match(route,/session.type === 'user' \? session.userId \|\| '' : ''/);
    assert.match(route,/session.companySlug/);
    assert.doesNotMatch(route,/headers:\s*\{[^}]*'x-chatpro-user-id':\s*request\./);
  }
  assert.match(login,/MW1_STAGING_MODE === 'true'/);
  assert.match(login,/All demo access must authenticate a real, company-bound user/);
  console.log('SEG-003B: 10 session-signature, expiry, tenant/role tampering and bootstrap checks passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
