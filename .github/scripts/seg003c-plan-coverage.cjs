const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const api=fs.readFileSync('src/staging-my-plan.controller.ts','utf8');
const base=path.resolve('../../web-compatible');
const entries=[
  ['checkoutReadiness','GET','/staging-my-plan/checkout-readiness',"['owner']",'app/api/mi-plan/checkout-readiness/route.ts'],
  ['createCheckoutIntent','POST','/staging-my-plan/checkout-intent',"['owner']",'app/api/mi-plan/checkout-intent/route.ts'],
  ['getCheckoutIntent','GET','/staging-my-plan/checkout-intent',"['owner','admin']",'app/api/mi-plan/checkout-intent/route.ts'],
  ['authorizeCheckout','POST','/staging-my-plan/checkout-authorize',"['owner']",'app/api/mi-plan/checkout-authorize/route.ts'],
  ['requestChange','POST','/staging-my-plan/request',"['owner']",'app/api/mi-plan/route.ts'],
  ['get','GET','/staging-my-plan',"['owner','admin']",'app/api/mi-plan/route.ts'],
];
let count=0;
for(const [method,verb,route,role,webPath] of entries){
 const a=api.indexOf('  async '+method+'(');
 assert(a>=0,'Missing controller operation '+method);
 const end=api.indexOf('\n  }',a);
 assert(end>a,'Missing method end '+method);
 const chunk=api.slice(a,end);
 assert(chunk.includes("path:'"+route+"'"),'Controller route missing '+route);
 assert(chunk.includes("method:'"+verb+"'"),'Controller method mismatch '+route);
 assert(chunk.includes('await this.assertSignedPlanActor({'),'Identity guard absent '+route);
 assert(chunk.includes('allowedRoles:'+role),'Role policy changed '+route);
 const web=fs.readFileSync(path.resolve(base,webPath),'utf8');
 assert(web.includes("path:'"+route+"'"),'Web missing signed path '+route);
 assert(web.includes("method:'"+verb+"'"),'Web missing signed method '+route);
 assert(web.includes('x-mw1-internal-assertion'),'Missing assertion header '+webPath);
 count++;
}
assert.equal(count,6);
const guard=api.slice(api.indexOf('  private async assertSignedPlanActor('));
for(const marker of ["verifyInternalAttestation(identityAssertion","select('active')","select('role_id,active')","select('key,company_id')",
  "company.status!=='active'","member?.active!==true","profile?.active!==true"]){
 assert(guard.includes(marker),'Missing current authorization check: '+marker);
}
const checkout=api.slice(api.indexOf('  async authorizeCheckout('),api.indexOf("  @Post('request')"));
assert(checkout.includes("MW1_MP_TEST_CHECKOUT_ENABLED!=='true'"));
assert(checkout.includes("MW1_MP_SANDBOX_CREDENTIALS_CONFIRMED!=='true'"));
assert(checkout.indexOf('await this.assertSignedPlanActor(')<checkout.indexOf("fetch('https://api.mercadopago.com/preapproval'"));
assert(api.includes('checkoutEnabled:false')&&api.includes('cardRegistrationEnabled:false'));
console.log('SEG-003C plans gate: six route signatures, live role checks, checkout restrictions verified');
