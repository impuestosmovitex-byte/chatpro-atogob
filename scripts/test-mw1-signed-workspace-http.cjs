'use strict';

/**
 * Disposable, authenticated HTTP integration test for MW1 Web.
 * Runs a local Next.js production server against a local *fake* API.
 * Every key, user, company, session and message is synthetic. No Railway,
 * Supabase, Meta, payments or production credentials are used.
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const sessionSecret = crypto.randomBytes(48).toString('hex');
const inboxKey = crypto.randomBytes(32).toString('hex');
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const companyA = {id:'synthetic-company-a',slug:'synthetic-mercado',name:'Mercado ficticio'};
const companyB = {id:'synthetic-company-b',slug:'synthetic-piloto',name:'Piloto ficticio'};
const actors = {
  owner: { userId:'fake-owner-a',company:companyA,roleKey:'owner',
    permissions:{inbox:true,clients:true,statistics:true,automations:true,configuration:true} },
  advisor: { userId:'fake-advisor-a',company:companyA,roleKey:'advisor',
    permissions:{inbox:true,clients:true,statistics:false,automations:false,configuration:false} },
  restricted: { userId:'fake-advisor-b',company:companyB,roleKey:'advisor',
    permissions:{inbox:false,clients:false,statistics:false,automations:false,configuration:false} },
};
const actorById = new Map(Object.values(actors).map(a=>[a.userId,a]));
const sessions = {
  a:{id:'session-synthetic-a',companyId:companyA.id,customerPhone:'000000000101'},
  b:{id:'session-synthetic-b',companyId:companyB.id,customerPhone:'000000000202'},
};
const observations = {assertions:0,paths:[]};
const json=(res,status,payload)=>{
  res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});
  res.end(JSON.stringify(payload));
};
const encode=(value)=>Buffer.from(JSON.stringify(value)).toString('base64url');
function signedCookie(actor){
  const payload=encode({
    v:2, exp:Date.now()+20*60*1000, type:'user',
    userId:actor.userId,companyId:actor.company.id,
    companySlug:actor.company.slug,companyName:actor.company.name,
    fullName:'Usuario ficticio',roleKey:actor.roleKey,
    roleName:actor.roleKey==='owner'?'Propietario':'Asesor',
  });
  const message='v2.'+payload;
  const signature=crypto.createHmac('sha256',sessionSecret).update(message).digest('base64url');
  return 'chatpro_inbox_session='+message+'.'+signature;
}
function verifyAssertion(req,pathname,actor){
  const token=req.headers['x-mw1-internal-assertion'];
  if(typeof token!=='string')return false;
  const parts=token.split('.');
  if(parts.length!==2)return false;
  try{
    const verified=crypto.verify(null,Buffer.from(parts[0]),
      publicKey,Buffer.from(parts[1],'base64url'));
    const claim=JSON.parse(Buffer.from(parts[0],'base64url').toString());
    const expected=pathname.startsWith('/inbox/')
      ?'/inbox/:sessionId':pathname;
    const now=Math.floor(Date.now()/1000);
    const pass=verified&&claim.v===1&&claim.kind==='user'&&
      claim.userId===actor.userId&&claim.companyId===actor.company.id&&
      claim.companySlug===actor.company.slug&&
      claim.method==='GET'&&claim.path===expected&&
      claim.iat<=now+5&&claim.exp>=now;
    if(pass)observations.assertions+=1;
    return pass;
  }catch{return false;}
}
const api=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  observations.paths.push(url.pathname);
  if(req.headers['x-chatpro-inbox-key']!==inboxKey)return json(res,401,{ok:false});
  if(url.pathname==='/access-capabilities'){
    const actor=actorById.get(url.searchParams.get('user'));
    if(!actor||actor.company.slug!==url.searchParams.get('company'))
      return json(res,403,{ok:false,error:'Empresa no autorizada'});
    return json(res,200,{ok:true,capabilities:actor.permissions});
  }
  const userId=req.headers['x-chatpro-user-id'];
  const actor=actorById.get(userId);
  if(!actor||actor.company.id!==req.headers['x-chatpro-company-id']||
     actor.company.slug!==url.searchParams.get('company'))
    return json(res,403,{ok:false,error:'Empresa ajena'});
  if(url.pathname.startsWith('/inbox')){
    if(!actor.permissions.inbox || !verifyAssertion(req,url.pathname,actor))
      return json(res,403,{ok:false,error:'Sin permiso de bandeja'});
    const session=url.pathname==='/inbox'?
      null:Object.values(sessions).find(s=>url.pathname==='/inbox/'+s.id);
    if(!session){
      if(url.pathname!=='/inbox')return json(res,403,{ok:false,error:'Conversacion no autorizada'});
      const visible=Object.values(sessions).filter(s=>s.companyId===actor.company.id);
      return json(res,200,{ok:true,sessions:visible,hasMore:false,stagingReadOnly:true});
    }
    if(session.companyId!==actor.company.id)
      return json(res,403,{ok:false,error:'Conversacion de otra empresa'});
    return json(res,200,{
      ok:true,company:actor.company,session,
      messages:[],historyRestricted:true,stagingReadOnly:true,synthetic:true,
    });
  }
  if(url.pathname==='/clients'){
    if(!actor.permissions.clients || !verifyAssertion(req,url.pathname,actor))
      return json(res,403,{ok:false,error:'Sin permiso de clientes'});
    return json(res,200,{ok:true,clients:[{customerPhone:'000000000101'}],
      company:actor.company,stagingReadOnly:true});
  }
  return json(res,404,{ok:false,error:'Ruta no simulada'});
});
const delay=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
async function run(){
  api.listen(0,'127.0.0.1');
  await once(api,'listening');
  const mockPort=api.address().port;
  // The fake API runs only on loopback, never on public staging.
  const port=Number(process.env.MW1_TEST_WEB_PORT||'31947');
  const host='http://127.0.0.1:'+port;
  const child=spawn(process.execPath,
    ['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','-p',String(port)],{
      cwd:process.cwd(),
      env:{...process.env,NODE_ENV:'production',MW1_STAGING_MODE:'true',
        CHATPRO_API_URL:'http://127.0.0.1:'+mockPort,
        CHATPRO_INBOX_KEY:inboxKey,
        CHATPRO_INBOX_SESSION_SECRET:sessionSecret,
        MW1_INTERNAL_ATTESTATION_PRIVATE_KEY:privateKey.export({format:'pem',type:'pkcs8'}).toString(),
        NEXT_TELEMETRY_DISABLED:'1'},
      stdio:['ignore','pipe','pipe'],
  });
  let stderr='';
  child.stderr.on('data',chunk=>{stderr+=chunk.toString();});
  try{
    let started=false;
    for(let i=0;i<80;i++){
      if(child.exitCode!==null)throw Error('Next.js exited early: '+stderr.slice(-700));
      try{
        const r=await fetch(host+'/api/health',{signal:AbortSignal.timeout(900)});
        if(r.status===200){started=true;break;}
      }catch{}
      await delay(250);
    }
    assert.ok(started,'Local Next.js did not start: '+stderr.slice(-800));
    async function get(path,cookie){
      return fetch(host+path,{headers:cookie?{cookie}:{},
        redirect:'manual',signal:AbortSignal.timeout(8000)});
    }
    let r=await get('/panel');
    assert.equal(r.status,307,'Anonymous users must be redirected to login');
    assert.match(r.headers.get('location')??'',/\/login/);
    r=await get('/api/inbox');
    assert.equal(r.status,401);

    for(const key of ['owner','advisor']){
      const actor=actors[key],cookie=signedCookie(actor);
      r=await get('/panel',cookie);
      assert.equal(r.status,200,key+' opens unified panel');
      r=await get('/api/auth/session',cookie);
      assert.equal(r.status,200);
      assert.equal((await r.json()).session.roleKey,actor.roleKey);
      r=await get('/api/auth/capabilities',cookie);
      assert.equal(r.status,200);
      const caps=(await r.json()).capabilities;
      assert.equal(caps.inbox,true);
      assert.equal(caps.clients,true);
      r=await get('/api/inbox',cookie);
      assert.equal(r.status,200,key+' opens own inbox');
      let data=await r.json();
      assert.equal(data.sessions.length,1);
      assert.equal(data.sessions[0].companyId,companyA.id);
      r=await get('/api/inbox?sessionId='+sessions.a.id,cookie);
      assert.equal(r.status,200,key+' opens fictitious detail');
      data=await r.json();
      assert.equal(data.stagingReadOnly,true);
      assert.deepEqual(data.messages,[]);
      r=await get('/api/inbox?sessionId='+sessions.b.id,cookie);
      assert.equal(r.status,403,key+' cannot read cross-company detail');
      r=await get('/api/clients',cookie);
      assert.equal(r.status,200,key+' can read permitted synthetic clients');
      r=await get('/api/platform-admin/companies',cookie);
      assert.equal(r.status,403,key+' cannot access platform admin');
      console.log('PASS synthetic authenticated '+key+' in '+companyA.slug);
    }
    const cookie=signedCookie(actors.restricted);
    r=await get('/panel',cookie);assert.equal(r.status,200);
    r=await get('/api/auth/capabilities',cookie);
    const capabilities=(await r.json()).capabilities;
    assert.equal(capabilities.inbox,false);
    assert.equal(capabilities.clients,false);
    r=await get('/api/inbox',cookie);assert.equal(r.status,403);
    r=await get('/api/clients',cookie);assert.equal(r.status,403);
    r=await get('/api/platform-admin/companies',cookie);assert.equal(r.status,403);
    console.log('PASS synthetic restricted advisor in '+companyB.slug);
    assert.ok(observations.assertions>=8,
      'All private Web->API requests must carry signed internal assertions');
    console.log('MW1 signed-session HTTP integration PASSED: owner, advisor, restricted advisor, tenant isolation, no data writes. Verified assertions: '+observations.assertions);
  }finally{
    child.kill('SIGTERM');
    await delay(180);
    api.close();
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;api.close();});
