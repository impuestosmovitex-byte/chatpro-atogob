import assert from 'node:assert/strict';
import { planWhatsappCoexistenceSync } from '../app/lib/whatsapp-coexistence-sync-policy.ts';

const connectedAt=1800000000000;
const base={
  companyId:'11111111-1111-4111-8111-111111111111',
  sessionCompanyId:'11111111-1111-4111-8111-111111111111',
  phoneNumberId:'123456789012345',
  ownedPhoneNumberId:'123456789012345',
  onboardingId:'22222222-2222-4222-8222-222222222222',
  mode:'coexistence',registrationActive:true,webhooksSubscribed:true,
  adminAuthorized:true,consentToShare:true,
  kind:'history',priorState:'never_requested',
  onboardedAtMs:connectedAt,nowMs:connectedAt+1000,
};
const decide=(edit={})=>planWhatsappCoexistenceSync({...base,...edit});
const allowed=decide();
assert.equal(allowed.allowed,true);
assert.equal(allowed.syncType,'history');
assert.equal(allowed.expiresAtMs,connectedAt+24*60*60*1000);
assert.equal(allowed.idempotencyKey,[
  base.companyId,base.onboardingId,base.phoneNumberId,'history',
].join(':'));
assert.deepEqual(decide({consentToShare:false}),{allowed:false,reason:'consent_required'});
assert.deepEqual(decide({adminAuthorized:false}),{allowed:false,reason:'not_authorized'});
assert.deepEqual(decide({webhooksSubscribed:false}),{allowed:false,reason:'not_ready'});
assert.deepEqual(decide({registrationActive:false}),{allowed:false,reason:'not_ready'});
assert.deepEqual(decide({mode:'cloud_api'}),{allowed:false,reason:'not_coexistence'});
assert.deepEqual(decide({sessionCompanyId:'33333333-3333-4333-8333-333333333333'}),{
  allowed:false,reason:'tenant_mismatch',
});
assert.deepEqual(decide({ownedPhoneNumberId:'999999999999999'}),{
  allowed:false,reason:'phone_mismatch',
});
assert.deepEqual(decide({nowMs:connectedAt-1}),{allowed:false,reason:'window_closed'});
assert.equal(decide({nowMs:connectedAt+24*60*60*1000-1}).allowed,true);
assert.deepEqual(decide({nowMs:connectedAt+24*60*60*1000}),{
  allowed:false,reason:'window_closed',
});
for(const priorState of ['reserved','requested','completed','declined',
  'window_closed','failed_unknown',undefined]) {
  assert.deepEqual(decide({priorState}),{allowed:false,reason:'already_attempted'});
}
assert.equal(decide({kind:'smb_app_state_sync'}).allowed,true);
assert.notEqual(decide({kind:'smb_app_state_sync'}).idempotencyKey,allowed.idempotencyKey);
assert.equal(decide({kind:'history'}).idempotencyKey,allowed.idempotencyKey,
  'Repeated planning has stable key; persistent DB uniqueness is still required');
assert.notEqual(decide({onboardingId:'44444444-4444-4444-8444-444444444444'}).idempotencyKey,
  allowed.idempotencyKey);
for(const edit of [
  {companyId:'not-a-uuid'}, {sessionCompanyId:''},
  {onboardingId:'invalid'}, {phoneNumberId:'not-a-number'},
  {ownedPhoneNumberId:'x'}, {kind:'unknown'},
  {nowMs:Number.NaN}, {onboardedAtMs:undefined},
  {consentToShare:undefined}, {registrationActive:undefined},
]) {
  assert.deepEqual(decide(edit),{allowed:false,reason:'invalid_context'});
}
assert.deepEqual(planWhatsappCoexistenceSync(null),{
  allowed:false,reason:'invalid_context',
});
console.log('MW1 WhatsApp coexistence sync: consent, 24h one-time window, ownership, readiness and stable idempotency keys passed offline.');
