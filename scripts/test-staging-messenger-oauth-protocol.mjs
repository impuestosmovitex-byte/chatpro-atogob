import assert from 'node:assert/strict';
import {
  MESSENGER_PILOT_SLUG,
  createMessengerPilotOAuthState,
  getMessengerPilotIdentity,
  parseMessengerPilotCallback,
  verifyMessengerPilotOAuthState,
} from '../app/lib/staging-messenger-oauth-protocol.ts';

const key='MW1_MESSENGER_OAUTH_STATE_SECRET';
const oldKey=process.env[key];
const oldNow=Date.now;
const instant=1800000000000;
const validSession = {
  type: 'user',
  roleKey: 'owner',
  companyId: 'offline-company',
  companySlug: MESSENGER_PILOT_SLUG,
  userId: 'offline-admin',
  expiresAt: instant + 60 * 60 * 1000,
};
try {
  Date.now=()=>instant;
  process.env[key]='LOCAL_TEST_ONLY_MW1_MESSENGER_OAUTH_SECRET_2026';
  const owner=getMessengerPilotIdentity(validSession);
  assert.ok(owner);
  assert.ok(getMessengerPilotIdentity({ ...validSession, roleKey: 'ADMIN' }));
  for(const edit of [
    {type:'bootstrap'}, {type:'platform'}, {roleKey:'viewer'},
    {companySlug:'another-company'}, {companyId:''},{userId:null},
    {expiresAt:instant-1},
  ]) assert.equal(getMessengerPilotIdentity({...validSession,...edit}),null);

  const state=createMessengerPilotOAuthState(owner);
  const another=createMessengerPilotOAuthState(owner);
  assert.notEqual(state,another,'State must use a fresh nonce');
  const verified=verifyMessengerPilotOAuthState(state,owner);
  assert.equal(verified?.companyId, owner.companyId);
  assert.equal(verified?.provider,'messenger');
  assert.equal(verified?.v,1);
  assert.match(verified?.nonce??'',/^[A-Za-z0-9_-]{32}$/);
  assert.equal(verifyMessengerPilotOAuthState(state,{...owner,userId:'other-user'}),null);
  assert.equal(verifyMessengerPilotOAuthState(state,{...owner,companyId:'other-company'}),null);
  assert.equal(verifyMessengerPilotOAuthState(state+'extra',owner),null);
  assert.equal(verifyMessengerPilotOAuthState(state+'.bad',owner),null);
  assert.equal(verifyMessengerPilotOAuthState('x'.repeat(2049),owner),null);

  const [encoded,signature]=state.split('.');
  const forged=JSON.parse(Buffer.from(encoded,'base64url').toString());
  forged.userId='attacker';
  const encodedForged=Buffer.from(JSON.stringify(forged)).toString('base64url');
  assert.equal(verifyMessengerPilotOAuthState(encodedForged+'.'+signature,owner),null);

  const callback=query=>parseMessengerPilotCallback(
    new URLSearchParams(query),owner,state);
  const good=callback({code:'synthetic-code',state});
  assert.deepEqual(good,{valid:true,code:'synthetic-code',state});
  const rejected=[
    [ {state},'missing_code' ],
    [ {state,code:''},'invalid_parameters' ],
    [ {state,code:'   '},'invalid_parameters' ],
    [ {state,code:'x'.repeat(4097)},'invalid_parameters' ],
    [ {code:'code'},'invalid_parameters' ],
    [ [['code','a'],['code','b'],['state',state]],'invalid_parameters' ],
    [ [['code','a'],['state',state],['state',state]],'invalid_parameters' ],
    [ {state,code:'a',error:'denied'},'invalid_parameters' ],
    [ {state,error:'access_denied',error_description:'sensitive-attack-data'},'provider_denied' ],
    [ {state,error_description:'orphan'},'invalid_parameters' ],
    [ {state:'incorrect',code:'ok'},'invalid_state' ],
  ];
  for(const [params,reason] of rejected) {
    assert.deepEqual(callback(params),{valid:false,reason});
  }
  assert.deepEqual(parseMessengerPilotCallback(new URLSearchParams({state,code:'x'}),owner,'wrong-cookie'),{valid:false,reason:'invalid_state'});

  Date.now=()=>instant+10*60*1000;
  assert.ok(verifyMessengerPilotOAuthState(state,owner));
  Date.now=()=>instant+10*60*1000+1;
  assert.equal(verifyMessengerPilotOAuthState(state,owner),null);
  assert.deepEqual(callback({state,code:'test'}),{valid:false,reason:'invalid_state'});
  Date.now=()=>instant-1;
  assert.equal(verifyMessengerPilotOAuthState(state,owner),null);

  Date.now=oldNow;
  process.env[key]='short';
  assert.throws(()=>createMessengerPilotOAuthState(owner),/clave segura/);
  assert.deepEqual(parseMessengerPilotCallback(new URLSearchParams({state,code:'ok'}),owner,state),{valid:false,reason:'invalid_state'});
  console.log('MW1 Messenger OAuth protocol offline checks passed: tenant role, signed state, expiry, cookie, query parameters and provider denial.');
} finally {
 Date.now=oldNow;
 if(oldKey===undefined) delete process.env[key]; else process.env[key]=oldKey;
}
