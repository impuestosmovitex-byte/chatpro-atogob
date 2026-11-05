import assert from 'node:assert/strict';
import {
  createInboxSessionToken,
} from '../app/lib/inbox-auth.ts';
import {
  getMessengerPilotIdentityFromSessionCookie,
} from '../app/lib/staging-messenger-oauth-server-session.ts';

const oldSecret=process.env.CHATPRO_INBOX_SESSION_SECRET;
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
  if(oldSecret===undefined)delete process.env.CHATPRO_INBOX_SESSION_SECRET;
  else process.env.CHATPRO_INBOX_SESSION_SECRET=oldSecret;
}
