import assert from 'node:assert/strict';
import { parseWhatsappSignupCompletion, matchWhatsappSignupMode } from '../app/lib/whatsapp-coexistence-completion.ts';
import { buildWhatsappSignupLaunchOptions } from '../app/lib/whatsapp-coexistence-launch.ts';

const origin='https://www.facebook.com';
const message=(event, data)=>JSON.stringify({
  type:'WA_EMBEDDED_SIGNUP',event,data,
});
const payload={ waba_id:'123456789012',phone_number_id:'987654321012',business_id:'567890123456' };
assert.deepEqual(parseWhatsappSignupCompletion(origin,message('FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',payload)),{
  mode:'coexistence',wabaId:payload.waba_id,
  phoneNumberId:payload.phone_number_id,businessId:payload.business_id,
});
assert.deepEqual(parseWhatsappSignupCompletion(origin,message('FINISH',payload)),{
  mode:'cloud_api',wabaId:payload.waba_id,
  phoneNumberId:payload.phone_number_id,businessId:payload.business_id,
});
assert.deepEqual(parseWhatsappSignupCompletion(origin,message('FINISH',{waba_id:payload.waba_id})),{
  mode:'cloud_api',wabaId:payload.waba_id,phoneNumberId:null,businessId:null,
});
for(const badOrigin of ['http://facebook.com','https://facebook.com.attacker.tld',
  'https://evil.com','https://facebook.com/path','invalid']) {
  assert.equal(parseWhatsappSignupCompletion(badOrigin,message('FINISH',payload)),null);
}
for(const bad of [
  message('CANCEL',payload),message('ERROR',payload),
  message('FINISH',{...payload,waba_id:'abc'}),
  message('FINISH',{...payload,phone_number_id:'not-number'}),
  message('FINISH',{...payload,business_id:123}),
  JSON.stringify({type:'OTHER',event:'FINISH',data:payload}),
  JSON.stringify({type:'WA_EMBEDDED_SIGNUP',event:'FINISH',data:null}),
  '{invalid', 'x'.repeat(10001),
]) assert.equal(parseWhatsappSignupCompletion(origin,bad),null);
assert.equal(parseWhatsappSignupCompletion(origin,{type:'WA_EMBEDDED_SIGNUP'}),null);
const coexistence=parseWhatsappSignupCompletion(
  origin,message('FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',payload));
const conventional=parseWhatsappSignupCompletion(origin,message('FINISH',payload));
assert.deepEqual(matchWhatsappSignupMode(coexistence,'coexistence'),coexistence);
assert.deepEqual(matchWhatsappSignupMode(conventional,'cloud_api'),conventional);
assert.equal(matchWhatsappSignupMode(coexistence,'cloud_api'),null,
  'A coexistence event must not silently become a conventional signup');
assert.equal(matchWhatsappSignupMode(conventional,'coexistence'),null,
  'A conventional event must not silently become a phone migration');
assert.equal(matchWhatsappSignupMode(coexistence,undefined),null,
  'No implied opt-in to coexistence without explicit selection');
assert.equal(matchWhatsappSignupMode(
  parseWhatsappSignupCompletion(origin,message('FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
    {waba_id:payload.waba_id})), 'coexistence'),null,
  'Coexistence cannot guess a WhatsApp Business App phone number');
const normalOptions=buildWhatsappSignupLaunchOptions('123456789','cloud_api');
assert.deepEqual(normalOptions,{
  config_id:'123456789',response_type:'code',
  override_default_response_type:true,extras:{},
});
const coexistenceOptions=buildWhatsappSignupLaunchOptions('123456789','coexistence');
assert.deepEqual(coexistenceOptions,{
  config_id:'123456789',response_type:'code',
  override_default_response_type:true,
  extras:{setup:{},featureType:'whatsapp_business_app_onboarding',sessionInfoVersion:'3'},
});
assert.deepEqual(normalOptions.extras,{},'Conventional signup must retain its original extras');
assert.throws(()=>buildWhatsappSignupLaunchOptions('not-id','coexistence'),/Invalid/);
assert.throws(()=>buildWhatsappSignupLaunchOptions('123456789','unknown'),/Unknown/);
console.log('WhatsApp coexistence completion parser: isolated offline mode separation and input validation passed.');
