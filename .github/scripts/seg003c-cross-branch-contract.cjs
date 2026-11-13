const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const ts = createRequire(path.resolve('package.json'))('typescript');
const { generateKeyPairSync, createPublicKey } = require('node:crypto');
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
process.env.MW1_INTERNAL_SINGLE_REPLICA_ACK = 'true';
process.env.MW1_INTERNAL_REPLICA_COUNT = '1';
const now=Date.now();
const user={kind:'user',userId:'alfa-owner',companyId:'alfa',companySlug:'alfa',
  method:'PATCH',path:'/users',body:{active:false,userId:'alfa-advisor'}};
const platform={kind:'platform',userId:'platform-operator',companyId:'',
  companySlug:'',method:'POST',path:'/platform-admin/companies',
  body:{name:'Fictional Alfa',slug:'fictional-alfa',maxUsers:2,ownerIdentifier:'fake'}};
const privileged=[
  ['/platform-admin/companies/owner-access',
   'app/api/platform-admin/companies/owners/route.ts'],
  ['/platform-admin/plans/publish',
   'app/api/platform-admin/plan-publish/route.ts'],
  ['/platform-admin/company-plan-activation-review',
   'app/api/platform-admin/company-plan-activation-review/route.ts'],
  ['/platform-admin/commercial-feature-approvals',
   'app/api/platform-admin/commercial-feature-approvals/route.ts'],
];
const apiController=fs.readFileSync('src/platform-admin.controller.ts','utf8');
const actions=[user,platform];
for(const [route,file] of privileged){
  const web=fs.readFileSync(path.resolve('../../web-compatible',file),'utf8');
  assert(web.includes("path:'"+route+"'")||web.includes("path: '"+route+"'"),
    'Web must sign '+route);
  assert(web.includes('signInternalAttestation('),'Missing web signature: '+route);
  assert(apiController.includes("path: '"+route+"'"),
    'API must validate signed action: '+route);
  actions.push({...platform,path:route,body:{action:'synthetic-only',companyId:'fake'}});
}
const additional=[
  ['/platform-admin/companies','GET','app/api/platform-admin/companies/route.ts',undefined],
  ['/platform-admin/companies/owners','GET','app/api/platform-admin/companies/owners/route.ts',undefined],
  ['/platform-admin/finance','GET','app/api/platform-admin/finance/route.ts',{month:'2026-11-01'}],
  ['/platform-admin/finance/companies','GET','app/api/platform-admin/finance/companies/route.ts',{month:'2026-11-01'}],
  ['/platform-admin/feature-preferences','GET','app/api/platform-admin/feature-preferences/route.ts',{companyId:'fake-company'}],
  ['/platform-admin/company-plan-assignment-readiness','GET','app/api/platform-admin/company-plan-assignment-readiness/route.ts',{companyId:'fake-company'}],
  ['/platform-admin/company-plan-activation-history','GET','app/api/platform-admin/company-plan-activation-history/route.ts',{companyId:'fake-company'}],
  ['/platform-admin/finance/scenario','POST','app/api/platform-admin/finance/route.ts',{kind:'scenario',input:1}],
  ['/platform-admin/finance/actual','POST','app/api/platform-admin/finance/route.ts',{kind:'actual',input:1}],
  ['/platform-admin/finance/company','POST','app/api/platform-admin/finance/companies/route.ts',{companyId:'fake-company',input:1}],
  ['/platform-admin/feature-preferences','POST','app/api/platform-admin/feature-preferences/route.ts',{companyId:'fake-company',key:'fake'}],
];
for(const [route,method,file,body] of additional){
  const web=fs.readFileSync(path.resolve('../../web-compatible',file),'utf8');
  assert(web.includes('signInternalAttestation('),'Unsigned '+file);
  assert(web.includes('x-mw1-internal-assertion'),'Missing signed header '+file);
  const pathFragment=route.startsWith('/platform-admin/finance/')?
     route.replace(/\/(scenario|actual)$/,''):route;
  assert(apiController.includes("path: '"+route+"'"), 'API route guard absent '+route);
  if(body&&method==='GET')assert(web.includes('body:'),'Query not bound: '+file);
  actions.push({...platform,method,path:route,body});
}
const further=[
 ['/platform-admin/recovery-requests','GET','app/api/auth/recovery/route.ts',undefined],
 ['/platform-admin/me','GET','app/api/platform-admin/me/route.ts',undefined],
 ['/platform-admin/mercadopago/verify-staging','GET','app/api/platform-admin/mercadopago-verify/route.ts',undefined],
 ['/platform-admin/company-plan-activation-request','POST','app/api/platform-admin/company-plan-activation-request/route.ts',{companyId:'fake'}],
 ['/platform-admin/company-plan-assignment-drafts','GET','app/api/platform-admin/company-plan-assignment-drafts/route.ts',undefined],
 ['/platform-admin/company-plan-assignment-drafts','POST','app/api/platform-admin/company-plan-assignment-drafts/route.ts',{companyId:'fake'}],
 ['/platform-admin/commercial-feature-drafts','GET','app/api/platform-admin/commercial-feature-drafts/route.ts',undefined],
 ['/platform-admin/commercial-feature-drafts','POST','app/api/platform-admin/commercial-feature-drafts/route.ts',{tier:'fake'}],
 ['/platform-admin/demo-requests','GET','app/api/platform-admin/demo-requests/route.ts',undefined],
 ['/platform-admin/demo-requests/follow-up','POST','app/api/platform-admin/demo-requests/route.ts',{id:'fake'}],
 ['/platform-admin/plans/drafts','GET','app/api/platform-admin/plan-drafts/route.ts',undefined],
 ['/platform-admin/plans/drafts','POST','app/api/platform-admin/plan-drafts/route.ts',{planKey:'fake'}],
 ['/platform-admin/ai-model-rates','GET','app/api/platform-admin/ai-model-rates/route.ts',undefined],
 ['/platform-admin/ai-model-rates','POST','app/api/platform-admin/ai-model-rates/route.ts',{model:'fake'}],
 ['/platform-admin/ai-usage','GET','app/api/platform-admin/ai-usage/route.ts',{companyId:'fake'}],
];
for(const [route,method,file,body] of further){
 const web=fs.readFileSync(path.resolve('../../web-compatible',file),'utf8');
 assert(web.includes('signInternalAttestation('),'Unsigned web route '+file);
 assert(web.includes('x-mw1-internal-assertion'),'Missing signed header '+file);
 assert(apiController.includes("path: '"+route+"'"),'Missing API attestation '+route);
 actions.push({...platform,method,path:route,body});
}
const otherControllers=[
  {api:'src/staging-subscription-admin.controller.ts',web:'app/api/admin/subscription-requests/route.ts',
   method:'GET',route:'/staging-subscription-admin',kind:'platform',body:undefined},
  {api:'src/staging-subscription-admin.controller.ts',web:'app/api/admin/subscription-requests/route.ts',
   method:'POST',route:'/staging-subscription-admin/review',kind:'platform',body:{requestId:'fake-id',decision:'approved',note:'synthetic'}},
  {api:'src/access.controller.ts',web:'app/api/auth/switch-company/route.ts',
   method:'POST',route:'/access/switch-company',kind:'user',body:{userId:'alfa-owner',companySlug:'beta'}},
];
for(const {api,web,method,route,kind,body} of otherControllers){
 const apiCode=fs.readFileSync(api,'utf8');
 const webCode=fs.readFileSync(path.resolve('../../web-compatible',web),'utf8');
 assert(apiCode.includes("path:'"+route+"'")||apiCode.includes("path: '"+route+"'"),
  'Missing API assertion '+route);
 assert(apiCode.includes('verifyInternalAttestation(identityAssertion'),
  'Missing API signature verification '+route);
 assert(webCode.includes("path:'"+route+"'")||webCode.includes("path: '"+route+"'"),
  'Missing web assertion '+route);
 assert(webCode.includes('signInternalAttestation('),
  'Missing web signer '+route);
 const action={kind,userId:kind==='platform'?'platform-operator':'alfa-owner',
   companyId:kind==='user'?'alfa':'',companySlug:kind==='user'?'alfa':'',
   method,path:route,body};
 actions.push(action);
}
const planEndpoints=[
  ['GET','/staging-my-plan','app/api/mi-plan/route.ts'],
  ['POST','/staging-my-plan/request','app/api/mi-plan/route.ts'],
  ['GET','/staging-my-plan/checkout-readiness','app/api/mi-plan/checkout-readiness/route.ts'],
  ['POST','/staging-my-plan/checkout-intent','app/api/mi-plan/checkout-intent/route.ts'],
  ['GET','/staging-my-plan/checkout-intent','app/api/mi-plan/checkout-intent/route.ts'],
  ['POST','/staging-my-plan/checkout-authorize','app/api/mi-plan/checkout-authorize/route.ts'],
];
const planApi=fs.readFileSync('src/staging-my-plan.controller.ts','utf8');
for(const [method,route,file] of planEndpoints){
 const web=fs.readFileSync(path.resolve('../../web-compatible',file),'utf8');
 assert(web.includes('signInternalAttestation(')&&web.includes('x-mw1-internal-assertion'),
  'Missing web signature '+file);
 assert(web.includes("method:'"+method+"'")&&web.includes("path:'"+route+"'"),
  'Mismatched signed web operation '+route);
 assert(planApi.includes("method:'"+method+"'")&&planApi.includes("path:'"+route+"'"),
  'Mismatched signed API operation '+route);
 const body=method==='POST'&&route.endsWith('checkout-authorize')
   ?{payerEmail:'test-only@example.com'}:method==='POST'&&route.endsWith('request')
   ?{type:'change_plan',planKey:'eco'}:undefined;
 actions.push({kind:'user',userId:'alfa-owner',companyId:'alfa',
  companySlug:'alfa',method,path:route,body});
}
assert(planApi.includes("select('active')")&&planApi.includes("select('role_id,active')"));
assert(planApi.includes("verifyInternalAttestation(identityAssertion"));
const clientApi=fs.readFileSync('src/staging-clients-readonly.controller.ts','utf8');
const clientWeb=fs.readFileSync(path.resolve('../../web-compatible','app/api/clients/route.ts'),'utf8');
for(const [route,body] of [
  ['/clients',{search:'test',limit:'30'}],
  ['/clients/profile',{phone:'3001111111'}],
]){
 assert(clientApi.includes("path:'"+route+"'"),'API client route not signed: '+route);
 assert(clientWeb.includes("'"+route+"'"),'Web client route not signed: '+route);
 assert(clientApi.includes('verifyInternalAttestation(identityAssertion,'));
 assert(clientWeb.includes('signInternalAttestation('));
 actions.push({kind:'user',userId:'alfa-advisor',companyId:'alfa',
  companySlug:'alfa',method:'GET',path:route,body});
}
const stagingInboxApi=fs.readFileSync('src/staging-inbox.controller.ts','utf8');
const inboxUrls=[
 ['GET','/inbox','app/api/inbox/route.ts','alfa','alfa'],
 ['GET','/inbox/instagram-pilot','app/api/inbox/instagram-pilot/route.ts','pilot-company','piloto-mw1-prueba'],
];
for(const [method,route,file,companyId,companySlug] of inboxUrls){
 const web=fs.readFileSync(path.resolve('../../web-compatible',file),'utf8');
 assert(web.includes("path:'"+route+"'"),'Web lacks signed inbox path '+route);
 assert(web.includes('signInternalAttestation('),'Web lacks signed inbox header '+route);
 assert(stagingInboxApi.includes("path:'"+route+"'"),'API lacks signed inbox path '+route);
 assert(stagingInboxApi.includes('verifyInternalAttestation(identityAssertion'),
  'API lacks signature enforcement '+route);
 actions.push({kind:'user',userId:'synthetic-advisor',companyId,companySlug,method,path:route});
}
assert(stagingInboxApi.includes("x.key==='inbox.view'"));
for(const action of actions){
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
console.log('SEG-003C cross-branch contract: '+(actions.length*6)+' assertions passed, synthetic keys only.');
