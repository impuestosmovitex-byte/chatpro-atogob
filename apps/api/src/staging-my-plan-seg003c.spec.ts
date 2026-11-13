import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {StagingMyPlanController} from './staging-my-plan.controller';

describe('SEG-003C plans: two synthetic companies, roles and one-time signatures',()=>{
 const old={key:process.env.CHATPRO_INBOX_KEY,staging:process.env.MW1_STAGING_MODE,
  pub:process.env.MW1_INTERNAL_ATTESTATION_PUBLIC_KEY,ack:process.env.MW1_INTERNAL_SINGLE_REPLICA_ACK,
  replicas:process.env.MW1_INTERNAL_REPLICA_COUNT};
 const keyPair=generateKeyPairSync('ed25519');
 const users={alice:'alice-user',bob:'bob-user'};
 const firms={alfa:'alfa-company',beta:'beta-company'};
 const roles:Record<string,string>={[users.alice]:'owner',[users.bob]:'admin'};
 const active:Record<string,boolean>={[users.alice]:true,[users.bob]:true};
 const members:Record<string,boolean>={[users.alice]:true,[users.bob]:true};
 const tenant:Record<string,string>={[users.alice]:firms.alfa,[users.bob]:firms.beta};
 const companyStatus:Record<string,string>={[firms.alfa]:'active',[firms.beta]:'active'};
 const queries:Array<{table:string;filter:Record<string,unknown>}>=[];

 const db={
  from(table:string){
   const filter:Record<string,unknown>={};
   const q={
    select(_fields:string){return q;},
    eq(k:string,v:unknown){filter[k]=v;return q;},
    async maybeSingle(){
     queries.push({table,filter:{...filter}});
     if(table==='companies'){
       const id=String(filter.id||'');
       return {data:id in companyStatus&&filter.slug===(id===firms.alfa?'alfa':'beta')
         ?{id,slug:filter.slug,status:companyStatus[id]}:null,error:null};
     }
     if(table==='app_profiles')return {data:active[String(filter.user_id)]
       ===undefined?null:{active:active[String(filter.user_id)]},error:null};
     if(table==='company_memberships'){
       const uid=String(filter.user_id);
       return {data:tenant[uid]===filter.company_id&&members[uid]
         ?{role_id:uid+'-role',active:members[uid]}:null,error:null};
     }
     if(table==='app_roles'){
       const uid=String(filter.id).replace(/-role$/,'');
       return {data:roles[uid]?{key:roles[uid],company_id:tenant[uid]}:null,error:null};
     }
     return {data:null,error:null};
    }
   };return q;
  }
 };
 const controller=new StagingMyPlanController({getClient:()=>db} as any);
 const action=(userId=users.alice,companyId=firms.alfa,method:'GET'|'POST'='GET',
   path='/staging-my-plan',body?:unknown)=>({
    kind:'user' as const,userId,companyId,
    companySlug:companyId===firms.alfa?'alfa':'beta',method,path,body,
   });
 const stable=(value:any):string=>value==null?'null':typeof value!=='object'?JSON.stringify(value):
   Array.isArray(value)?'['+value.map(stable).join(',')+']':
     '{'+Object.keys(value).filter(k=>value[k]!==undefined).sort()
      .map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
 function token(a:ReturnType<typeof action>){
   const iat=Math.floor(Date.now()/1000);
   const {body,...signed}=a;
   const claim={v:1,...signed,iat,exp:iat+20,nonce:randomBytes(16).toString('hex'),
     bodyHash:createHash('sha256').update(stable(body)).digest('hex')};
   const raw=Buffer.from(JSON.stringify(claim)).toString('base64url');
   return raw+'.'+sign(null,Buffer.from(raw),keyPair.privateKey).toString('base64url');
 }
 async function permit(a:ReturnType<typeof action>,opts?:{token?:string;allowedRoles?:string[]}){
   return (controller as any).assertSignedPlanActor({
    key:'test-key',userId:a.userId,companyId:a.companyId,slug:a.companySlug,
    identityAssertion:opts?.token??token(a),method:a.method,path:a.path,body:a.body,
    allowedRoles:opts?.allowedRoles??['owner','admin'],
   });
 }
 beforeAll(()=>{
  process.env.CHATPRO_INBOX_KEY='test-key';
  process.env.MW1_STAGING_MODE='true';
  process.env.MW1_INTERNAL_ATTESTATION_PUBLIC_KEY=
    keyPair.publicKey.export({type:'spki',format:'pem'}).toString();
  process.env.MW1_INTERNAL_SINGLE_REPLICA_ACK='true';
  process.env.MW1_INTERNAL_REPLICA_COUNT='1';
 });
 beforeEach(()=>{
  active[users.alice]=true;active[users.bob]=true;
  members[users.alice]=true;members[users.bob]=true;
  roles[users.alice]='owner';roles[users.bob]='admin';
  companyStatus[firms.alfa]='active';companyStatus[firms.beta]='active';queries.length=0;
 });
 afterAll(()=>{
  const pairs:[string,string|undefined][]=[
   ['CHATPRO_INBOX_KEY',old.key],['MW1_STAGING_MODE',old.staging],
   ['MW1_INTERNAL_ATTESTATION_PUBLIC_KEY',old.pub],
   ['MW1_INTERNAL_SINGLE_REPLICA_ACK',old.ack],['MW1_INTERNAL_REPLICA_COUNT',old.replicas]];
  for(const [k,v] of pairs){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 });
 it('covers all 6 distinct plan operation contracts',async()=>{
  for(const [method,path] of [
    ['GET','/staging-my-plan'],['POST','/staging-my-plan/request'],
    ['GET','/staging-my-plan/checkout-readiness'],
    ['POST','/staging-my-plan/checkout-intent'],
    ['GET','/staging-my-plan/checkout-intent'],
    ['POST','/staging-my-plan/checkout-authorize'],
  ] as const){
   const body=method==='POST'&&path.includes('authorize')?{payerEmail:'synthetic@example.com'}:
     method==='POST'&&path.endsWith('request')?{type:'change_plan',planKey:'eco'}:undefined;
   await expect(permit(action(users.alice,firms.alfa,method,path,body))).resolves.toBeUndefined();
  }
 });
 it('rejects a user from company Alfa trying to read Beta even if header is changed',async()=>{
   const alfa=action(),beta=action(users.alice,firms.beta);
   await expect(permit(beta,{token:token(alfa)})).rejects.toThrow();
   await expect(permit(beta)).rejects.toThrow();
 });
 it('rejects revoked memberships, inactive profiles and inactive companies',async()=>{
   const a=action();
   members[users.alice]=false;await expect(permit(a)).rejects.toThrow();
   members[users.alice]=true;active[users.alice]=false;await expect(permit(a)).rejects.toThrow();
   active[users.alice]=true;companyStatus[firms.alfa]='inactive';await expect(permit(a)).rejects.toThrow();
 });
 it('allows tenant admin only for the two read operations, not owner-only mutations',async()=>{
   const a=action(users.bob,firms.beta);
   await expect(permit(a,{allowedRoles:['owner','admin']})).resolves.toBeUndefined();
   await expect(permit(a,{allowedRoles:['owner']})).rejects.toThrow();
 });
 it('rejects tampered body, operation, cross-company switch and replay',async()=>{
   const a=action(users.alice,firms.alfa,'POST','/staging-my-plan/request',{type:'change_plan',planKey:'eco'});
   const t=token(a);
   await expect(permit({...a,body:{type:'change_plan',planKey:'pro'}},{token:t})).rejects.toThrow();
   await expect(permit({...a,path:'/staging-my-plan/checkout-authorize'},{token:t})).rejects.toThrow();
   await expect(permit({...a,companyId:firms.beta,companySlug:'beta'},{token:t})).rejects.toThrow();
   await expect(permit(a,{token:t})).resolves.toBeUndefined();
   await expect(permit(a,{token:t})).rejects.toThrow();
 });
 it('fails closed when replica count is unknown or multi-instance',async()=>{
   const a=action();
   for(const count of [undefined,'2']){
    if(count===undefined)delete process.env.MW1_INTERNAL_REPLICA_COUNT;
    else process.env.MW1_INTERNAL_REPLICA_COUNT=count;
    await expect(permit(a)).rejects.toThrow();
   }
   process.env.MW1_INTERNAL_REPLICA_COUNT='1';
 });
});
