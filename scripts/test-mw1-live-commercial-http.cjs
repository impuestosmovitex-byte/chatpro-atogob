'use strict';
const assert=require('node:assert/strict');
const base='https://mw1-web-staging-staging.up.railway.app';
async function request(path,opts={}){
  const res=await fetch(base+path,{redirect:'manual',signal:AbortSignal.timeout(20000),...opts});
  return {res,html:await res.text()};
}
(async()=>{
  const checks=[
    ['/inicio',['ChatPro MW1','Solicitar demostración']],
    ['/por-que',['video','MW1']],
    ['/demo',['Bandeja omnicanal','MW1']],
    ['/integraciones',['Integraciones']],
    ['/agendar-demo',['WhatsApp','Enviar solicitud de demostración']],
  ];
  for(const [path,terms] of checks){
    const {res,html}=await request(path);
    assert.equal(res.status,200,path+' expected 200 got '+res.status+' '+html.slice(0,160));
    for(const term of terms)assert.ok(html.toLowerCase().includes(term.toLowerCase()),path+' missing '+term);
    if(path==='/inicio'||path==='/integraciones')assert.ok(!html.includes('Telegram'),path+' still mentions Telegram');
    console.log('OK',path,res.status,html.length);
  }
  const logo=await request('/media/mw1-official-logo.svg');
  assert.equal(logo.res.status,200,'official logo absent');
  assert.ok(logo.html.includes('ChatPro MW1'),'official logo not present');
  console.log('OK official logo');
  const admin=await request('/admin/prospectos');
  assert.ok([200,301,302,303,307,308,401,403].includes(admin.res.status),'unexpected admin HTTP '+admin.res.status);
  if(admin.res.status===200)
    assert.ok(!admin.html.includes('MW1 QA NO CONTACTAR'),'unauthenticated visitor must not view prospect data');
  console.log('OK guarded admin prospect route',admin.res.status);
  const payload={
    companyName:'MW1 QA NO CONTACTAR',
    contactName:'Prueba sintetica MW1',
    contactEmail:'mw1-pr45-integration-test-20261114@example.org',
    contactPhone:'+570000000000',
    planInterest:'sin_definir',
    requestType:'demo',
    businessSector:'',
    hasOnlineStore:'',
    marketingConsent:false,
    consent:true,
    requestedUsers:null,
    requestedConnections:null,
    whatsappSetup:'unsure',
    website:'',
  };
  const lead=await request('/api/marketing/demo-request',{
    method:'POST',headers:{'content-type':'application/json','origin':base},
    body:JSON.stringify(payload),
  });
  let parsed;try{parsed=JSON.parse(lead.html);}catch{parsed={};}
  assert.equal(lead.res.status,200,'lead submit HTTP '+lead.res.status+' '+lead.html.slice(0,300));
  assert.equal(parsed.ok,true,'lead submission rejected: '+lead.html.slice(0,300));
  console.log('OK commercial submission responded successfully (DB readback required separately)');
})().catch(error=>{console.error(error);process.exitCode=1;});
