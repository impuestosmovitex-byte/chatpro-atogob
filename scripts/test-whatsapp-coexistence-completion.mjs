import assert from 'node:assert/strict';
import { parseWhatsappSignupCompletion } from '../app/lib/whatsapp-coexistence-completion.ts';

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
console.log('WhatsApp coexistence completion parser: isolated offline mode separation and input validation passed.');
