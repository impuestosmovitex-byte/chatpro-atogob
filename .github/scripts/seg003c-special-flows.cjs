const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const api=fs.readFileSync('src/platform-admin.controller.ts','utf8');
const webRoot=path.resolve('../../web-compatible');
const recovery=fs.readFileSync(path.join(webRoot,'app/api/auth/recovery/route.ts'),'utf8');
const publicPrices=fs.readFileSync(path.join(webRoot,'app/api/platform-admin/plan-published/route.ts'),'utf8');
const login=fs.readFileSync(path.join(webRoot,'app/api/auth/login/route.ts'),'utf8');
const staging=api.slice(api.indexOf("  @Post('staging-admin-activate')"),
  api.indexOf("  @Get('me')"));
const unauthRecovery=api.slice(api.indexOf("  @Post('recovery-requests')"),
  api.indexOf("  @Get('recovery-requests')"));
const adminRecovery=api.slice(api.indexOf("  @Get('recovery-requests')"),
  api.indexOf("  @Post('companies')"));
const prices=api.slice(api.indexOf("  @Get('plans/public')"),
  api.indexOf("  @Post('plans/publish')"));
const adminGet=recovery.slice(recovery.indexOf('export async function GET('));
const publicPost=recovery.slice(recovery.indexOf('export async function POST('),
  recovery.indexOf('export async function GET('));
assert(staging.includes('this.assertInternalKey(providedKey)'));
assert(staging.includes("if(admins>0)throw new UnauthorizedException"));
assert(staging.includes("is('used_at',null)"));
assert(staging.includes("gt('expires_at'"));
assert(!staging.includes('verifyInternalAttestation('),
  'Initial setup cannot require an existing platform session');
assert(unauthRecovery.includes('this.assertInternalKey(providedKey)'));
assert(unauthRecovery.includes("MW1_STAGING_MODE!=='true'"));
assert(unauthRecovery.includes('visitor_digest'));
assert(unauthRecovery.includes('(count??0)>=3'));
assert(!unauthRecovery.includes('updateUserById(') &&
  !unauthRecovery.includes('password_hash') &&
  !unauthRecovery.includes('verifyInternalAttestation('),
  'Public recovery must be only an assisted request');
assert(publicPost.includes("method:'POST'") &&
  !publicPost.includes("signInternalAttestation("),
  'Unauthenticated recovery POST must not require an admin signing identity');
assert(adminRecovery.includes('verifyInternalAttestation(identityAssertion,'));
assert(adminRecovery.includes("path: '/platform-admin/recovery-requests'"));
assert(adminGet.includes("session?.type!=='platform'"));
assert(adminGet.includes("signInternalAttestation({"));
assert(adminGet.includes("path:'/platform-admin/recovery-requests'"));
assert(prices.includes('this.assertInternalKey(providedKey)'));
assert(prices.includes('platform_published_plan_prices'));
assert(!prices.includes('verifyInternalAttestation('));
assert(publicPrices.includes("session?.type!=='platform'"));
assert(publicPrices.includes("'x-chatpro-inbox-key':inboxKey"));
assert(!publicPrices.includes('signInternalAttestation('));
assert(login.includes("Staging never enables the legacy shared bootstrap password."));
console.log('SEG-003C special-flow contract: 18 access-boundary assertions passed.');
