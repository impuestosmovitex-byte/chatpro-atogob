import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const code=readFileSync(new URL('../app/configuracion/integraciones/WhatsappEmbeddedSignupButton.tsx',import.meta.url),'utf8');
const coexist=code.indexOf("if (payload.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING') {");
const conventional=code.indexOf("if (payload.event === 'FINISH') {");
assert.ok(coexist>0,'Must explicitly identify coexistence completion');
assert.ok(conventional>coexist,'Conventional completion must be handled separately');
const guarded=code.slice(coexist,conventional);
assert.match(guarded,/fail\(new Error\(/,'Coexistence must stop the conventional signup');
assert.match(guarded,/return;/,'Coexistence must return before conventional signup');
assert.doesNotMatch(guarded,/completeSignup\(/,'Coexistence must not call conventional provisioning');
assert.match(code.slice(conventional,conventional+750),/session\s*=\s*\{/,
  'Regular Meta FINISH continues through existing session handling');
assert.match(code,/await completeSignup\(authCode, session\)/,
  'Regular WhatsApp signup remains wired to its original endpoint');
console.log('WhatsApp conventional completion remains isolated from coexistence; no migration via normal signup.');
