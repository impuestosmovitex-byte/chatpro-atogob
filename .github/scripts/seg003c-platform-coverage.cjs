const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const api=fs.readFileSync('src/platform-admin.controller.ts','utf8');
const lines=api.split('\n');
const routes=[];
for(let n=0;n<lines.length;n++){
 const hit=lines[n].match(/^\s*@(Get|Post|Patch|Delete)\('([^']+)'\)/);
 if(!hit)continue;
 let stop=n+1;
 while(stop<lines.length&&!/^\s*@(Get|Post|Patch|Delete)\('/.test(lines[stop]))stop++;
 const text=lines.slice(n,stop).join('\n');
 routes.push({verb:hit[1].toUpperCase(),path:hit[2],text});
}
const exceptions=new Map([
 ['POST staging-admin-activate','Operator-issued staging invitation; pre-session bootstrap'],
 ['POST recovery-requests','Unauthenticated assisted recovery request; no password mutation'],
 ['GET plans/public','Internal, published commercial snapshot; no privileged user'],
]);
assert.equal(routes.length,35,'Reassess security classification when routes are added or removed');
const observed=new Set();
for(const route of routes){
 const id=route.verb+' '+route.path;
 assert(!observed.has(id),'Duplicate platform route '+id);
 observed.add(id);
 assert(route.text.includes('this.assertInternalKey('),'Missing internal key: '+id);
 if(exceptions.has(id)){
   assert(!route.text.includes('verifyInternalAttestation('),
     'Exceptional endpoint changed authorization policy without review: '+id);
   continue;
 }
 assert(route.text.includes("@Headers('x-mw1-internal-assertion')"),
  'Missing signature header: '+id);
 assert(route.text.includes('verifyInternalAttestation(identityAssertion,'),
  'Missing signed assertion verification: '+id);
 assert(route.text.includes("method: '"+route.verb+"'"),
  'Assertion method mismatch: '+id);
 assert(route.text.includes("path: '/platform-admin/"+route.path+"'"),
  'Assertion path mismatch: '+id);
 assert(route.text.includes("MW1_STAGING_MODE === 'true'"),
  'Missing staging assertion gate: '+id);
 if(id!=='GET me')assert(route.text.includes('await this.assertPlatformAdmin('),
  'Missing live platform admin role validation: '+id);
 const queryFields=[...route.text.matchAll(/@Query\('([^']+)'\)/g)]
   .map(x=>x[1]).filter(x=>x!=='user');
 if(queryFields.length)for(const field of queryFields)assert(
  route.text.includes('body: {'+field+'}') ||
  route.text.includes('body: { '+field+' }') ||
  route.text.includes('body: {month}') ||
  route.text.includes('body: {companyId}'),
  'Query field '+field+' not bound to signature: '+id
 );
 if(route.verb==='POST')assert(route.text.includes('body,')||route.text.includes('body: body'),
  'POST body not bound to signature: '+id);
}
assert.equal(observed.size,35);
for(const id of exceptions)assert(observed.has(id[0]),'Missing reviewed exception '+id[0]);
const webRoot=path.resolve('../../web-compatible');
const read=(file)=>fs.readFileSync(path.join(webRoot,file),'utf8');
const approvals=read('app/api/platform-admin/commercial-feature-approvals/route.ts');
assert(approvals.includes("'x-mw1-internal-assertion':signInternalAttestation("));
assert(approvals.includes("method,path:'/platform-admin/commercial-feature-approvals',body,"));
assert(approvals.includes("method:'GET'|'POST'"));
const special=read('app/api/auth/recovery/route.ts');
assert(special.includes('signInternalAttestation('));
const setup=read('app/api/staging-admin-setup/route.ts');
assert(!setup.includes('signInternalAttestation('));
console.log('SEG-003C platform route inventory: '+routes.length+' operations, '+(routes.length-exceptions.size)+' signed routes, '+exceptions.size+' reviewed exceptions.');
