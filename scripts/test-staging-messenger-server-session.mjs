import assert from 'node:assert/strict';
import { createMessengerPilotOAuthState } from '../app/lib/staging-messenger-oauth-protocol.ts';
import {
  createInboxSessionToken,
} from '../app/lib/inbox-auth.ts';
import {
  getMessengerPilotIdentityFromSessionCookie,
  verifyMessengerPilotCallbackFromServerCookies,
  consumeMessengerPilotCallbackOffline,
  prepareMessengerPilotStartOffline,
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
  let registrations=0;
  const registered=await prepareMessengerPilotStartOffline(token,async(identity,signed)=>{
    registrations++;
    assert.equal(identity.companyId,session.companyId);
    assert.equal(identity.userId,session.userId);
    assert.match(signed,/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });
  assert.equal(typeof registered,'string');
  assert.equal(registrations,1);
  assert.equal(await prepareMessengerPilotStartOffline(null,async()=>{registrations++;}),null);
  assert.equal(await prepareMessengerPilotStartOffline(
    await createInboxSessionToken({...session,roleKey:'viewer'}),
    async()=>{registrations++;}
  ),null);
  assert.equal(registrations,1,'No register call for unauthorized sessions');
  assert.equal(await prepareMessengerPilotStartOffline(token,
    async()=>{throw Error('staging nonce store failed');}),null);
  assert.equal(await prepareMessengerPilotStartOffline(token,undefined),null);
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
  const spent=new Set();
  let attempts=0;
  const atomicConsume=async(identity,signedState,cookie)=>{
    attempts++;
    assert.equal(identity.companyId,session.companyId);
    assert.equal(identity.userId,session.userId);
    assert.equal(cookie,state);
    if(spent.has(signedState))throw Error('replayed');
    spent.add(signedState);
  };
  assert.deepEqual(await consumeMessengerPilotCallbackOffline(token,state,returned,atomicConsume),{
    valid:true,code:'synthetic-code',state,
  });
  assert.deepEqual(await consumeMessengerPilotCallbackOffline(token,state,returned,atomicConsume),{
    valid:false,reason:'invalid_state',
  });
  assert.equal(attempts,2);
  assert.deepEqual(await consumeMessengerPilotCallbackOffline(token,'wrong',returned,atomicConsume),{
    valid:false,reason:'invalid_state',
  });
  assert.deepEqual(await consumeMessengerPilotCallbackOffline(null,state,returned,atomicConsume),{
    valid:false,reason:'invalid_state',
  });
  assert.deepEqual(await consumeMessengerPilotCallbackOffline(token,state,
    new URLSearchParams({state,error:'access_denied'}),atomicConsume),{
    valid:false,reason:'provider_denied',
  });
  const otherTenantSession=await createInboxSessionToken({
    ...session, companyId:'33333333-3333-4333-8333-333333333333',
  });
  assert.deepEqual(await consumeMessengerPilotCallbackOffline(
    otherTenantSession,state,returned,atomicConsume),{
    valid:false,reason:'invalid_state',
  });
  assert.deepEqual(await consumeMessengerPilotCallbackOffline(
    token,'x'.repeat(2049),returned,atomicConsume),{
    valid:false,reason:'invalid_state',
  });
  assert.equal(attempts,2,'Rejected callbacks must never consume a nonce');
  assert.deepEqual(await consumeMessengerPilotCallbackOffline(token,state,returned,
    async()=>{throw Error('database unavailable')}),{
    valid:false,reason:'invalid_state',
  });
  assert.deepEqual(await consumeMessengerPilotCallbackOffline(token,state,returned,undefined),{
    valid:false,reason:'invalid_state',
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
