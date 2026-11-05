import assert from 'node:assert/strict';
import { createMessengerPilotOAuthState } from '../app/lib/staging-messenger-oauth-protocol.ts';
import {
  createInboxSessionToken,
} from '../app/lib/inbox-auth.ts';
import {
  getMessengerPilotIdentityFromSessionCookie,
  verifyMessengerPilotCallbackFromServerCookies,
} from '../app/lib/staging-messenger-oauth-server-session.ts';

const oldSecret=process.env.CHATPRO_INBOX_SESSION_SECRET;
const oldMessengerSecret=process.env.MW1_MESSENGER_OAUTH_STATE_SECRET;
const oldNow=Date.now;
const instant=1800000000000;
const session={
  type:'user',
  userId:'22222222-2222-4222-8222-222222222222',
  companyId:'11111111-1111-4111-8111-111111111111',
  companySlug:'piloto-mw1-prueba',
  companyName:'MW1 piloto',
  fullName:'Synthetic admin',
  roleKey:'owner',
  roleName:'Owner',
};
try {
  Date.now=()=>instant;
  process.env.CHATPRO_INBOX_SESSION_SECRET='OFFLINE_SYNTHETIC_INBOX_SESSION_SECRET_ONLY_FOR_TESTS';
  process.env.MW1_MESSENGER_OAUTH_STATE_SECRET='OFFLINE_SYNTHETIC_MESSENGER_OAUTH_STATE_SECRET_FOR_TESTS';
  const token=await createInboxSessionToken(session);
  const valid=await getMessengerPilotIdentityFromSessionCookie(token);
  assert.deepEqual(valid,{
    companyId:session.companyId,userId:session.userId,companySlug:session.companySlug,
  });
  for(const change of [
    {roleKey:'viewer'}, {type:'platform'}, {type:'bootstrap'},
    {companySlug:'another-business'}, {companyId:'not-a-uuid'},
    {userId:'not-a-uuid'},
  ]) {
    const other=await createInboxSessionToken({...session,...change});
    assert.equal(await getMessengerPilotIdentityFromSessionCookie(other),null);
  }
  const state=createMessengerPilotOAuthState(valid);
  const returned=new URLSearchParams({code:'synthetic-code',state});
  assert.deepEqual(await verifyMessengerPilotCallbackFromServerCookies(token,state,returned),{
    valid:true,code:'synthetic-code',state,
  });
  assert.deepEqual(await verifyMessengerPilotCallbackFromServerCookies(token,'wrong-state',returned),{
    valid:false,reason:'invalid_state',
  });
  assert.deepEqual(await verifyMessengerPilotCallbackFromServerCookies(null,state,returned),{
    valid:false,reason:'invalid_state',
  });
  assert.deepEqual(await verifyMessengerPilotCallbackFromServerCookies(token,state,
    new URLSearchParams({state,error:'access_denied',error_description:'DO_NOT_ECHO_SECRET'})),{
    valid:false,reason:'provider_denied',
  });
  const duplicate=new URLSearchParams([['code','one'],['code','two'],['state',state]]);
  assert.deepEqual(await verifyMessengerPilotCallbackFromServerCookies(token,state,duplicate),{
    valid:false,reason:'invalid_parameters',
  });
  const foreign=await createInboxSessionToken({...session,companyId:'33333333-3333-4333-8333-333333333333'});
  assert.deepEqual(await verifyMessengerPilotCallbackFromServerCookies(foreign,state,returned),{
    valid:false,reason:'invalid_state',
  });
  assert.equal(await getMessengerPilotIdentityFromSessionCookie(null),null);
  assert.equal(await getMessengerPilotIdentityFromSessionCookie('invalid'),null);
  assert.equal(await getMessengerPilotIdentityFromSessionCookie('x'.repeat(8193)),null);
  assert.equal(await getMessengerPilotIdentityFromSessionCookie(token.slice(0,-1)+'!'),null);
  Date.now=()=>instant+12*60*60*1000+1;
  assert.equal(await getMessengerPilotIdentityFromSessionCookie(token),null);
  Date.now=()=>instant;
  delete process.env.CHATPRO_INBOX_SESSION_SECRET;
  assert.equal(await getMessengerPilotIdentityFromSessionCookie(token),null);
  console.log('MW1 Messenger offline server-session checks passed: signed cookie, tenant, role, expiry and invalid input.');
} finally {
  Date.now=oldNow;
  if(oldMessengerSecret===undefined)delete process.env.MW1_MESSENGER_OAUTH_STATE_SECRET;
  else process.env.MW1_MESSENGER_OAUTH_STATE_SECRET=oldMessengerSecret;
  if(oldSecret===undefined)delete process.env.CHATPRO_INBOX_SESSION_SECRET;
  else process.env.CHATPRO_INBOX_SESSION_SECRET=oldSecret;
}
